/**
 * In-memory asset index. Built from filesystem on startup,
 * kept up-to-date by the file watcher.
 */
import { existsSync, readdirSync, statSync } from 'fs'
import { join, relative, extname } from 'path'
import { createLogger } from '../../../src/core/logger'
import { getContentDir } from '../../../src/core/content-dir'
import { readSidecar, createStub, type SidecarMeta } from './sidecar'
import { getAssetType, getMimeType, ASSET_TYPES, SPECIAL_DIRS } from './constants'
import type { AssetType } from './constants'
import { setFilename, unsetFilename, clearResolver } from './resolver'
import { yearMonthFromFilename } from './path-for-filename'

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
 * Yield every asset file under `assets/`, walking both the new
 * `store/{YYYY-MM}/` layout and the legacy `{type}/{taskId}/` layout.
 *
 * The legacy branch is exercised during the migration window and by
 * tests that seed fixtures in the old shape. Post-migration (C6/C7) it
 * becomes a no-op and is dropped in C8.
 */
function* walkAssetFiles(assetsRoot: string): Generator<{ relPath: string; fallbackType: AssetType }> {
  // New layout: assets/store/{YYYY-MM}/{file}
  const storeRoot = join(assetsRoot, 'store')
  if (existsSync(storeRoot)) {
    let months: string[]
    try {
      months = readdirSync(storeRoot).filter(d => {
        if (d.startsWith('.')) return false
        try { return statSync(join(storeRoot, d)).isDirectory() } catch { return false }
      })
    } catch { months = [] }

    for (const month of months) {
      const monthDir = join(storeRoot, month)
      let files: string[]
      try { files = readdirSync(monthDir).filter(isAssetFile) } catch { continue }
      for (const file of files) {
        // Type isn't encoded in the path — fall back to extension-derived type
        // for callers that need a default before the sidecar loads.
        yield { relPath: `assets/store/${month}/${file}`, fallbackType: getAssetType(file) as AssetType }
      }
    }
  }

  // Legacy layout: assets/{type}/{taskId}/{file}
  for (const typeName of ASSET_TYPES) {
    const typeDir = join(assetsRoot, typeName)
    if (!existsSync(typeDir)) continue
    let subdirs: string[]
    try {
      subdirs = readdirSync(typeDir).filter(d => {
        if (d.startsWith('.')) return false
        try { return statSync(join(typeDir, d)).isDirectory() } catch { return false }
      })
    } catch { continue }
    for (const subdir of subdirs) {
      const dirPath = join(typeDir, subdir)
      let files: string[]
      try { files = readdirSync(dirPath).filter(isAssetFile) } catch { continue }
      for (const file of files) {
        yield { relPath: `assets/${typeName}/${subdir}/${file}`, fallbackType: typeName as AssetType }
      }
    }
  }
}

/**
 * Scan the assets directory and build the full index.
 */
export function buildIndex(): void {
  index.clear()
  clearResolver()
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
      if (!filename.endsWith('.meta.json')) {
        setFilename(filename, relPath)
      }
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
    const existing = index.get(relativePath)
    if (existing && !existing.filename.endsWith('.meta.json')) {
      unsetFilename(existing.filename, relativePath)
    }
    index.delete(relativePath)
    return null
  }

  try {
    const stat = statSync(fullPath)
    if (!stat.isFile()) return null

    const filename = relativePath.split('/').pop() || ''
    const parts = relativePath.split('/')
    // Legacy layout encodes the type in parts[1]; the store/ layout uses
    // literal "store" and carries the type in the sidecar instead. Fall back
    // to an extension-derived type so records without a sidecar still get
    // something sensible.
    const pathTypeName: AssetType = parts[1] === 'store'
      ? (getAssetType(filename) as AssetType)
      : ((parts[1] || 'other') as AssetType)

    const meta = readSidecar(fullPath) || createStub(fullPath)
    const effectiveType: AssetType = meta.type ?? pathTypeName

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
    if (!filename.endsWith('.meta.json')) {
      setFilename(filename, relativePath)
    }
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
  const existing = index.get(relativePath)
  if (existing && !existing.filename.endsWith('.meta.json')) {
    unsetFilename(existing.filename, relativePath)
  }
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
