/**
 * Versioned asset upsert — the source-keyed dedup spine.
 *
 * Saves a source file as a versioned asset keyed by its source path: create v1
 * if no asset tracks the path, append a version if its content changed, or no-op
 * if identical — plus the store-reflection + same-task content-match guards that
 * stop an evolving file from minting N duplicate assets.
 *
 * Imports the create/read core from asset-core and the version mutations from
 * asset-mutations (never the asset-service barrel) so there is no import cycle.
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { getContentDir } from '../../../src/core/content-dir'
import { getRunStatus } from '../../../src/core/execution-ledger'
import { readRunSidecar } from '../../../src/core/run-workspace'
import { type AssetType } from './constants'
import { assetDirRelPath, yearMonthFromAssetId, isValidAssetId } from './asset-id'
import { withAssetLock } from './asset-lock'
import { getManifestCached } from './manifest-cache'
import { createAsset, getAsset, listAssets, type AssetCreateInput } from './asset-core'
import { addVersion, updateMetadata } from './asset-mutations'

function sha256File(absPath: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(absPath)).digest('hex')
  } catch {
    return null
  }
}

/** Find the asset whose `source.path` matches `sourcePath`, or null. */
export function findBySourcePath(sourcePath: string): string | null {
  const storeRoot = join(getContentDir(), 'assets', 'store')
  if (!existsSync(storeRoot)) return null
  for (const month of readdirSync(storeRoot)) {
    const monthDir = join(storeRoot, month)
    let entries: string[]
    try {
      if (!statSync(monthDir).isDirectory()) continue
      entries = readdirSync(monthDir)
    } catch {
      continue
    }
    for (const assetId of entries) {
      if (!yearMonthFromAssetId(assetId)) continue
      const manifest = getManifestCached(assetId, join(monthDir, assetId))
      if (manifest?.source?.path === sourcePath) return assetId
    }
  }
  return null
}

/**
 * Save a source file as a versioned asset, keyed by its source path: create v1
 * if no asset tracks this path, append a version if its content changed, or
 * no-op if identical. The markdown twin of the image edit→version fix — an
 * agent re-saving an evolving file versions ONE asset instead of minting N.
 *
 * Run-workspace saves (same-agent-concurrency D2) get two extra rules:
 * 1. IDENTITY — paths under run-workspaces/ dedup on a task-stable virtual
 *    key (`run:task:<taskId>/<relpath>`, derived by READING the run dir's
 *    sidecar, never by parsing path segments), so attempt d2's re-save of
 *    `report.md` versions d1's asset instead of minting a duplicate. Bytes
 *    still read from the real path; the virtual key is stored as
 *    source.path (the translateAgentPath precedent — source.path is the
 *    stable dedup identity, not necessarily a live filesystem path).
 * 2. STALENESS — a save whose origin run is no longer `running` in the
 *    ledger (superseded/lost/settled/purged, or ledger unreadable —
 *    fail-closed) records its version WITHOUT advancing currentVersion: a
 *    zombie's late output must never displace the corrective attempt's
 *    deliverable. `staleSuppressed` reports it so callers audit.
 */
export async function upsertFromSource(sourcePath: string, input: AssetCreateInput): Promise<{ assetId: string; version: number; changed: boolean; staleSuppressed?: boolean }> {
  const origin = runWorkspaceOrigin(sourcePath)
  const dedupPath = origin ? `run:task:${origin.taskId}/${origin.relPath}` : sourcePath
  // Serialize on the DEDUP key so concurrent saves of the same source can't
  // both miss findBySourcePath and mint duplicate assets (the dedup invariant
  // — for run saves that means across attempts, not just within one).
  return withAssetLock(`source:${dedupPath}`, () => upsertFromSourceInner(sourcePath, dedupPath, origin, input))
}

interface RunSaveOrigin {
  taskId: string
  threadId: string
  relPath: string
}

/**
 * Resolve a source path under run-workspaces/ to its run origin by reading
 * the run dir's sidecar. A missing/torn sidecar returns null — honest
 * degradation to real-path identity (dedup lost for that save, linkage
 * never guessed).
 */
function runWorkspaceOrigin(sourcePath: string): RunSaveOrigin | null {
  const root = resolve(getContentDir(), 'run-workspaces')
  const resolved = resolve(sourcePath)
  if (!resolved.startsWith(root + sep)) return null
  const segments = resolved.slice(root.length + 1).split(sep)
  if (segments.length < 3) return null
  const [agentId, encodedRunId, ...rest] = segments
  const sidecar = readRunSidecar(join(root, agentId, encodedRunId))
  if (!sidecar) return null
  return { taskId: sidecar.taskId, threadId: sidecar.threadId, relPath: rest.join('/') }
}

/** Fail-closed liveness: any ledger error counts as NOT live (suppress). */
function originRunIsLive(threadId: string): boolean {
  try {
    return getRunStatus(threadId) === 'running'
  } catch {
    return false
  }
}

