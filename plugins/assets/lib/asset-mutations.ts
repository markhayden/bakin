/**
 * Versioned asset mutations.
 *
 * Every version/metadata/tag/export mutation, each serialized behind the
 * per-asset lock + atomic manifest write. Reads the create/read core (getAsset/
 * listAssets) and the shared leaves (extOf/nowIso) from asset-core — never the
 * asset-service barrel — so there is no import cycle.
 */
import { mkdirSync, copyFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { getMimeType, type AssetType } from './constants'
import { assetDirAbs } from './asset-id'
import { normalizeTags } from './tags'
import { withAssetLock } from './asset-lock'
import { emitAssetWritten } from './asset-events'
import { loadSharp, imageDimensions, generateThumbnail } from './asset-media'
import {
  readManifest,
  writeManifestAtomic,
  type AssetManifest,
  type AssetVersion,
  type AssetExport,
  type AssetGeneration,
} from './manifest'
import { createLogger } from '../../../src/core/logger'
import { extOf, getAsset, listAssets, nowIso } from './asset-core'

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
  /** Provenance when this version was absorbed from another asset (consolidate). */
  consolidatedFrom?: { assetId: string; version: number }
  /**
   * false ⇒ record the version WITHOUT moving currentVersion — the asset
   * staleness gate's suppression mode (a superseded/lost run's late save
   * must never displace the corrective attempt's current deliverable).
   * Default true (normal advance).
   */
  advanceCurrent?: boolean
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
      ...(input.consolidatedFrom ? { consolidatedFrom: input.consolidatedFrom } : {}),
    }
    manifest.versions.push(version)
    if (input.advanceCurrent !== false) manifest.currentVersion = nextVersion
    manifest.updated = created
    mirrorDisplay(manifest)
    writeManifestAtomic(dirAbs, manifest)
    emitAssetWritten({ assetId, version: nextVersion, op: 'add-version' })
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
    const tags = normalizeTags([...manifest.tags.filter((t) => !remove.has(t)), ...add])
    if (tags.length === manifest.tags.length && tags.every((t, i) => t === manifest.tags[i])) continue // no-op — skip the rewrite + reindex
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
  /**
   * Resize strategy. 'cover' (default) crops to exactly width×height — right for
   * fixed-aspect surface profiles. 'inside' scales down to fit within the
   * width×height box preserving aspect ratio and never upscaling — right for a
   * delivery-friendly copy that must stay recognizable (e.g. channel uploads).
   */
  fit?: 'cover' | 'inside'
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
    const resizeOpts = input.fit === 'inside'
      ? { fit: 'inside' as const, withoutEnlargement: true }
      : { fit: 'cover' as const }
    let pipeline = sharp(join(dirAbs, src.file)).resize(input.width, input.height, resizeOpts)
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
