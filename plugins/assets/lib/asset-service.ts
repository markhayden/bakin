/**
 * Versioned asset service (create + read).
 *
 * An asset is a directory `assets/store/{YYYY-MM}/{assetId}/` containing a
 * `manifest.json` (source of truth) plus per-version files `v{n}.{ext}` and
 * thumbnails `v{n}.thumb.jpg`. This module owns creation and read paths; version
 * mutations (addVersion/promote/delete/export) land in a later phase, all behind
 * the per-asset lock + atomic manifest write.
 *
 * Type-agnostic: images are the first consumer, but any asset type uses the
 * same spine.
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, renameSync, rmSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { getContentDir } from '../../../src/core/content-dir'
import { createLogger } from '../../../src/core/logger'
import { getMimeType, type AssetType } from './constants'
import { generateAssetId, assetDirRelPath, yearMonthFromAssetId } from './asset-id'
import { withAssetLock } from './asset-lock'
import { getManifestCached } from './manifest-cache'
import { taskAssetIndexRemove, taskAssetIndexUpsert } from './task-asset-index'
import {
  readManifest,
  writeManifestAtomic,
  type AssetManifest,
  type AssetVersion,
  type AssetExport,
  type AssetSource,
  type AssetGeneration,
} from './manifest'

const log = createLogger('asset-service')
type Sharp = typeof import('sharp')
let sharpModule: Promise<Sharp | null> | null = null

export interface AssetCreateInput {
  /** Absolute path to the source file to copy in as v1. */
  sourceFilePath: string
  type: AssetType
  agent: string
  taskId: string | null
  slug?: string
  op?: 'generate' | 'upload' | 'import'
  tool?: string | null
  prompt?: string | null
  promptHash?: string | null
  description?: string
  tags?: string[]
  source?: AssetSource
  generation?: AssetGeneration | null
}

export interface AssetFileRef {
  absPath: string
  mimeType: string
  size: number
  version: number
}

export interface AssetSummary {
  assetId: string
  type: string
  agent: string
  taskId: string | null
  created: string
  updated: string
  currentVersion: number
  versionCount: number
  description: string
  tags: string[]
  mimeType: string
  width: number | null
  height: number | null
  size: number
  hasThumb: boolean
}

function extOf(filePath: string): string {
  return extname(filePath).slice(1).toLowerCase()
}

function nowIso(): string {
  return new Date().toISOString()
}

async function loadSharp(): Promise<Sharp | null> {
  sharpModule ??= import('sharp')
    .then((mod): Sharp => (mod as unknown as { default?: Sharp }).default ?? (mod as unknown as Sharp))
    .catch((err) => {
      log.warn('sharp unavailable; image metadata/export support disabled', { error: err instanceof Error ? err.message : String(err) })
      return null
    })
  return sharpModule
}

async function imageDimensions(filePath: string): Promise<{ width: number | null; height: number | null }> {
  try {
    const sharp = await loadSharp()
    if (!sharp) return { width: null, height: null }
    const meta = await sharp(filePath).metadata()
    return { width: meta.width ?? null, height: meta.height ?? null }
  } catch {
    return { width: null, height: null }
  }
}