/**
 * Map an absolute path INSIDE the asset store back to the asset identity it
 * belongs to. Recognizes per-version files (`v{n}.{ext}`) and their thumbs;
 * `absPath` in the result is always the REAL version file (never the thumb).
 * Null for anything outside the store or store-internal non-version files
 * (manifest.json, exports/).
 */
export function resolveStoreFile(absPath: string): { assetId: string; version: number; absPath: string } | null {
  const storeRoot = resolve(getContentDir(), 'assets', 'store')
  const resolved = resolve(absPath)
  if (!resolved.startsWith(storeRoot + sep)) return null
  const segments = resolved.slice(storeRoot.length + 1).split(sep)
  if (segments.length !== 3) return null // exports/<name> and deeper are derived, not versions
  const [, assetId, file] = segments
  if (!isValidAssetId(assetId)) return null
  const manifest = getAsset(assetId)
  if (!manifest) return null
  const version = manifest.versions.find((v) => v.file === file || v.thumb === file)
  if (!version) return null
  return { assetId, version: version.version, absPath: join(getContentDir(), assetDirRelPath(assetId)!, version.file) }
}

/** Find an asset version on the SAME task whose bytes equal the file at sourcePath. */
function findSameTaskContentMatch(sourcePath: string, taskId: string, type: AssetType): { assetId: string; version: number } | null {
  let size: number
  try {
    size = statSync(sourcePath).size
  } catch {
    return null
  }
  const sourceHash = sha256File(sourcePath)
  if (!sourceHash) return null
  for (const summary of listAssets({ taskId, type })) {
    const manifest = getAsset(summary.assetId)
    const dirRel = assetDirRelPath(summary.assetId)
    if (!manifest || !dirRel) continue
    for (const version of manifest.versions) {
      if (version.size !== size) continue
      if (sha256File(join(getContentDir(), dirRel, version.file)) === sourceHash) {
        return { assetId: summary.assetId, version: version.version }
      }
    }
  }
  return null
}

async function upsertFromSourceInner(sourcePath: string, dedupPath: string, origin: RunSaveOrigin | null, input: AssetCreateInput): Promise<{ assetId: string; version: number; changed: boolean; staleSuppressed?: boolean }> {
  // Reflection: a path INSIDE the asset store is already managed — return its
  // identity instead of cloning it (live incident: a reference passed as
  // .../store/<id>/v1.png minted a duplicate asset pointing into the store).
  const managed = resolveStoreFile(sourcePath)
  if (managed) return { assetId: managed.assetId, version: managed.version, changed: false }

  const source = input.source ?? { kind: 'workspace-file' as const, path: dedupPath }
  const existingId = findBySourcePath(dedupPath)
  if (!existingId) {
    // Same-task content dedupe: the same bytes under a fresh path (an agent
    // copying its finished render to workspace/tmp and re-saving) is the SAME
    // deliverable, not a new asset. Scoped to one task — reusing an image on
    // a different task is legitimately a new asset.
    if (input.taskId) {
      const match = findSameTaskContentMatch(sourcePath, input.taskId, input.type)
      if (match) return { ...match, changed: false }
    }
    const created = await createAsset({ ...input, source })
    return { assetId: created.assetId, version: created.version, changed: true }
  }
  const manifest = getAsset(existingId)
  if (!manifest) {
    const created = await createAsset({ ...input, source })
    return { assetId: created.assetId, version: created.version, changed: true }
  }
  const current = manifest.versions.find((v) => v.version === manifest.currentVersion)
  const currentAbs = current ? join(getContentDir(), assetDirRelPath(existingId)!, current.file) : null
  const newHash = sha256File(sourcePath)
  const curHash = currentAbs ? sha256File(currentAbs) : null
  if (newHash && curHash && newHash === curHash) {
    return { assetId: existingId, version: manifest.currentVersion, changed: false }
  }
  // Staleness gate: a run-workspace save whose origin run is no longer live
  // records its bytes but never displaces the current deliverable.
  const staleSuppressed = origin !== null && !originRunIsLive(origin.threadId)
  const next = await addVersion(existingId, {
    sourceFilePath: sourcePath,
    op: 'upload',
    tool: input.tool ?? null,
    description: input.description,
    ...(staleSuppressed ? { advanceCurrent: false } : {}),
  })
  // Union caller-provided tags into the asset-level namespace — agents add
  // organization, never wipe the user's. (Separate locked write; the watcher
  // coalesces and only the final manifest is indexed.)
  if (input.tags && input.tags.length > 0) {
    await updateMetadata(existingId, { tags: [...(next.manifest.tags ?? []), ...input.tags] })
  }
  return { assetId: next.assetId, version: next.version, changed: true, ...(staleSuppressed ? { staleSuppressed: true } : {}) }
}
