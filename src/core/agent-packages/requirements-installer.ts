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
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Manifest, NpmRequirement, ModelRequirement } from '../../../packages/core/src/agent-packages/manifest'
import { readInstalledBy, writeInstalledBy, type InstalledByMarker } from '../../../packages/core/src/agent-packages/markers'
import { commitFileAtomic, downloadToFile, opTransfer, type DownloadEvent } from '../../../packages/core/src/net/download'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { runSystemBun } from '../whiskit/command'
import { ensureBunAvailable } from '../whiskit/managed-bun'
import { binItemId, binPlatformKey, installManifestBins } from './bin-installer'
import { generatedNpmManifest, verifyNpmPayload } from './npm-verify'
import type { ProjectorResult } from './projector'
import type { RequirementOp } from './requirement-op'

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

/**
 * The payload's bunfig.toml: the pack's own (registries, scopes, CA —
 * preserved verbatim) with only the LAYOUT forced — `linker = "hoisted"` in
 * `[install]`, any `linker`/`globalStore` the pack set dropped — so
 * dependencies always land inside the payload (see installNpmRequirement).
 */
export function payloadBunfig(packBunfig: string): string {
  const lines = packBunfig.split('\n').filter((line) => !/^\s*(linker|globalStore)\s*=/.test(line))
  const header = lines.findIndex((line) => /^\s*\[install\]\s*$/.test(line))
  if (header === -1) return `${lines.join('\n').trimEnd()}${lines.some((l) => l.trim()) ? '\n\n' : ''}[install]\nlinker = "hoisted"\n`
  lines.splice(header + 1, 0, 'linker = "hoisted"')
  return `${lines.join('\n').trimEnd()}\n`
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
 * (re-projection semantics); the dependency install is skipped only when
 * the live payload PROVES its dependencies resolve at the declared versions
 * (`verifyNpmPayload`, #898 F) — so an OFFLINE local repair with unchanged,
 * intact deps never needs the network — and every staged payload proves
 * itself the same way before it replaces the live one.
 */
export async function installNpmRequirement(
  req: NpmRequirement,
  packId: string,
  sourceDir: string,
  installedBy: Omit<InstalledByMarker, 'sha256'>,
  options: { op?: RequirementOp } = {},
): Promise<NpmInstallResult> {
  const target = npmPayloadDir(packId, req.name)
  const scriptsSource = join(sourceDir, req.source)
  if (!existsSync(scriptsSource)) {
    throw new Error(`npm payload "${req.name}": source dir "${req.source}" is missing from the pack`)
  }

  const generated = generatedNpmManifest(packId, req)
  const hasDeps = Object.keys(req.dependencies).length > 0
  // Read the LIVE payload state BEFORE any mutation — the offline fast path
  // must never be defeated by this pass's own writes (or by a stray
  // package.json inside the pack's script dir). Reuse requires PROOF: the
  // declared dependency set, every direct dependency resolving inside the
  // payload at its exact version with its entry file (#898 F) — never just
  // "node_modules exists". Scripts are re-copied below either way.
  const liveModules = join(target, 'node_modules')
  const canReuseModules = hasDeps && verifyNpmPayload(target, packId, req).ok

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
    // A payload-local install layout, whatever the user's global bunfig
    // says: an isolated linker with a global store links dependencies
    // OUTSIDE the payload, which verifyNpmPayload (rightly) rejects. The
    // project bunfig wins over the global one; older buns ignore the key.
    const packBunfig = join(staging, 'bunfig.toml')
    writeFileSync(packBunfig, payloadBunfig(existsSync(packBunfig) ? readFileSync(packBunfig, 'utf-8') : ''), 'utf-8')

    if (canReuseModules) {
      // Unchanged deps: adopt the live install state (rename, no network).
      renameSync(liveModules, join(staging, 'node_modules'))
      for (const lock of ['bun.lock', 'bun.lockb']) {
        if (existsSync(join(target, lock))) renameSync(join(target, lock), join(staging, lock))
      }
    } else if (hasDeps) {
      skipped = false
      // Customer binary installs have no dev toolchain — a missing system
      // bun installs the pinned managed bun instead of failing with
      // "install Bun" advice (margo, 2026-09-21). Install-time only.
      const bunPath = await ensureBunAvailable({ op: options.op })
      options.op?.op.throwIfCancelled()
      const run = await runSystemBun(['install', '--ignore-scripts'], {
        cwd: staging,
        timeoutMs: NPM_INSTALL_TIMEOUT_MS,
        extraEnv: req.env,
        bunPath,
        onLine: options.op ? (line) => options.op!.op.output(line) : undefined,
      })
      if (run.exitCode !== 0) {
        throw new Error(
          `npm payload "${req.name}": bun install failed (exit ${run.exitCode}${run.timedOut ? ', timed out' : ''}): ${(run.stderr || run.stdout).slice(-400)}`,
        )
      }
    }

    // The staged payload must prove itself before it replaces the live one:
    // a bun run that "succeeded" without resolving the declared versions, or
    // a reused tree that no longer matches, never goes live.
    const staged = verifyNpmPayload(staging, packId, req, { scriptsSource })
    if (!staged.ok) {
      throw new Error(`npm payload "${req.name}": dependencies did not resolve at the declared versions — ${staged.problems.join('; ')}`)
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
  log.info(`npm payload "${req.name}" ${skipped ? 'reused (dependencies resolved at declared versions)' : 'installed'} → ${target}`)
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
  /** Transfer events for the download leg (#895). */
  onEvent?: (event: DownloadEvent) => void
  /** Aborts the download (an operation's cancel, #895). */
  signal?: AbortSignal
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

  // Download + commit ride the shared primitive (streams to disk, sha256
  // pin verified, partial file deleted on failure); the size check stays a
  // verify-then-commit hook so a wrong-length file never reaches the target.
  const tmp = `${target}.tmp-${process.pid}`
  const downloaded = await downloadToFile(req.url, tmp, {
    sha256: pin,
    timeoutMs: MODEL_DOWNLOAD_TIMEOUT_MS,
    fetchImpl: options.fetchImpl,
    label: `Model "${req.name}"`,
    onEvent: options.onEvent,
    signal: options.signal,
  })
  await commitFileAtomic(tmp, target, {
    verify: async () => {
      if (downloaded.bytes !== req.bytes) {
        throw new Error(`Model "${req.name}" size mismatch: declared ${req.bytes} bytes, downloaded ${downloaded.bytes}`)
      }
    },
  })

  writeInstalledBy(target, { ...installedBy, sha256: pin })
  log.info(`Installed model "${req.name}" → ${target}`)
  return { target, sha256: pin, skipped: false }
}

export interface ManifestRequirementsInput {
  manifest: Manifest
  /**
   * The operation stage these legs report into — one item per bin, model and
   * npm payload (the managed bun download is its own item). The caller enters
   * the stage; its plan decides whether that is the point of no return.
   */
  op?: RequirementOp
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
  const target = input.op
  const models = manifest.requires?.models ?? []
  const npmReqs = manifest.requires?.npm ?? []
  // Every leg is listed up front, so the operation shows what is still to come.
  if (target) {
    for (const bin of manifest.requires?.bins ?? []) target.op.item(target.stageId, { id: binItemId(bin.name), label: `${bin.name} ${bin.version}` })
    for (const req of models) target.op.item(target.stageId, { id: modelItemId(req.name), label: req.name, bytes: { received: 0, total: req.bytes } })
    for (const req of npmReqs) target.op.item(target.stageId, { id: npmItemId(req.name), label: `${req.name} (npm)` })
  }
  await installManifestBins(manifest, installedBy, result, { op: target })
  for (const req of models) {
    const installed = await asItem<ModelInstallResult>(target, { id: modelItemId(req.name), label: req.name }, (r) => r.skipped, (reportOp) => installModelRequirement(req, installedBy, {
      ...input.modelOptions,
      signal: target?.op.signal,
      ...(reportOp ? { onEvent: reportOp } : {}),
    }))
    result.projections.push({ kind: 'model', target: installed.target, sha256: installed.sha256 })
  }
  for (const req of npmReqs) {
    const installed = await asItem<NpmInstallResult>(target, { id: npmItemId(req.name), label: `${req.name} (npm)` }, (r) => r.skipped, () => installNpmRequirement(req, packId, sourceDir, installedBy, { op: target }))
    result.projections.push({ kind: 'npm-payload', target: installed.target })
  }
}

export const modelItemId = (name: string): string => `model:${name}`
export const npmItemId = (name: string): string => `npm:${name}`

/** Run one requirement as an operation item: active → done/skipped, or failed with the error (rethrown). */
async function asItem<R>(
  target: RequirementOp | undefined,
  item: { id: string; label: string },
  skipped: (result: R) => boolean,
  run: (reportOp: ((event: DownloadEvent) => void) | undefined) => Promise<R>,
): Promise<R> {
  if (!target) return run(undefined)
  const { op, stageId } = target
  op.item(stageId, { ...item, status: 'active' })
  try {
    const result = await run(opTransfer(op, stageId, item.id))
    op.item(stageId, skipped(result) ? { ...item, status: 'skipped', message: 'already installed' } : { ...item, status: 'done' })
    return result
  } catch (err) {
    op.item(stageId, { ...item, status: 'failed', message: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
