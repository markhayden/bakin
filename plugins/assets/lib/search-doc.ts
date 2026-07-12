/**
 * Search documents for versioned assets. One row per asset, keyed by assetId,
 * built from the CURRENT version. The manifest is the indexed unit + reindex
 * trigger; version/thumb/export files never get their own row.
 */
import { join } from 'node:path'
import { getContentDir } from '../../../src/core/content-dir'
import { isValidAssetId, yearMonthFromAssetId } from './asset-id'
import { extractAssetContent } from './content-extractor'
import { buildAssetFileUrl } from './asset-url'
import type { AssetManifest } from './manifest'

/**
 * Classify an `assets/...` relative path. Returns the assetId + whether the
 * path is the asset's manifest, or null for legacy flat assets
 * (`assets/store/<ym>/<filename>` — these have an extension and so are not
 * valid assetIds).
 */
export function versionedAssetPath(rel: string): { assetId: string; isManifest: boolean } | null {
  const parts = rel.split('/')
  if (parts.length < 5 || parts[0] !== 'assets' || parts[1] !== 'store') return null
  const assetId = parts[3]
  if (!isValidAssetId(assetId)) return null
  return { assetId, isManifest: parts.length === 5 && parts[4] === 'manifest.json' }
}

const RASTER_RE = /\.(png|jpe?g|gif|webp|bmp)$/i
const AUDIO_RE = /\.(mp3|wav|flac|ogg|m4a|aac)$/i
// Formats every media-embedding engine can decode. WebP/BMP originals crash
// the write wholesale, so
// media_url prefers the JPEG thumb rendition; embedders downscale to ~224px
// anyway, so the thumb costs nothing in similarity quality.
const EMBED_SAFE_RE = /\.(png|jpe?g|gif|webp)$/i

// Cache extracted text per (assetId, version, size). Version files are
// immutable, so metadata-only manifest writes (relink/retype/promote/addExport)
// re-index without re-running pdf-parse / re-reading the file on the hot path.
const contentCache = new Map<string, string>()
const CONTENT_CACHE_MAX = 256

/** Build the search document for a versioned asset from its current version. */
export async function buildVersionedAssetSearchDoc(manifest: AssetManifest, assetId: string): Promise<Record<string, unknown>> {
  const ym = yearMonthFromAssetId(assetId)
  const current = manifest.versions.find((v) => v.version === manifest.currentVersion) ?? manifest.versions[manifest.versions.length - 1]
  const relFromAssetsRoot = `store/${ym}/${assetId}/${current.file}`
  const absPath = join(getContentDir(), 'assets', relFromAssetsRoot)
  const isRaster = manifest.type === 'images' && RASTER_RE.test(current.file)
  // Audio rides the same media-embedding leg (CLAP half of the multimodal
  // embedder) — Bakin's job is just the MIME/URL wiring (spec D12).
  const isAudio = manifest.type === 'audio' && AUDIO_RE.test(current.file)
  const cacheKey = `${assetId}:${current.version}:${current.size}`
  let content = contentCache.get(cacheKey)
  if (content === undefined) {
    content = await extractAssetContent(absPath, current.file).catch(() => '')
    if (contentCache.size >= CONTENT_CACHE_MAX) contentCache.clear()
    contentCache.set(cacheKey, content)
  }
  return {
    description: manifest.description || '',
    tags: (manifest.tags || []).join(', '),
    // Keyword array for per-tag facet buckets (the comma-joined `tags` text
    // field can't facet — a terms agg would bucket the whole string).
    tags_facet: manifest.tags || [],
    agent: manifest.agent || '',
    task_id: manifest.taskId || '',
    asset_type: manifest.type,
    file_name: assetId,
    tool: current.tool || '',
    // Generation provenance: surface is searchable/embedded ("instagram"
    // matches instagram-feed-portrait); provider/model are facet-only —
    // embedding them would flatten similarity across generated assets.
    surface: current.generation?.surface ?? '',
    provider: current.generation?.provider ?? '',
    model: current.generation?.model ?? '',
    updated_at: manifest.updated || new Date().toISOString(),
    content,
    // Derived enrichment (D8): the vision model's caption/OCR/tags give
    // BM25 and the text-embedding leg real content for images and audio.
    caption: manifest.enrichment?.caption ?? '',
    ocr_text: manifest.enrichment?.ocrText ?? '',
    suggested_tags: (manifest.enrichment?.suggestedTags ?? []).join(', '),
    transcript: manifest.enrichment?.transcript ?? '',
    summary: manifest.enrichment?.summary ?? '',
    media_url: buildMediaUrl(isRaster, isAudio, ym, assetId, current, relFromAssetsRoot),
  }
}

function buildMediaUrl(
  isRaster: boolean,
  isAudio: boolean,
  ym: string | null,
  assetId: string,
  current: { file: string; thumb: string | null },
  relFromAssetsRoot: string,
): string {
  if (isAudio) return buildAssetFileUrl(relFromAssetsRoot)
  if (!isRaster) return ''
  if (current.thumb) return buildAssetFileUrl(`store/${ym}/${assetId}/${current.thumb}`)
  // No thumb: only hand over originals the engine is known to decode —
  // an undecodable media_url poisons the row's ENTIRE write (text legs too).
  return EMBED_SAFE_RE.test(current.file) ? buildAssetFileUrl(relFromAssetsRoot) : ''
}