async function generateThumbnail(inputPath: string, outputPath: string, widthPx = 400): Promise<boolean> {
  const sharp = await loadSharp()
  if (sharp) {
    try {
      await sharp(inputPath)
        .resize({ width: widthPx, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(outputPath)
      return existsSync(outputPath)
    } catch (err) {
      log.warn('sharp thumbnail generation failed; trying ffmpeg fallback', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  try {
    // argv form (no shell) — paths/extensions are derived from client filenames,
    // so a shell string would expand $(...)/backticks in a crafted name.
    const r = spawnSync(
      'ffmpeg',
      ['-i', inputPath, '-vf', `scale=${widthPx}:-1`, '-q:v', '5', '-y', outputPath],
      { stdio: 'pipe', timeout: 30_000 },
    )
    return r.status === 0 && existsSync(outputPath)
  } catch {
    return false
  }
}

/** Allocate a fresh, collision-free assetId directory. */
function allocateAssetDir(slug: string): { assetId: string; dirAbs: string } {
  const contentDir = getContentDir()
  for (let i = 0; i < 8; i++) {
    const candidate = generateAssetId(slug)
    const rel = assetDirRelPath(candidate)
    if (rel && !existsSync(join(contentDir, rel))) {
      return { assetId: candidate, dirAbs: join(contentDir, rel) }
    }
  }
  throw new Error('Failed to allocate a unique assetId after 8 retries')
}

/** Create a new asset (v1) from a source file. */
export async function createAsset(input: AssetCreateInput): Promise<{ assetId: string; version: number; manifest: AssetManifest }> {
  if (!existsSync(input.sourceFilePath)) {
    throw new Error(`Source file not found: ${input.sourceFilePath}`)
  }
  const { assetId, dirAbs } = allocateAssetDir(input.slug ?? input.type)
  mkdirSync(dirAbs, { recursive: true })

  const ext = extOf(input.sourceFilePath) || 'bin'
  const file = `v1.${ext}`
  const fileAbs = join(dirAbs, file)
  copyFileSync(input.sourceFilePath, fileAbs)

  const isImage = input.type === 'images'
  const dims = isImage ? await imageDimensions(fileAbs) : { width: null, height: null }
  let thumb: string | null = null
  if (isImage) {
    thumb = await generateThumbnail(fileAbs, join(dirAbs, 'v1.thumb.jpg')) ? 'v1.thumb.jpg' : null
  }

  const created = nowIso()
  const version: AssetVersion = {
    version: 1,
    file,
    thumb,
    mimeType: getMimeType(input.sourceFilePath),
    size: statSync(fileAbs).size,
    width: dims.width,
    height: dims.height,
    created,
    description: (input.description ?? input.prompt ?? '').slice(0, 200),
    tags: input.tags ?? [],
    op: input.op ?? 'upload',
    parentVersion: null,
    tool: input.tool ?? null,
    prompt: input.prompt ?? null,
    promptHash: input.promptHash ?? null,
    generation: input.generation ?? null,
  }
  const manifest: AssetManifest = {
    assetId,
    type: input.type,
    source: input.source ?? { kind: 'upload', path: null },
    agent: input.agent,
    taskId: input.taskId,
    created,
    updated: created,
    currentVersion: 1,
    description: version.description,
    tags: version.tags,
    versions: [version],
    exports: [],
  }
  writeManifestAtomic(dirAbs, manifest)
  return { assetId, version: 1, manifest }
}

/** Read an asset's manifest (stat-validated cache), or null if missing/invalid. */
export function getAsset(assetId: string): AssetManifest | null {
  const rel = assetDirRelPath(assetId)
  if (!rel) return null
  return getManifestCached(assetId, join(getContentDir(), rel))
}

export function assetExists(assetId: string): boolean {
  return getAsset(assetId) !== null
}

/** Resolve a version from an already-loaded manifest (no further manifest reads). */
export function resolveFileFromManifest(manifest: AssetManifest, version?: number): AssetFileRef | null {
  const rel = assetDirRelPath(manifest.assetId)
  if (!rel) return null
  const target = version ?? manifest.currentVersion
  const ver = manifest.versions.find((v) => v.version === target)
  if (!ver) return null
  return {
    absPath: join(getContentDir(), rel, ver.file),
    mimeType: ver.mimeType,
    size: ver.size,
    version: target,
  }
}

/** Resolve an asset version (current by default) to an on-disk file reference. */
export function resolveFile(assetId: string, version?: number): AssetFileRef | null {
  const manifest = getAsset(assetId)
  return manifest ? resolveFileFromManifest(manifest, version) : null
}

function toSummary(manifest: AssetManifest): AssetSummary {
  const current = manifest.versions.find((v) => v.version === manifest.currentVersion) ?? manifest.versions[manifest.versions.length - 1]
  return {
    assetId: manifest.assetId,
    type: manifest.type,
    agent: manifest.agent,
    taskId: manifest.taskId,
    created: manifest.created,
    updated: manifest.updated,
    currentVersion: manifest.currentVersion,
    versionCount: manifest.versions.length,
    description: manifest.description,
    tags: manifest.tags,
    mimeType: current.mimeType,
    width: current.width,
    height: current.height,
    size: current.size,
    hasThumb: current.thumb !== null,
  }
}

/** Read one asset's current-version summary by id, or null if missing/invalid. */
export function getAssetSummary(assetId: string): AssetSummary | null {
  const manifest = getAsset(assetId)
  return manifest ? toSummary(manifest) : null
}

/** List assets (one summary per asset, current-version view), newest first. */
export function listAssets(filter?: { type?: AssetType; taskId?: string | null }): AssetSummary[] {
  const contentDir = getContentDir()
  const storeRoot = join(contentDir, 'assets', 'store')
  if (!existsSync(storeRoot)) return []
  const summaries: AssetSummary[] = []
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
      if (!yearMonthFromAssetId(assetId)) continue // skip non-asset dirs/files
      const manifest = getManifestCached(assetId, join(monthDir, assetId))
      if (!manifest) continue
      if (filter?.type && manifest.type !== filter.type) continue
      if (filter?.taskId !== undefined && manifest.taskId !== filter.taskId) continue
      summaries.push(toSummary(manifest))
    }
  }
  return summaries.sort((a, b) => b.created.localeCompare(a.created))
}

// ---------------------------------------------------------------------------
// Mutations — all serialized behind the per-asset lock + atomic manifest write.
// ---------------------------------------------------------------------------

function assetDirAbs(assetId: string): string | null {
  const rel = assetDirRelPath(assetId)
  return rel ? join(getContentDir(), rel) : null
}

/** Asset-level display fields mirror the current version's. */
function mirrorDisplay(manifest: AssetManifest): void {
  const current = manifest.versions.find((v) => v.version === manifest.currentVersion)
  if (current) {
    manifest.description = current.description
    manifest.tags = current.tags
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
  tags?: string[]
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
      tags: input.tags ?? [],
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

const TRASH_SEPARATOR = '__deleted-'

/** Trash the whole asset directory (recoverable via restoreAsset). */
export async function deleteAsset(assetId: string): Promise<{ trashName: string }> {
  return withAssetLock(assetId, async () => {
    const dirAbs = assetDirAbs(assetId)
    if (!dirAbs || !existsSync(dirAbs)) throw new Error(`Asset not found: ${assetId}`)
    const trashRoot = join(getContentDir(), 'assets', '.trash')
    mkdirSync(trashRoot, { recursive: true })
    const trashName = `${assetId}${TRASH_SEPARATOR}${Date.now()}`
    renameSync(dirAbs, join(trashRoot, trashName))
    // Trash bypasses the manifest-write choke point — evict explicitly.
    taskAssetIndexRemove(assetId)
    return { trashName }
  })
}

export interface TrashedAssetInfo {
  trashName: string
  assetId: string
  type: string
  agent: string
  deletedAt: number
  versionCount: number
  description: string
}

const TRASH_SUFFIX_RE = new RegExp(`(.+)${TRASH_SEPARATOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`)

/** List trashed versioned assets (directories under .trash/). */
export function listTrashedAssets(): TrashedAssetInfo[] {
  const trashRoot = join(getContentDir(), 'assets', '.trash')
  if (!existsSync(trashRoot)) return []
  const out: TrashedAssetInfo[] = []
  for (const entry of readdirSync(trashRoot)) {
    const m = TRASH_SUFFIX_RE.exec(entry)
    if (!m) continue
    const dir = join(trashRoot, entry)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    const manifest = readManifest(dir)
    out.push({
      trashName: entry,
      assetId: m[1],
      type: manifest?.type ?? 'other',
      agent: manifest?.agent ?? 'unknown',
      deletedAt: Number(m[2]),
      versionCount: manifest?.versions.length ?? 0,
      description: manifest?.description ?? '',
    })
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt)
}

/** Permanently delete one trashed asset directory. */
export function permanentlyDeleteTrashed(trashName: string): boolean {
  if (!trashName || trashName.includes('/') || trashName.includes('..')) return false
  const dir = join(getContentDir(), 'assets', '.trash', trashName)
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}

/** Empty the whole asset trash. Returns the count removed. */
export function emptyAssetTrash(): number {
  const trashRoot = join(getContentDir(), 'assets', '.trash')
  if (!existsSync(trashRoot)) return 0
  const entries = readdirSync(trashRoot)
  let n = 0
  for (const entry of entries) {
    try { rmSync(join(trashRoot, entry), { recursive: true, force: true }); n++ } catch { /* skip */ }
  }
  return n
}

/** Restore a trashed asset directory back into the store. */
export async function restoreAsset(trashName: string): Promise<{ assetId: string }> {
  // Reject path-traversal in the trash entry name (matches permanentlyDeleteTrashed).
  if (!trashName || trashName.includes('/') || trashName.includes('\\') || trashName.includes('..')) {
    throw new Error(`Invalid trash name: ${trashName}`)
  }
  const assetId = trashName.split(TRASH_SEPARATOR)[0]
  const rel = assetDirRelPath(assetId)
  if (!rel) throw new Error(`Cannot restore — invalid assetId in: ${trashName}`)
  return withAssetLock(assetId, async () => {
    const trashPath = join(getContentDir(), 'assets', '.trash', trashName)
    if (!existsSync(trashPath)) throw new Error(`Trashed asset not found: ${trashName}`)
    const destAbs = join(getContentDir(), rel)
    if (existsSync(destAbs)) throw new Error(`Cannot restore — an asset already exists at ${assetId}`)
    mkdirSync(join(destAbs, '..'), { recursive: true })
    renameSync(trashPath, destAbs)
    // Restore bypasses the manifest-write choke point — relink explicitly.
    const restored = readManifest(destAbs)
    if (restored) taskAssetIndexUpsert(restored.assetId, restored.taskId ?? null)
    return { assetId }
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

async function upsertFromSourceInner(sourcePath: string, input: AssetCreateInput): Promise<{ assetId: string; version: number; changed: boolean }> {
  const source = input.source ?? { kind: 'workspace-file' as const, path: sourcePath }
  const existingId = findBySourcePath(sourcePath)
  if (!existingId) {
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
    tags: input.tags,
  })
  return { assetId: next.assetId, version: next.version, changed: true }
}
