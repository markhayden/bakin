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

const log = createLogger('assets:index')

export interface IndexedAsset {
  path: string         // relative to content dir: assets/video/abc123/intro.mp4
  filename: string
  type: AssetType
  mimeType: string
  size: number
  metadata: SidecarMeta
}

const index = new Map<string, IndexedAsset>()

function isAssetFile(filename: string): boolean {
  return !filename.endsWith('.meta.json') && !filename.startsWith('.')
}

function getAssetsRoot(): string {
  return join(getContentDir(), 'assets')
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
  for (const typeName of ASSET_TYPES) {
    const typeDir = join(assetsRoot, typeName)
    if (!existsSync(typeDir)) continue

    const subdirs = readdirSync(typeDir).filter(d => {
      if (d.startsWith('.')) return false
      try { return statSync(join(typeDir, d)).isDirectory() } catch { return false }
    })

    for (const subdir of subdirs) {
      const dirPath = join(typeDir, subdir)
      try {
        const files = readdirSync(dirPath).filter(isAssetFile)
        for (const file of files) {
          const fullPath = join(dirPath, file)
          try {
            const stat = statSync(fullPath)
            if (!stat.isFile()) continue

            const relPath = `assets/${typeName}/${subdir}/${file}`
            const meta = readSidecar(fullPath) || createStub(fullPath)

            index.set(relPath, {
              path: relPath,
              filename: file,
              type: typeName as AssetType,
              mimeType: getMimeType(file),
              size: stat.size,
              metadata: meta,
            })
            count++
          } catch { /* skip unreadable files */ }
        }
      } catch { /* skip unreadable dirs */ }
    }
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
    const parts = relativePath.split('/')
    const typeName = (parts[1] || 'other') as AssetType

    const meta = readSidecar(fullPath) || createStub(fullPath)

    const asset: IndexedAsset = {
      path: relativePath,
      filename,
      type: typeName,
      mimeType: getMimeType(filename),
      size: stat.size,
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
    results = results.filter(a => a.metadata.taskId === filters.taskId)
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
