/**
 * Versioned asset core — creation + read paths.
 *
 * An asset is a directory `assets/store/{YYYY-MM}/{assetId}/` containing a
 * `manifest.json` (source of truth) plus per-version files `v{n}.{ext}` and
 * thumbnails `v{n}.thumb.jpg`. This module owns creation and read paths plus the
 * shared leaf helpers (extOf/nowIso) used by the mutation + upsert clusters;
 * those siblings import from here, never from the asset-service barrel.
 *
 * Type-agnostic: images are the first consumer, but any asset type uses the
 * same spine.
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { getContentDir } from '../../../src/core/content-dir'
import { getMimeType, type AssetType } from './constants'
import { generateAssetId, assetDirRelPath, yearMonthFromAssetId } from './asset-id'
import { normalizeTags } from './tags'
import { getManifestCached } from './manifest-cache'
import { imageDimensions, generateThumbnail } from './asset-media'
import {
  writeManifestAtomic,
  type AssetManifest,
  type AssetVersion,
  type AssetSource,
  type AssetGeneration,
} from './manifest'

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

export function extOf(filePath: string): string {
  return extname(filePath).slice(1).toLowerCase()
}

export function nowIso(): string {
  return new Date().toISOString()
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
    tags: normalizeTags(input.tags ?? []),
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
export function listAssets(filter?: { type?: AssetType; taskId?: string | null; tags?: string[] }): AssetSummary[] {
  const contentDir = getContentDir()
  const storeRoot = join(contentDir, 'assets', 'store')
  if (!existsSync(storeRoot)) return []
  // AND semantics: an asset must carry every requested tag (normalized) to match.
  const wantTags = filter?.tags && filter.tags.length > 0 ? normalizeTags(filter.tags) : null
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
      if (wantTags) {
        const have = new Set(manifest.tags)
        if (!wantTags.every(tag => have.has(tag))) continue
      }
      summaries.push(toSummary(manifest))
    }
  }
  return summaries.sort((a, b) => b.created.localeCompare(a.created))
}
