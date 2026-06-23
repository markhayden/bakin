/**
 * Versioned asset service — public barrel + source-keyed upsert.
 *
 * An asset is a directory `assets/store/{YYYY-MM}/{assetId}/` containing a
 * `manifest.json` (source of truth) plus per-version files `v{n}.{ext}` and
 * thumbnails `v{n}.thumb.jpg`. The creation + read core lives in `asset-core`
 * and the version/metadata/tag/export mutations in `asset-mutations`; both are
 * re-exported here so the consumers + tests keep importing from this path. This
 * module houses the source-keyed upsert (the dedup spine).
 *
 * Type-agnostic: images are the first consumer, but any asset type uses the
 * same spine.
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { getContentDir } from '../../../src/core/content-dir'
import { type AssetType } from './constants'
import { assetDirRelPath, yearMonthFromAssetId, isValidAssetId } from './asset-id'
import { withAssetLock } from './asset-lock'
import { getManifestCached } from './manifest-cache'
import { createAsset, getAsset, listAssets, type AssetCreateInput } from './asset-core'
import { addVersion, updateMetadata } from './asset-mutations'

export {
  createAsset,
  getAsset,
  assetExists,
  resolveFileFromManifest,
  resolveFile,
  getAssetSummary,
  listAssets,
  type AssetCreateInput,
  type AssetFileRef,
  type AssetSummary,
} from './asset-core'

export {
  addVersion,
  updateMetadata,
  renameTagGlobal,
  removeTagGlobal,
  applyTags,
  promoteVersion,
  deleteVersion,
  addExport,
  relink,
  retype,
  type AssetVersionInput,
  type AssetMetadataInput,
  type AssetExportInput,
} from './asset-mutations'

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
 */
export async function upsertFromSource(sourcePath: string, input: AssetCreateInput): Promise<{ assetId: string; version: number; changed: boolean }> {
  // Serialize on the source path so concurrent saves of the same source can't
  // both miss findBySourcePath and mint duplicate assets (the dedup invariant).
  return withAssetLock(`source:${sourcePath}`, () => upsertFromSourceInner(sourcePath, input))
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

async function upsertFromSourceInner(sourcePath: string, input: AssetCreateInput): Promise<{ assetId: string; version: number; changed: boolean }> {
  // Reflection: a path INSIDE the asset store is already managed — return its
  // identity instead of cloning it (live incident: a reference passed as
  // .../store/<id>/v1.png minted a duplicate asset pointing into the store).
  const managed = resolveStoreFile(sourcePath)
  if (managed) return { assetId: managed.assetId, version: managed.version, changed: false }

  const source = input.source ?? { kind: 'workspace-file' as const, path: sourcePath }
  const existingId = findBySourcePath(sourcePath)
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
  const next = await addVersion(existingId, {
    sourceFilePath: sourcePath,
    op: 'upload',
    tool: input.tool ?? null,
    description: input.description,
  })
  // Union caller-provided tags into the asset-level namespace — agents add
  // organization, never wipe the user's. (Separate locked write; the watcher
  // coalesces and only the final manifest is indexed.)
  if (input.tags && input.tags.length > 0) {
    await updateMetadata(existingId, { tags: [...(next.manifest.tags ?? []), ...input.tags] })
  }
  return { assetId: next.assetId, version: next.version, changed: true }
}
