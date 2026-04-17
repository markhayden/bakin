/**
 * Relink/unlink an asset — physically moves it between task directories
 * and updates sidecar metadata.
 */
import { existsSync, mkdirSync, renameSync, readdirSync } from 'fs'
import { join, basename, dirname } from 'path'
import { randomBytes } from 'crypto'
import { getContentDir } from '../../../src/core/content-dir'
import { readSidecar, writeSidecar, getSidecarPath } from './sidecar'
import { removeAsset, upsertAsset, detectVariant } from './asset-index'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('assets:relink')

export interface RelinkParams {
  assetPath: string         // relative to content dir, e.g. "assets/images/task123/file.png"
  newTaskId: string | null  // null = unlink → move to _unlinked/
}

export interface RelinkResult {
  ok: boolean
  oldPath: string
  newPath?: string
  error?: string
  [key: string]: unknown
}

export function relinkAsset(params: RelinkParams): RelinkResult {
  const { assetPath, newTaskId } = params
  const contentDir = getContentDir()

  // Validate path
  if (assetPath.includes('..')) {
    return { ok: false, oldPath: assetPath, error: 'Invalid path: contains ..' }
  }
  if (!assetPath.startsWith('assets/')) {
    return { ok: false, oldPath: assetPath, error: 'Invalid path: must start with assets/' }
  }

  const fullPath = join(contentDir, assetPath)
  if (!existsSync(fullPath)) {
    return { ok: false, oldPath: assetPath, error: 'Asset not found' }
  }

  // Parse path: assets/{type}/{taskId}/{filename}
  const parts = assetPath.split('/')
  if (parts.length < 4) {
    return { ok: false, oldPath: assetPath, error: 'Invalid asset path structure' }
  }

  const type = parts[1]
  const oldTaskId = parts[2]
  const filename = parts.slice(3).join('/')
  const effectiveNewTaskId = newTaskId ?? '_unlinked'

  // Validate newTaskId doesn't contain path separators or traversal
  if (effectiveNewTaskId.includes('/') || effectiveNewTaskId.includes('\\') || effectiveNewTaskId.includes('..')) {
    return { ok: false, oldPath: assetPath, error: 'Invalid taskId: contains path separators' }
  }

  // No-op if same task
  if (oldTaskId === effectiveNewTaskId) {
    return { ok: true, oldPath: assetPath, newPath: assetPath }
  }

  // Build target directory
  const newTaskDir = join(contentDir, 'assets', type, effectiveNewTaskId)
  mkdirSync(newTaskDir, { recursive: true })

  // Handle filename collision in target
  let destFilename = filename
  if (existsSync(join(newTaskDir, destFilename))) {
    const dotIdx = destFilename.lastIndexOf('.')
    const stem = dotIdx > 0 ? destFilename.substring(0, dotIdx) : destFilename
    const ext = dotIdx > 0 ? destFilename.substring(dotIdx) : ''
    const suffix = randomBytes(2).toString('hex')
    destFilename = `${stem}-${suffix}${ext}`
  }

  const newRelPath = `assets/${type}/${effectiveNewTaskId}/${destFilename}`
  const newFullPath = join(newTaskDir, destFilename)

  // Move primary file
  renameSync(fullPath, newFullPath)
  removeAsset(assetPath)

  // Move sidecar
  const oldSidecarPath = getSidecarPath(fullPath)
  const newSidecarPath = getSidecarPath(newFullPath)
  if (existsSync(oldSidecarPath)) {
    renameSync(oldSidecarPath, newSidecarPath)
  }

  // Move variants (.thumb.*, .opt.*)
  const oldDir = dirname(fullPath)
  const primaryStem = getPrimaryStem(basename(fullPath))
  try {
    const dirFiles = readdirSync(oldDir)
    for (const f of dirFiles) {
      const variant = detectVariant(f)
      if (variant && variant.baseStem === primaryStem) {
        const oldVariantPath = join(oldDir, f)
        const newVariantPath = join(newTaskDir, f)
        renameSync(oldVariantPath, newVariantPath)
        removeAsset(`assets/${type}/${oldTaskId}/${f}`)
      }
    }
  } catch { /* variant move is non-critical */ }

  // Update sidecar taskId
  const meta = readSidecar(newFullPath)
  if (meta) {
    meta.taskId = newTaskId // null for unlinked, string for linked
    writeSidecar(newFullPath, meta)
  }

  // Sync the in-memory index (and resolver) to the new location before the
  // handler indexes the search doc. Without this, the watcher's unlink event
  // on the old path can fire before its add event on the new path, which
  // would see an empty resolver and wipe the search doc we just indexed.
  upsertAsset(newRelPath)

  log.info('Asset relinked', { from: assetPath, to: newRelPath, taskId: newTaskId })
  return { ok: true, oldPath: assetPath, newPath: newRelPath }
}

/** Extract the stem from a filename (without extension). */
function getPrimaryStem(filename: string): string {
  const dotIdx = filename.lastIndexOf('.')
  return dotIdx > 0 ? filename.substring(0, dotIdx) : filename
}
