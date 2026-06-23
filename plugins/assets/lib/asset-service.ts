/**
 * Versioned asset service — public barrel + mutation/upsert clusters.
 *
 * An asset is a directory `assets/store/{YYYY-MM}/{assetId}/` containing a
 * `manifest.json` (source of truth) plus per-version files `v{n}.{ext}` and
 * thumbnails `v{n}.thumb.jpg`. The creation + read core lives in `asset-core`
 * and is re-exported here so the consumers + tests keep importing from this
 * path; this module houses the version mutations (all behind the per-asset lock
 * + atomic manifest write) and the source-keyed upsert.
 *
 * Type-agnostic: images are the first consumer, but any asset type uses the
 * same spine.
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { getContentDir } from '../../../src/core/content-dir'
import { createLogger } from '../../../src/core/logger'
import { getMimeType, type AssetType } from './constants'
import { assetDirRelPath, assetDirAbs, yearMonthFromAssetId, isValidAssetId } from './asset-id'
import { normalizeTags } from './tags'
import { withAssetLock } from './asset-lock'
import { getManifestCached } from './manifest-cache'
import { loadSharp, imageDimensions, generateThumbnail } from './asset-media'
import {
  readManifest,
  writeManifestAtomic,
  type AssetManifest,
  type AssetVersion,
  type AssetExport,
  type AssetGeneration,
} from './manifest'
import { createAsset, extOf, getAsset, listAssets, nowIso, type AssetCreateInput } from './asset-core'

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

const log = createLogger('asset-service')

// ---------------------------------------------------------------------------
// Mutations — all serialized behind the per-asset lock + atomic manifest write.
// ---------------------------------------------------------------------------

/**
 * Asset-level description mirrors the current version's. Tags deliberately do
 * NOT mirror — they're an asset-level organizational namespace that must
 * survive addVersion/promote/deleteVersion.
 */
function mirrorDisplay(manifest: AssetManifest): void {
  const current = manifest.versions.find((v) => v.version === manifest.currentVersion)
  if (current) {
    manifest.description = current.description
  }
}

function removeFileQuietly(absPath: string): void {
  try {
    rmSync(absPath, { force: true })
  } catch (err) {
    log.warn('Failed to remove asset file', { absPath, error: err instanceof Error ? err.message : String(err) })
  }
}

export interface AssetVersionInput {
  sourceFilePath: string
  op?: 'edit' | 'generate' | 'upload' | 'import'
  tool?: string | null
  prompt?: string | null
  promptHash?: string | null
  description?: string
  generation?: AssetGeneration | null
}

/** Append a new version derived from the current version; advances the pointer. */
export async function addVersion(assetId: string, input: AssetVersionInput): Promise<{ assetId: string; version: number; manifest: AssetManifest }> {
  if (!existsSync(input.sourceFilePath)) throw new Error(`Source file not found: ${input.sourceFilePath}`)
  return withAssetLock(assetId, async () => {
    const dirAbs = assetDirAbs(assetId)
    if (!dirAbs) throw new Error(`Invalid assetId: ${assetId}`)
    const manifest = readManifest(dirAbs)
    if (!manifest) throw new Error(`Asset not found: ${assetId}`)

    // Stable numbering with gaps: next = max + 1, never reuse a number.
    const nextVersion = Math.max(...manifest.versions.map((v) => v.version)) + 1
    const parentVersion = manifest.currentVersion
    const ext = extOf(input.sourceFilePath) || 'bin'
    const file = `v${nextVersion}.${ext}`
    const fileAbs = join(dirAbs, file)
    copyFileSync(input.sourceFilePath, fileAbs)

    const isImage = manifest.type === 'images'
    const dims = isImage ? await imageDimensions(fileAbs) : { width: null, height: null }
    const thumb = isImage && await generateThumbnail(fileAbs, join(dirAbs, `v${nextVersion}.thumb.jpg`)) ? `v${nextVersion}.thumb.jpg` : null

    const created = nowIso()
    const version: AssetVersion = {
      version: nextVersion, file, thumb, mimeType: getMimeType(input.sourceFilePath), size: statSync(fileAbs).size,
      width: dims.width, height: dims.height, created,
      description: (input.description ?? input.prompt ?? '').slice(0, 200),
      op: input.op ?? 'edit', parentVersion, tool: input.tool ?? null,
      prompt: input.prompt ?? null, promptHash: input.promptHash ?? null,
      generation: input.generation ?? null,
    }
    manifest.versions.push(version)
    manifest.currentVersion = nextVersion
    manifest.updated = created
    mirrorDisplay(manifest)
    writeManifestAtomic(dirAbs, manifest)
    return { assetId, version: nextVersion, manifest }
  })
}

export interface AssetMetadataInput {
  description?: string
  tags?: string[]
}

/**
 * Update user-editable metadata. Description writes through to the asset level
 * AND the current version (200-char cap — same as version writes) so the
 * mirror invariant holds; tags replace the asset-level namespace (normalized)
 * and never touch versions.
 */
