/**
 * Retype — change an asset's `type` classification.
 *
 * Under filename-as-identity, `type` lives in the sidecar, not in the
 * directory layout. Retype is a pure metadata edit: read sidecar, set
 * `type`, write back. No file moves, no external reference updates.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { readSidecar, writeSidecar, createStub } from './sidecar'
import { upsertAsset } from './asset-index'
import { resolveFilename } from './resolver'
import { ASSET_TYPES, type AssetType } from './constants'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('assets:retype')

export interface RetypeParams {
  filename: string
  newType: AssetType
}

export interface RetypeResult {
  ok: boolean
  filename: string
  path?: string
  newType?: AssetType
  error?: string
  [key: string]: unknown
}

export function retypeAsset(params: RetypeParams): RetypeResult {
  const { filename, newType } = params

  if (!filename || typeof filename !== 'string') {
    return { ok: false, filename, error: 'Missing required field: filename' }
  }
  if (!ASSET_TYPES.includes(newType)) {
    return { ok: false, filename, error: `Invalid type: ${newType}` }
  }

  const rel = resolveFilename(filename)
  if (!rel) {
    return { ok: false, filename, error: 'Asset not found' }
  }

  const fullPath = join(getContentDir(), rel)
  if (!existsSync(fullPath)) {
    return { ok: false, filename, error: 'Asset not found' }
  }

  const meta = readSidecar(fullPath) || createStub(fullPath)
  if (meta.type === newType) {
    return { ok: true, filename, path: rel, newType }
  }

  meta.type = newType
  writeSidecar(fullPath, meta)
  upsertAsset(rel)

  log.info('Asset retyped', { filename, newType })
  return { ok: true, filename, path: rel, newType }
}
