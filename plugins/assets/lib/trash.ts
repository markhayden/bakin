/**
 * Soft-delete (trash) management for assets.
 */
import { existsSync, mkdirSync, renameSync, readdirSync, readFileSync, statSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { createLogger } from '../../../src/core/logger'
import { getSidecarPath, type SidecarMeta } from './sidecar'
import { getAssetType, getMimeType } from './constants'
import { pathForFilename } from './path-for-filename'

const log = createLogger('assets:trash')

const DEFAULT_TTL_DAYS = 7

/** Trash filename format: {original}__deleted-{timestamp} */
const TRASH_PATTERN = /^(.+)__deleted-(\d+)$/

export interface TrashedAsset {
  filename: string           // trash filename (with __deleted- suffix)
  originalFilename: string
  type: string
  mimeType: string
  size: number
  deletedAt: string          // ISO string
  expiresAt: string          // ISO string
  metadata: SidecarMeta | null
}

/**
 * Parse a trash filename into its components.
 * Returns null if the filename doesn't match the trash pattern.
 */
export function parseTrashName(trashFilename: string): { originalFilename: string; deletedAt: number } | null {
  const m = trashFilename.match(TRASH_PATTERN)
  if (!m) return null
  return { originalFilename: m[1], deletedAt: parseInt(m[2], 10) }
}

/**
 * Move an asset and its sidecar to .trash/.
 * Returns true if successful.
 */
export function softDelete(assetFullPath: string, assetsRoot: string): boolean {
  const trashDir = join(assetsRoot, '.trash')
  if (!existsSync(trashDir)) {
    mkdirSync(trashDir, { recursive: true })
  }

  const timestamp = Date.now()
  const name = basename(assetFullPath)
  const trashName = `${name}__deleted-${timestamp}`

  try {
    // Move asset
    renameSync(assetFullPath, join(trashDir, trashName))

    // Move sidecar if it exists
    const sidecarPath = getSidecarPath(assetFullPath)
    if (existsSync(sidecarPath)) {
      renameSync(sidecarPath, join(trashDir, `${trashName}.meta.json`))
    }

    log.info('Asset soft-deleted', { path: assetFullPath, trashName })
    return true
  } catch (err) {
    log.error('Failed to soft-delete asset', err, { path: assetFullPath })
    return false
  }
}

/**
 * Clean up trash items older than TTL.
 * Returns number of items purged.
 */
export function cleanTrash(assetsRoot: string, ttlDays: number = DEFAULT_TTL_DAYS): number {
  const trashDir = join(assetsRoot, '.trash')
  if (!existsSync(trashDir)) return 0

  const cutoff = Date.now() - (ttlDays * 24 * 60 * 60 * 1000)
  let purged = 0

  try {
    const files = readdirSync(trashDir)
    for (const file of files) {
      const fullPath = join(trashDir, file)
      try {
        const stat = statSync(fullPath)
        if (stat.mtimeMs < cutoff) {
          rmSync(fullPath)
          purged++
        }
      } catch { /* skip unreadable files */ }
    }
  } catch (err) {
    log.warn('Failed to clean trash', err)
  }

  if (purged > 0) {
    log.info('Trash cleanup', { purged, ttlDays })
  }

  return purged
}

/**
 * List all items in .trash/ with parsed metadata.
 * Returns sorted by deletedAt descending (most recent first).
 */
export function listTrash(assetsRoot: string): TrashedAsset[] {
  const trashDir = join(assetsRoot, '.trash')
  if (!existsSync(trashDir)) return []

  const items: TrashedAsset[] = []

  try {
    const files = readdirSync(trashDir)
    for (const file of files) {
      // Skip sidecar files — they'll be read alongside their asset
      if (file.endsWith('.meta.json')) continue

      const parsed = parseTrashName(file)
      if (!parsed) continue

      const fullPath = join(trashDir, file)
      try {
        const stat = statSync(fullPath)
        const deletedAt = new Date(parsed.deletedAt)
        const expiresAt = new Date(parsed.deletedAt + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000)

        // Try to read sidecar
        let metadata: SidecarMeta | null = null
        const sidecarPath = join(trashDir, `${file}.meta.json`)
        if (existsSync(sidecarPath)) {
          try {
            metadata = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
          } catch { /* invalid sidecar */ }
        }

        items.push({
          filename: file,
          originalFilename: parsed.originalFilename,
          type: getAssetType(parsed.originalFilename),
          mimeType: getMimeType(parsed.originalFilename),
          size: stat.size,
          deletedAt: deletedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          metadata,
        })
      } catch { /* skip unreadable files */ }
    }
  } catch (err) {
    log.warn('Failed to list trash', err)
  }

  // Sort by deletedAt descending
  items.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime())
  return items
}

