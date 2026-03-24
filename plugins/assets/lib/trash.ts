/**
 * Soft-delete (trash) management for assets.
 */
import { existsSync, mkdirSync, renameSync, readdirSync, statSync, rmSync } from 'fs'
import { join, dirname, basename } from 'path'
import { createLogger } from '../../../src/core/logger'
import { getSidecarPath } from './sidecar'

const log = createLogger('assets:trash')

const DEFAULT_TTL_DAYS = 7

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
