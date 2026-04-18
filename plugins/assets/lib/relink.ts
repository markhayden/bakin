/**
 * Relink/unlink — change an asset's `taskId` association.
 *
 * Under filename-as-identity, `taskId` lives in the sidecar, not in the
 * directory layout. Relink is a pure metadata edit: read sidecar, set
 * `taskId` (or null for unlink), write back. No file moves.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { readSidecar, writeSidecar, createStub } from './sidecar'
import { upsertAsset } from './asset-index'
import { pathForFilename } from './path-for-filename'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('assets:relink')

export interface RelinkParams {
  filename: string
  newTaskId: string | null
}

export interface RelinkResult {
  ok: boolean
  filename: string
  path?: string
  newTaskId?: string | null
  error?: string
  [key: string]: unknown
}

export function relinkAsset(params: RelinkParams): RelinkResult {
  const { filename, newTaskId } = params

  if (!filename || typeof filename !== 'string') {
    return { ok: false, filename, error: 'Missing required field: filename' }
  }
  if (newTaskId !== null && (newTaskId.includes('/') || newTaskId.includes('\\') || newTaskId.includes('..'))) {
    return { ok: false, filename, error: 'Invalid taskId: contains path separators' }
  }

  const rel = pathForFilename(filename)
  if (!rel) {
    return { ok: false, filename, error: 'Non-canonical filename' }
  }

  const fullPath = join(getContentDir(), rel)
  if (!existsSync(fullPath)) {
    return { ok: false, filename, error: 'Asset not found' }
  }

  const meta = readSidecar(fullPath) || createStub(fullPath)
  if (meta.taskId === newTaskId) {
    return { ok: true, filename, path: rel, newTaskId }
  }

  meta.taskId = newTaskId
  writeSidecar(fullPath, meta)
  upsertAsset(rel)

  log.info('Asset relinked', { filename, newTaskId })
  return { ok: true, filename, path: rel, newTaskId }
}
