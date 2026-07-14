/**
 * Capability-pack requirement installers beyond bins: npm payloads and
 * pinned model downloads — plus the ONE entry point every projection pass
 * calls (`installManifestRequirements`). Bins keep their engine in
 * bin-installer.ts; this module owns the newer legs and the aggregation.
 *
 * npm payloads live OUTSIDE projected skill dirs by hard constraint: Pi's
 * skill writer rejects nested paths and both drift hashes walk every file,
 * so node_modules in a skill would never converge. The payload dir
 * (`<bakin-home>/npm/<packId>/<name>/`, unversioned so SKILL.md can
 * reference it) holds copied scripts + a generated package.json +
 * node_modules, recorded as an `npm-payload` lockfile projection.
 *
 * Models are sha256-pinned single-file downloads into
 * `<bakin-home>/models/<dest>` (`model` projections, refcount-aware on
 * removal like bins). Downloads stream to disk — never buffered in memory.
 */
import { createHash } from 'crypto'
import { createReadStream, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Manifest, NpmRequirement, ModelRequirement } from '../../../packages/core/src/agent-packages/manifest'
import { readInstalledBy, writeInstalledBy, type InstalledByMarker } from '../../../packages/core/src/agent-packages/markers'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { runSystemBun } from '../whiskit/command'
import { installManifestBins } from './bin-installer'
import type { ProjectorResult } from './projector'

const log = createLogger('pack-requirements')

const MODEL_DOWNLOAD_TIMEOUT_MS = 30 * 60_000 // models are ~GB; generous wall clock
const NPM_INSTALL_TIMEOUT_MS = 5 * 60_000

/** `<bakin-home>/npm/<packId>/<name>` — unversioned so SKILL.md paths survive upgrades. */
export function npmPayloadDir(packId: string, name: string): string {
  return join(getContentDir(), 'npm', packId, name)
}

