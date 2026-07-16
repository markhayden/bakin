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
import { createReadStream, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Manifest, NpmRequirement, ModelRequirement } from '../../../packages/core/src/agent-packages/manifest'
import { readInstalledBy, writeInstalledBy, type InstalledByMarker } from '../../../packages/core/src/agent-packages/markers'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { runSystemBun } from '../whiskit/command'
import { binPlatformKey, installManifestBins } from './bin-installer'
import type { ProjectorResult } from './projector'

const log = createLogger('pack-requirements')

const MODEL_DOWNLOAD_TIMEOUT_MS = 30 * 60_000 // models are ~GB; generous wall clock
const NPM_INSTALL_TIMEOUT_MS = 5 * 60_000

/**
 * `<bakin-home>/npm/<packId>/<name>` — unversioned so SKILL.md paths survive
 * upgrades. Defense-in-depth: the id is re-validated here because this dir is
 * DESTRUCTIVELY swept during install — a traversal-shaped id must never
 * resolve outside the Bakin npm root, whatever an upstream boundary missed.
 */
export function npmPayloadDir(packId: string, name: string): string {
  if (!/^[a-z0-9][a-z0-9-_]{0,39}$/i.test(packId)) {
    throw new Error(`npm payload refused: package id "${packId}" is not a safe id`)
  }
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

  const generated = JSON.stringify(
    // type:module — payload scripts in this ecosystem are ESM (upstream
    // pi-skills convention); without it node re-parses on every run.
    { name: `bakin-pack-${packId}-${req.name}`, private: true, type: 'module', dependencies: req.dependencies },
    null,
    2,
  )
  const hasDeps = Object.keys(req.dependencies).length > 0
  // Read the LIVE payload state BEFORE any mutation — the offline fast path
  // must never be defeated by this pass's own writes (or by a stray
  // package.json inside the pack's script dir).
  const livePkgJson = join(target, 'package.json')
  const depsUnchanged = existsSync(livePkgJson) && readFileSync(livePkgJson, 'utf-8') === generated
  const liveModules = join(target, 'node_modules')
  const canReuseModules = hasDeps && depsUnchanged && existsSync(liveModules)

  // Build the ENTIRE new payload in a staging dir and swap at the end — the
  // live payload (which the still-installed pack version's SKILL.md points
  // at) is never mutated until the new one is fully ready, so a failed
  // update leg leaves working state behind (fail-fast, nothing torn).
  const staging = `${target}.staging-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  let skipped = true
  try {
    mkdirSync(staging, { recursive: true })
    cpSync(scriptsSource, staging, { recursive: true, dereference: false })
    // The generated manifest always wins over any package.json the pack's
    // script dir happens to carry.
    writeFileSync(join(staging, 'package.json'), generated, 'utf-8')

    if (canReuseModules) {
      // Unchanged deps: adopt the live install state (rename, no network).
      renameSync(liveModules, join(staging, 'node_modules'))
      for (const lock of ['bun.lock', 'bun.lockb']) {
        if (existsSync(join(target, lock))) renameSync(join(target, lock), join(staging, lock))
      }
    } else if (hasDeps) {
      skipped = false
      const run = await runSystemBun(['install', '--ignore-scripts'], {
        cwd: staging,
        timeoutMs: NPM_INSTALL_TIMEOUT_MS,
        extraEnv: req.env,
      })
      if (run.exitCode !== 0) {
        throw new Error(
          `npm payload "${req.name}": bun install failed (exit ${run.exitCode}${run.timedOut ? ', timed out' : ''}): ${(run.stderr || run.stdout).slice(-400)}`,
        )
      }
      if (!existsSync(join(staging, 'node_modules'))) {
        throw new Error(`npm payload "${req.name}": bun install succeeded but node_modules is missing`)
      }
    }

    rmSync(target, { recursive: true, force: true })
    renameSync(staging, target)
  } catch (err) {
    // Give reused modules back to the live payload before surfacing.
    if (canReuseModules && existsSync(join(staging, 'node_modules')) && !existsSync(liveModules)) {
      try { renameSync(join(staging, 'node_modules'), liveModules) } catch { /* staging cleanup below still runs */ }
    }
    rmSync(staging, { recursive: true, force: true })
    throw err
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
    // A DIFFERENT pack's pin at the same dest must never silently clobber a
    // model another installed pack depends on — shared dests require shared
    // pins; otherwise the pack author picks a distinct dest.
    if (marker && marker.sha256 && marker.sha256.toLowerCase() !== pin && marker.package !== installedBy.package) {
      throw new Error(
        `Model dest "${req.dest}" is already installed by pack "${marker.package}" with a different sha256 pin — use a distinct dest`,
      )
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
  // Pack-level platform gate: an unsupported platform installs NO legs —
  // readiness reports "not available on this platform" honestly instead of
  // a bins hard-fail or a pointless multi-GB model download.
  if (manifest.platforms) {
    const platform = binPlatformKey()
    if (!platform || !manifest.platforms.includes(platform)) {
      log.info(`Requirement legs skipped for "${packId}" — pack declares platforms ${manifest.platforms.join(', ')}`)
      return
    }
  }
  // Leg order matters for fail-fast: bins and models are atomic + idempotent
  // (tmp + rename; unchanged pins skip); the npm payload swap mutates live
  // state LAST, after every downloadable leg has already succeeded.
  await installManifestBins(manifest, installedBy, result)
  for (const req of manifest.requires?.models ?? []) {
    const installed = await installModelRequirement(req, installedBy, input.modelOptions)
    result.projections.push({ kind: 'model', target: installed.target, sha256: installed.sha256 })
  }
  for (const req of manifest.requires?.npm ?? []) {
    const installed = await installNpmRequirement(req, packId, sourceDir, installedBy)
    result.projections.push({ kind: 'npm-payload', target: installed.target })
  }
}
