/**
 * In-memory asset index. Built from filesystem on startup,
 * kept up-to-date by the file watcher.
 */
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../../../src/core/logger'
import { getContentDir } from '../../../src/core/content-dir'
import { readSidecar, createStub, type SidecarMeta } from './sidecar'
import { getAssetType, getMimeType } from './constants'
import type { AssetType } from './constants'

const log = createLogger('assets:index')

export interface IndexedAsset {
  path: string         // relative to content dir: assets/video/abc123/intro.mp4
  filename: string
  type: AssetType
  mimeType: string
  size: number
  mtimeMs: number      // file mtime for cache busting
  metadata: SidecarMeta
}

export type VariantRole = 'thumbnail' | 'optimized' | 'webp'

export interface AssetVariant {
  role: VariantRole
  asset: IndexedAsset
}

export interface GroupedAsset {
  primary: IndexedAsset
  variants: AssetVariant[]
}

/**
 * Variant detection patterns. Order matters — first match wins.
 * The regex captures the base stem (everything before the variant suffix).
 */
const VARIANT_PATTERNS: { regex: RegExp; role: VariantRole }[] = [
  { regex: /^(.+)\.thumb\.\w+$/, role: 'thumbnail' },
  { regex: /^(.+)\.opt\.\w+$/, role: 'optimized' },
]

/**
 * Detect if a filename is a variant of another asset.
 * Returns the base stem and role, or null if it's a primary asset.
 */
export function detectVariant(filename: string): { baseStem: string; role: VariantRole } | null {
  for (const { regex, role } of VARIANT_PATTERNS) {
    const m = filename.match(regex)
    if (m) return { baseStem: m[1], role }
  }
  return null
}

const index = new Map<string, IndexedAsset>()

function isAssetFile(filename: string): boolean {
  return !filename.endsWith('.meta.json') && !filename.startsWith('.')
}

function getAssetsRoot(): string {
  return join(getContentDir(), 'assets')
}

/**
 * Yield every asset file under `assets/store/{YYYY-MM}/`. Type is not
 * encoded in the path — callers fall back to extension-derived type until
 * the sidecar loads.
 */
function* walkAssetFiles(assetsRoot: string): Generator<{ relPath: string; fallbackType: AssetType }> {
  const storeRoot = join(assetsRoot, 'store')
  if (!existsSync(storeRoot)) return

  let months: string[]
  try {
    months = readdirSync(storeRoot).filter(d => {
      if (d.startsWith('.')) return false
      try { return statSync(join(storeRoot, d)).isDirectory() } catch { return false }
    })
  } catch { return }

  for (const month of months) {
    const monthDir = join(storeRoot, month)
    let files: string[]
    try { files = readdirSync(monthDir).filter(isAssetFile) } catch { continue }
    for (const file of files) {
      yield { relPath: `assets/store/${month}/${file}`, fallbackType: getAssetType(file) as AssetType }
    }
  }
}

/**
 * Scan the assets directory and build the full index.
 */
