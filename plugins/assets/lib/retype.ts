import { existsSync, mkdirSync, renameSync, readdirSync } from 'fs'
import { join, basename, dirname } from 'path'
import { randomBytes } from 'crypto'
import { getContentDir } from '../../../src/core/content-dir'
import { getSidecarPath } from './sidecar'
import { removeAsset, upsertAsset, detectVariant } from './asset-index'
import { ASSET_TYPES, type AssetType } from './constants'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('assets:retype')

export interface RetypeParams {
  assetPath: string
  newType: AssetType
}

export interface RetypeResult {
  ok: boolean
  oldPath: string
  newPath?: string
  error?: string
  [key: string]: unknown
}

export function retypeAsset(params: RetypeParams): RetypeResult {
  const { assetPath, newType } = params
  const contentDir = getContentDir()

  if (assetPath.includes('..')) {
    return { ok: false, oldPath: assetPath, error: 'Invalid path: contains ..' }
  }
  if (!assetPath.startsWith('assets/')) {
    return { ok: false, oldPath: assetPath, error: 'Invalid path: must start with assets/' }
  }
  if (!ASSET_TYPES.includes(newType)) {
    return { ok: false, oldPath: assetPath, error: `Invalid type: ${newType}` }
  }

  const fullPath = join(contentDir, assetPath)
  if (!existsSync(fullPath)) {
    return { ok: false, oldPath: assetPath, error: 'Asset not found' }
  }

  const parts = assetPath.split('/')
  if (parts.length < 4) {
    return { ok: false, oldPath: assetPath, error: 'Invalid asset path structure' }
  }

  const oldType = parts[1]
  const taskId = parts[2]
  const filename = parts.slice(3).join('/')

  if (oldType === newType) {
    return { ok: true, oldPath: assetPath, newPath: assetPath }
  }

  const newTaskDir = join(contentDir, 'assets', newType, taskId)
  mkdirSync(newTaskDir, { recursive: true })

  let destFilename = filename
  if (existsSync(join(newTaskDir, destFilename))) {
    const dotIdx = destFilename.lastIndexOf('.')
    const stem = dotIdx > 0 ? destFilename.substring(0, dotIdx) : destFilename
    const ext = dotIdx > 0 ? destFilename.substring(dotIdx) : ''
    const suffix = randomBytes(2).toString('hex')
    destFilename = `${stem}-${suffix}${ext}`
  }

  const newRelPath = `assets/${newType}/${taskId}/${destFilename}`
  const newFullPath = join(newTaskDir, destFilename)

  renameSync(fullPath, newFullPath)
  removeAsset(assetPath)

  const oldSidecarPath = getSidecarPath(fullPath)
  const newSidecarPath = getSidecarPath(newFullPath)
  if (existsSync(oldSidecarPath)) {
    renameSync(oldSidecarPath, newSidecarPath)
  }

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
        removeAsset(`assets/${oldType}/${taskId}/${f}`)
      }
    }
  } catch { /* variant move is non-critical */ }

  upsertAsset(newRelPath)

  log.info('Asset retyped', { from: assetPath, to: newRelPath, newType })
  return { ok: true, oldPath: assetPath, newPath: newRelPath }
}

function getPrimaryStem(filename: string): string {
  const dotIdx = filename.lastIndexOf('.')
  return dotIdx > 0 ? filename.substring(0, dotIdx) : filename
}