export async function updateMetadata(assetId: string, input: AssetMetadataInput): Promise<AssetManifest> {
  return withAssetLock(assetId, async () => {
    const dirAbs = assetDirAbs(assetId)
    if (!dirAbs) throw new Error(`Invalid assetId: ${assetId}`)
    const manifest = readManifest(dirAbs)
    if (!manifest) throw new Error(`Asset not found: ${assetId}`)
    if (input.description !== undefined) {
      const description = input.description.slice(0, 200)
      manifest.description = description
      const current = manifest.versions.find((v) => v.version === manifest.currentVersion)
      if (current) current.description = description
    }
    if (input.tags !== undefined) {
      manifest.tags = normalizeTags(input.tags)
    }
    manifest.updated = nowIso()
    writeManifestAtomic(dirAbs, manifest)
    return manifest
  })
}

/**
 * Rename a tag across every asset carrying it (merge-dedupe when the target
 * already exists). Sweeps the live store only — trash is deliberately skipped
 * (a restored asset may resurrect a stale tag; fix is one metadata edit).
 */
export async function renameTagGlobal(from: string, to: string): Promise<{ updated: number }> {
  const target = normalizeTags([to])[0]
  // `from` is deliberately matched verbatim (not normalized): it must equal
  // what's stored, including legacy pre-normalization tags — rename is the
  // tool that cleans those up.
  if (!from || !target) throw new Error('Both from and to tags are required')
  let updated = 0
  for (const summary of listAssets()) {
    if (!summary.tags.includes(from)) continue
    await updateMetadata(summary.assetId, { tags: summary.tags.map((t) => (t === from ? target : t)) })
    updated++
  }
  return { updated }
}

/** Remove a tag from every asset carrying it (assets themselves untouched). Skips trash. */
export async function removeTagGlobal(tag: string): Promise<{ updated: number }> {
  if (!tag) throw new Error('tag is required')
  let updated = 0
  for (const summary of listAssets()) {
    if (!summary.tags.includes(tag)) continue
    await updateMetadata(summary.assetId, { tags: summary.tags.filter((t) => t !== tag) })
    updated++
  }
  return { updated }
}

/** Bulk add/remove tags on a set of assets. Unknown ids are reported, not fatal. */
export async function applyTags(
  assetIds: string[],
  input: { add?: string[]; remove?: string[] },
): Promise<{ updated: number; failed: string[] }> {
  const add = normalizeTags(input.add ?? [])
  const remove = new Set(normalizeTags(input.remove ?? []))
  // Nothing to do → don't rewrite N manifests (each write triggers a
  // reindex + asset.changed broadcast).
  if (add.length === 0 && remove.size === 0) return { updated: 0, failed: [] }
  let updated = 0
  const failed: string[] = []
  for (const assetId of assetIds) {
    const manifest = getAsset(assetId)
    if (!manifest) {
      failed.push(assetId)
      continue
    }
    const tags = [...manifest.tags.filter((t) => !remove.has(t)), ...add]
    await updateMetadata(assetId, { tags })
    updated++
  }
  return { updated, failed }
}

/** Move the current pointer to an existing version (no file changes). */
export async function promoteVersion(assetId: string, version: number): Promise<AssetManifest> {
  return withAssetLock(assetId, async () => {
    const dirAbs = assetDirAbs(assetId)
    if (!dirAbs) throw new Error(`Invalid assetId: ${assetId}`)
    const manifest = readManifest(dirAbs)
    if (!manifest) throw new Error(`Asset not found: ${assetId}`)
    if (!manifest.versions.some((v) => v.version === version)) throw new Error(`Version ${version} not found in ${assetId}`)
    manifest.currentVersion = version
    manifest.updated = nowIso()
    mirrorDisplay(manifest)
    writeManifestAtomic(dirAbs, manifest)
    return manifest
  })
}

/** Delete a version's files + manifest entry. Auto-falls-back if it was current. */
export async function deleteVersion(assetId: string, version: number): Promise<AssetManifest> {
  return withAssetLock(assetId, async () => {
    const dirAbs = assetDirAbs(assetId)
    if (!dirAbs) throw new Error(`Invalid assetId: ${assetId}`)
    const manifest = readManifest(dirAbs)
    if (!manifest) throw new Error(`Asset not found: ${assetId}`)
    if (manifest.versions.length <= 1) throw new Error('Cannot delete the last remaining version; delete the asset instead')
    const idx = manifest.versions.findIndex((v) => v.version === version)
    if (idx === -1) throw new Error(`Version ${version} not found in ${assetId}`)

    const [removed] = manifest.versions.splice(idx, 1)
    removeFileQuietly(join(dirAbs, removed.file))
    if (removed.thumb) removeFileQuietly(join(dirAbs, removed.thumb))

    if (manifest.currentVersion === version) {
      // Auto-fallback to the highest-numbered remaining version.
      manifest.currentVersion = Math.max(...manifest.versions.map((v) => v.version))
    }
    manifest.updated = nowIso()
    mirrorDisplay(manifest)
    writeManifestAtomic(dirAbs, manifest)
    return manifest
  })
}