export function buildIndex(): void {
  index.clear()
  const assetsRoot = getAssetsRoot()

  if (!existsSync(assetsRoot)) {
    log.warn('Assets directory not found', { path: assetsRoot })
    return
  }

  let count = 0
  for (const { relPath, fallbackType } of walkAssetFiles(assetsRoot)) {
    const fullPath = join(assetsRoot, relPath.replace(/^assets\//, ''))
    try {
      const stat = statSync(fullPath)
      if (!stat.isFile()) continue

      const meta = readSidecar(fullPath) || createStub(fullPath)
      const effectiveType: AssetType = meta.type ?? fallbackType
      const filename = relPath.split('/').pop() || ''

      index.set(relPath, {
        path: relPath,
        filename,
        type: effectiveType,
        mimeType: getMimeType(filename),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        metadata: meta,
      })
      count++
    } catch { /* skip unreadable files */ }
  }

  log.info('Asset index built', { count })
}

/**
 * Add or update a single asset in the index.
 */
export function upsertAsset(relativePath: string): IndexedAsset | null {
  const contentDir = getContentDir()
  const fullPath = join(contentDir, relativePath)

  if (!existsSync(fullPath)) {
    index.delete(relativePath)
    return null
  }

  try {
    const stat = statSync(fullPath)
    if (!stat.isFile()) return null

    const filename = relativePath.split('/').pop() || ''
    const fallbackType = getAssetType(filename) as AssetType

    const meta = readSidecar(fullPath) || createStub(fullPath)
    const effectiveType: AssetType = meta.type ?? fallbackType

    const asset: IndexedAsset = {
      path: relativePath,
      filename,
      type: effectiveType,
      mimeType: getMimeType(filename),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      metadata: meta,
    }

    index.set(relativePath, asset)
    return asset
  } catch (err) {
    log.warn('Failed to index asset', err, { path: relativePath })
    return null
  }
}

/**
 * Remove an asset from the index.
 */
export function removeAsset(relativePath: string): void {
  index.delete(relativePath)
}

/**
 * Get all indexed assets, optionally filtered.
 */
export function listAssets(filters?: {
  type?: string
  agent?: string
  taskId?: string
  includeChildren?: boolean
  tag?: string
}): IndexedAsset[] {
  let results = Array.from(index.values())

  if (filters?.type) {
    results = results.filter(a => a.type === filters.type)
  }
  if (filters?.agent) {
    results = results.filter(a => a.metadata.agent === filters.agent)
  }
  if (filters?.taskId) {
    if (filters.includeChildren) {
      // Match exact taskId OR child tasks (taskId--*)
      const prefix = filters.taskId + '--'
      results = results.filter(a => a.metadata.taskId === filters.taskId || a.metadata.taskId?.startsWith(prefix))
    } else {
      results = results.filter(a => a.metadata.taskId === filters.taskId)
    }
  }
  if (filters?.tag) {
    const tag = filters.tag.toLowerCase()
    results = results.filter(a => a.metadata.tags?.some(t => t.toLowerCase() === tag))
  }

  // Sort by created date, newest first
  results.sort((a, b) => {
    const da = new Date(a.metadata.created).getTime()
    const db = new Date(b.metadata.created).getTime()
    return db - da
  })

  return results
}

/**
 * Get a single asset by path.
 */
export function getAsset(relativePath: string): IndexedAsset | undefined {
  return index.get(relativePath)
}

/**
 * Get count of indexed assets.
 */
export function getCount(): number {
  return index.size
}

/**
 * List assets with variants grouped under their primary asset.
 * Thumbnails (*.thumb.*) and other variants are nested instead of
 * appearing as separate entries.
 */
export function listGroupedAssets(filters?: Parameters<typeof listAssets>[0]): GroupedAsset[] {
  const all = listAssets(filters)

  // Partition into variants and primaries
  const variantMap = new Map<string, AssetVariant>()
  const primaries: IndexedAsset[] = []

  for (const asset of all) {
    const v = detectVariant(asset.filename)
    if (v) {
      // Key by directory + base stem so matching is scoped to same task folder
      const dir = asset.path.substring(0, asset.path.lastIndexOf('/'))
      variantMap.set(`${dir}/${v.baseStem}`, { role: v.role, asset })
    } else {
      primaries.push(asset)
    }
  }

  // Attach variants to their primaries
  return primaries.map(p => {
    const dir = p.path.substring(0, p.path.lastIndexOf('/'))
    // Primary stem: filename without extension (e.g., "20260327-foo" from "20260327-foo.jpg")
    const dotIdx = p.filename.lastIndexOf('.')
    const stem = dotIdx > 0 ? p.filename.substring(0, dotIdx) : p.filename
    const key = `${dir}/${stem}`

    const variants: AssetVariant[] = []
    const variant = variantMap.get(key)
    if (variant) {
      variants.push(variant)
      variantMap.delete(key)
    }

    return { primary: p, variants }
  })
}
