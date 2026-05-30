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

/** Build the search document for a versioned asset from its current version. */
export async function buildVersionedAssetSearchDoc(manifest: AssetManifest, assetId: string): Promise<Record<string, unknown>> {
  const ym = yearMonthFromAssetId(assetId)
  const current = manifest.versions.find((v) => v.version === manifest.currentVersion) ?? manifest.versions[manifest.versions.length - 1]
  const relFromAssetsRoot = `store/${ym}/${assetId}/${current.file}`
  const absPath = join(getContentDir(), 'assets', relFromAssetsRoot)
  const isRaster = manifest.type === 'images' && RASTER_RE.test(current.file)
  const content = await extractAssetContent(absPath, current.file).catch(() => '')
  return {
    description: manifest.description || '',
    tags: (manifest.tags || []).join(', '),
    agent: manifest.agent || '',
    task_id: manifest.taskId || '',
    asset_type: manifest.type,
    file_name: assetId,
    tool: current.tool || '',
    updated_at: manifest.updated || new Date().toISOString(),
    content,
    image_url: isRaster ? buildAssetFileUrl(relFromAssetsRoot) : '',
  }
}