export interface AssetExportInput {
  fromVersion?: number
  /** Surface key — also the export name (one export per surface). */
  surface: string
  format: 'jpg' | 'png' | 'webp'
  width: number
  height: number
  quality?: number
}

const EXPORT_FORMATS = new Set(['jpg', 'png', 'webp'])
const MAX_EXPORT_DIM = 8192 // sharp/libvips practical ceiling; bounds the resize alloc

/** Render a derived export of a version, keyed (idempotent) by surface. */
export async function addExport(assetId: string, input: AssetExportInput): Promise<{ name: string; file: string; manifest: AssetManifest }> {
  // Validate every field that reaches the on-disk path or sharp — `format` is
  // appended to the filename (traversal if unchecked) and the dims/quality feed
  // resize/encode directly. Reject at the boundary before any I/O.
  if (!EXPORT_FORMATS.has(input.format)) throw new Error(`Invalid export format: ${input.format}`)
  for (const [label, dim] of [['width', input.width], ['height', input.height]] as const) {
    if (!Number.isInteger(dim) || dim <= 0 || dim > MAX_EXPORT_DIM) {
      throw new Error(`Invalid export ${label}: ${dim} (expected 1..${MAX_EXPORT_DIM})`)
    }
  }
  if (input.quality !== undefined && (!Number.isInteger(input.quality) || input.quality < 1 || input.quality > 100)) {
    throw new Error(`Invalid export quality: ${input.quality} (expected 1..100)`)
  }
  return withAssetLock(assetId, async () => {
    const dirAbs = assetDirAbs(assetId)
    if (!dirAbs) throw new Error(`Invalid assetId: ${assetId}`)
    const manifest = readManifest(dirAbs)
    if (!manifest) throw new Error(`Asset not found: ${assetId}`)
    const fromVersion = input.fromVersion ?? manifest.currentVersion
    const src = manifest.versions.find((v) => v.version === fromVersion)
    if (!src) throw new Error(`Version ${fromVersion} not found in ${assetId}`)

    // Surface is the export key AND the on-disk filename — reject anything
    // that isn't a safe slug to prevent path traversal on write.
    const name = input.surface
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid export surface: ${input.surface}`)
    const file = `exports/${name}.${input.format}`
    mkdirSync(join(dirAbs, 'exports'), { recursive: true })

    // Re-export of the same surface in a different format: drop the stale file.
    const prior = manifest.exports.find((e) => e.name === name)
    if (prior && prior.file !== file) removeFileQuietly(join(dirAbs, prior.file))

    const sharp = await loadSharp()
    if (!sharp) throw new Error('Image export requires sharp, but the native sharp package is unavailable for this runtime')
    let pipeline = sharp(join(dirAbs, src.file)).resize(input.width, input.height, { fit: 'cover' })
    if (input.format === 'jpg') pipeline = pipeline.jpeg({ quality: input.quality ?? 82 })
    else if (input.format === 'png') pipeline = pipeline.png()
    else pipeline = pipeline.webp({ quality: input.quality ?? 82 })
    await pipeline.toFile(join(dirAbs, file))

    const entry: AssetExport = {
      name, surface: input.surface, format: input.format, file,
      width: input.width, height: input.height, fromVersion, created: nowIso(),
    }
    const existing = manifest.exports.findIndex((e) => e.name === name)
    if (existing === -1) manifest.exports.push(entry)
    else manifest.exports[existing] = entry
    manifest.updated = entry.created
    writeManifestAtomic(dirAbs, manifest)
    return { name, file, manifest }
  })
}

/** Asset-level relink (change taskId). */
export async function relink(assetId: string, taskId: string | null): Promise<AssetManifest> {
  return withAssetLock(assetId, async () => {
    const dirAbs = assetDirAbs(assetId)
    if (!dirAbs) throw new Error(`Invalid assetId: ${assetId}`)
    const manifest = readManifest(dirAbs)
    if (!manifest) throw new Error(`Asset not found: ${assetId}`)
    manifest.taskId = taskId
    manifest.updated = nowIso()
    writeManifestAtomic(dirAbs, manifest)
    return manifest
  })
}

/** Asset-level retype (change type). */
export async function retype(assetId: string, type: AssetType): Promise<AssetManifest> {
  return withAssetLock(assetId, async () => {
    const dirAbs = assetDirAbs(assetId)
    if (!dirAbs) throw new Error(`Invalid assetId: ${assetId}`)
    const manifest = readManifest(dirAbs)
    if (!manifest) throw new Error(`Asset not found: ${assetId}`)
    manifest.type = type
    manifest.updated = nowIso()
    writeManifestAtomic(dirAbs, manifest)
    return manifest
  })
}

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