/** `<bakin-home>/models/<dest>` */
export function modelDest(dest: string): string {
  return join(getContentDir(), 'models', dest)
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export interface NpmInstallResult {
  target: string
  /** True when dependencies were already installed and matching — no bun run. */
  skipped: boolean
}

/**
 * Install one npm payload: copy the pack-relative script dir into the payload
 * dir, write the generated exact-pinned package.json, and `bun install
 * --ignore-scripts` via the system bun (whiskit precedent — the compiled
 * binary's embedded bun cannot install). Scripts are always re-copied
 * (re-projection semantics); the dependency install is skipped when the
 * generated package.json is unchanged and node_modules exists — so an
 * OFFLINE local repair with unchanged deps never needs the network.
 */
export async function installNpmRequirement(
  req: NpmRequirement,
  packId: string,
  sourceDir: string,
  installedBy: Omit<InstalledByMarker, 'sha256'>,
): Promise<NpmInstallResult> {
  const target = npmPayloadDir(packId, req.name)
  const scriptsSource = join(sourceDir, req.source)
  if (!existsSync(scriptsSource)) {
    throw new Error(`npm payload "${req.name}": source dir "${req.source}" is missing from the pack`)
  }

  mkdirSync(target, { recursive: true })
  // Sweep stale scripts, keep the install state (node_modules/lock) so an
  // unchanged-deps re-projection stays offline-safe.
  const KEEP = new Set(['node_modules', 'package.json', 'bun.lock', 'bun.lockb'])
  for (const entry of readdirSync(target)) {
    if (!KEEP.has(entry)) rmSync(join(target, entry), { recursive: true, force: true })
  }
  cpSync(scriptsSource, target, { recursive: true, dereference: false })

  const pkgJsonPath = join(target, 'package.json')
  const generated = JSON.stringify(
    { name: `bakin-pack-${packId}-${req.name}`, private: true, dependencies: req.dependencies },
    null,
    2,
  )
  const unchanged = existsSync(pkgJsonPath) && readFileSync(pkgJsonPath, 'utf-8') === generated
  const hasModules = existsSync(join(target, 'node_modules'))
  writeFileSync(pkgJsonPath, generated, 'utf-8')

  // Zero-dep payload = vendored scripts only; nothing to install, no bun needed.
  const hasDeps = Object.keys(req.dependencies).length > 0
  let skipped = true
  if (hasDeps && (!unchanged || !hasModules)) {
    skipped = false
    const run = await runSystemBun(['install', '--ignore-scripts'], {
      cwd: target,
      timeoutMs: NPM_INSTALL_TIMEOUT_MS,
      extraEnv: req.env,
    })
    if (run.exitCode !== 0) {
      throw new Error(
        `npm payload "${req.name}": bun install failed (exit ${run.exitCode}${run.timedOut ? ', timed out' : ''}): ${(run.stderr || run.stdout).slice(-400)}`,
      )
    }
    if (!existsSync(join(target, 'node_modules'))) {
      throw new Error(`npm payload "${req.name}": bun install succeeded but node_modules is missing`)
    }
  }

  // The marker sha identifies the DEP SET (generated package.json) — the
  // payload dir itself has no stable content hash (node_modules).
  writeInstalledBy(target, { ...installedBy, sha256: createHash('sha256').update(generated).digest('hex') })
  log.info(`npm payload "${req.name}" ${skipped ? 'verified' : 'installed'} → ${target}`)
  return { target, skipped }
}

export interface ModelInstallResult {
  target: string
  sha256: string
  skipped: boolean
}

export interface ModelInstallOptions {
  /** Tests pass Bun.fetch — happy-dom's global fetch can't drive real sockets. */
  fetchImpl?: typeof fetch
}

/**
 * Install one pinned model: stream the download to a temp file, sha256-verify
 * against the pin, atomic-rename into the models dir. Fast path: an on-disk
 * file whose size matches the declaration and whose install marker carries
 * the pinned sha is trusted without re-hashing (~GB files; re-hashing every
 * sync pass would be real cost).
 */
export async function installModelRequirement(
  req: ModelRequirement,
  installedBy: Omit<InstalledByMarker, 'sha256'>,
  options: ModelInstallOptions = {},
): Promise<ModelInstallResult> {
  const target = modelDest(req.dest)
  const pin = req.sha256.toLowerCase()

  if (existsSync(target)) {
    const marker = readInstalledBy(target)
    if (statSync(target).size === req.bytes && marker?.sha256?.toLowerCase() === pin) {
      log.info(`Model "${req.name}" already installed at pinned sha — skipping download`)
      writeInstalledBy(target, { ...installedBy, sha256: pin })
      return { target, sha256: pin, skipped: true }
    }
  }

  mkdirSync(dirname(target), { recursive: true })
  const fetchImpl = options.fetchImpl
    ?? (Bun as unknown as { fetch?: typeof fetch }).fetch
    ?? fetch
  const res = await fetchImpl(req.url, { signal: AbortSignal.timeout(MODEL_DOWNLOAD_TIMEOUT_MS) })
  if (!res.ok) {
    throw new Error(`Model "${req.name}" download failed: ${res.status} ${res.statusText} (${req.url})`)
  }

  const tmp = `${target}.tmp-${process.pid}`
  try {
    // Streams — never buffers the file in memory. The repo's hand-rolled Bun
    // namespace types don't declare the Response overload; runtime supports it.
    await (Bun.write as unknown as (dest: string, input: Response) => Promise<number>)(tmp, res)
    const actual = await sha256File(tmp)
    if (actual !== pin) {
      throw new Error(`Model "${req.name}" checksum mismatch: expected ${pin}, got ${actual} — refusing to install`)
    }
    const size = statSync(tmp).size
    if (size !== req.bytes) {
      throw new Error(`Model "${req.name}" size mismatch: declared ${req.bytes} bytes, downloaded ${size}`)
    }
    renameSync(tmp, target)
  } catch (err) {
    try { rmSync(tmp, { force: true }) } catch { /* best-effort tmp cleanup */ }
    throw err
  }

  writeInstalledBy(target, { ...installedBy, sha256: pin })
  log.info(`Installed model "${req.name}" → ${target}`)
  return { target, sha256: pin, skipped: false }
}

export interface ManifestRequirementsInput {
  manifest: Manifest
  /** Lockfile pack id WITHOUT version (payload dirs are keyed by it). */
  packId: string
  /** The pack source dir npm payload scripts are copied from (staging or installed source). */
  sourceDir: string
  installedBy: Omit<InstalledByMarker, 'sha256'>
  result: Pick<ProjectorResult, 'projections'>
  modelOptions?: ModelInstallOptions
}

/**
 * THE requirement entry point — every projection pass (install, update,
 * local re-projection/repair) installs ALL declared requirement legs through
 * this one call, or the lockfile silently untracks them (PR #673 lesson).
 * Fail-fast by design: callers order this BEFORE teardown so a failed leg
 * aborts with nothing swept.
 */
export async function installManifestRequirements(input: ManifestRequirementsInput): Promise<void> {
  const { manifest, packId, sourceDir, installedBy, result } = input
  if (manifest.kind !== 'skill-pack') return
  await installManifestBins(manifest, installedBy, result)
  for (const req of manifest.requires?.npm ?? []) {
    const installed = await installNpmRequirement(req, packId, sourceDir, installedBy)
    result.projections.push({ kind: 'npm-payload', target: installed.target })
  }
  for (const req of manifest.requires?.models ?? []) {
    const installed = await installModelRequirement(req, installedBy, input.modelOptions)
    result.projections.push({ kind: 'model', target: installed.target, sha256: installed.sha256 })
  }
}
