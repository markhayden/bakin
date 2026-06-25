/**
 * Persistent disk cache for the runtime models list.
 *
 * The in-memory cache in `plugins/models/index.ts` stays as the hot-read
 * layer; this module is the persistence layer underneath. On cold start
 * (server restart), the in-memory cache is empty but disk may still hold
 * the last successful fetch — hydrating from here means the UI renders
 * last-known-good data immediately instead of waiting for the runtime
 * model enumeration call to resolve.
 *
 * Reads zod-validate against the current AvailableModel shape. Corrupt,
 * missing, or schema-drifted files return `null` so callers treat them
 * as no cache.
 */
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'

import { z } from 'zod'

import { getContentDir } from '../../../src/core/content-dir'
import { createLogger } from '../../../src/core/logger'
import type { AvailableModel } from '../types'

const log = createLogger('models-cache')

export interface PersistedCache {
  models: AvailableModel[]
  fetchedAt: number
  source: 'runtime' | 'empty'
}

function cachePath(): string {
  return join(getContentDir(), 'plugin-settings', 'models', 'available.json')
}

const availableModelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    tier: z.enum(['budget', 'standard', 'premium']),
    provider: z.string(),
  })
  .passthrough()

const persistedCacheSchema = z.object({
  models: z.array(availableModelSchema),
  fetchedAt: z.number(),
  source: z.enum(['runtime', 'empty']),
})

export function readPersistedCache(): PersistedCache | null {
  const path = cachePath()
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    const result = persistedCacheSchema.safeParse(parsed)
    if (!result.success) {
      log.warn('Persisted models cache failed schema validation; dropping', { issues: result.error.issues.slice(0, 3) })
      try { unlinkSync(path) } catch { /* ignore */ }
      return null
    }
    return result.data as PersistedCache
  } catch (err) {
    log.warn('Failed to read persisted models cache; dropping', { err: err instanceof Error ? err.message : String(err) })
    try { unlinkSync(path) } catch { /* ignore */ }
    return null
  }
}

export function writePersistedCache(cache: PersistedCache): void {
  try {
    atomicWriteJson(cachePath(), cache, { trailingNewline: false })
  } catch (err) {
    log.error('Failed to write persisted models cache', err as Error)
  }
}

export function clearPersistedCache(): void {
  const path = cachePath()
  if (!existsSync(path)) return
  try {
    unlinkSync(path)
  } catch (err) {
    log.warn('Failed to clear persisted models cache', { err: err instanceof Error ? err.message : String(err) })
  }
}