/**
 * Restore a trashed asset back to the store.
 * Under filename-as-identity, the destination is a pure function of the
 * original canonical filename (`assets/store/{YYYY-MM}/{filename}`).
 * Returns the restored relative path or null on failure.
 */
export function restoreAsset(trashFilename: string, assetsRoot: string): string | null {
  const trashDir = join(assetsRoot, '.trash')
  const trashPath = join(trashDir, trashFilename)

  if (!existsSync(trashPath)) {
    log.warn('Trash item not found', { trashFilename })
    return null
  }

  const parsed = parseTrashName(trashFilename)
  if (!parsed) {
    log.warn('Invalid trash filename', { trashFilename })
    return null
  }

  const rel = pathForFilename(parsed.originalFilename)
  if (!rel) {
    log.warn('Non-canonical original filename — cannot restore', { trashFilename, originalFilename: parsed.originalFilename })
    return null
  }

  // rel is `assets/store/{YYYY-MM}/{filename}` — strip the leading
  // `assets/` to get the path relative to assetsRoot.
  const targetPath = join(assetsRoot, rel.replace(/^assets\//, ''))
  const targetDir = join(targetPath, '..')
  const sidecarTrashPath = join(trashDir, `${trashFilename}.meta.json`)

  try {
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true })
    }

    renameSync(trashPath, targetPath)

    // Restore sidecar if it exists
    if (existsSync(sidecarTrashPath)) {
      renameSync(sidecarTrashPath, `${targetPath}.meta.json`)
    }

    log.info('Asset restored from trash', { trashFilename, restoredPath: rel })
    return rel
  } catch (err) {
    log.error('Failed to restore asset', err, { trashFilename })
    return null
  }
}

/**
 * Permanently delete a single item from .trash/.
 * Returns true if successful.
 */
export function permanentDelete(trashFilename: string, assetsRoot: string): boolean {
  const trashDir = join(assetsRoot, '.trash')
  const trashPath = join(trashDir, trashFilename)

  if (!existsSync(trashPath)) {
    log.warn('Trash item not found for permanent delete', { trashFilename })
    return false
  }

  try {
    rmSync(trashPath)

    // Remove sidecar too
    const sidecarPath = join(trashDir, `${trashFilename}.meta.json`)
    if (existsSync(sidecarPath)) {
      rmSync(sidecarPath)
    }

    log.info('Asset permanently deleted', { trashFilename })
    return true
  } catch (err) {
    log.error('Failed to permanently delete', err, { trashFilename })
    return false
  }
}

/**
 * Empty the entire trash. Returns number of items deleted.
 */
export function emptyTrash(assetsRoot: string): number {
  const trashDir = join(assetsRoot, '.trash')
  if (!existsSync(trashDir)) return 0

  let deleted = 0

  try {
    const files = readdirSync(trashDir)
    for (const file of files) {
      try {
        rmSync(join(trashDir, file))
        // Only count non-sidecar files as "items"
        if (!file.endsWith('.meta.json')) deleted++
      } catch { /* skip */ }
    }
  } catch (err) {
    log.warn('Failed to empty trash', err)
  }

  if (deleted > 0) {
    log.info('Trash emptied', { deleted })
  }

  return deleted
}
