/**
 * Persisted snapshot of the indexer's indexed-updatedAt dedupe cache.
 *
 * The in-memory cache exists so backfills skip rows whose source hasn't
 * advanced. Loading it used to cost a full `bakin_memory` scan on the first
 * write of every boot — the largest table in the store, scanned at exactly
 * the moment antfly is busiest converging. This module persists the map
 * beside offsets.json so a warm boot skips the scan entirely.
 *
 * SAFETY: a stale cache in the "claims newer than reality" direction would
 * make the indexer skip rows forever, so the snapshot is only trusted when
 * (a) its schema version matches the code's MEMORY_SCHEMA_VERSION and
 * (b) its entry count EXACTLY matches the live table's row count (a cheap
 * count-only query). Any drift — crash before the shutdown save, external
 * row removal, table reset — fails the count check and falls back to the
 * scan, which is the pre-existing behavior.
 */
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@bakin/core/content-dir'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('memory:indexed-cache')

export function getIndexedCacheFilePath(): string {
  return join(getContentDir(), 'plugin-settings', 'memory', 'indexed-cache.json')
}

interface IndexedCacheFile {
  schemaVersion: number
  entries: Record<string, number>
}

/** Load the snapshot, or null when absent/malformed/version-mismatched. */
export function loadIndexedCache(schemaVersion: number): Map<string, number> | null {
  const file = getIndexedCacheFilePath()
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as IndexedCacheFile
    if (parsed?.schemaVersion !== schemaVersion || typeof parsed.entries !== 'object' || parsed.entries === null) {
      return null
    }
    const map = new Map<string, number>()
    for (const [key, value] of Object.entries(parsed.entries)) {
      if (typeof value === 'number' && Number.isFinite(value)) map.set(key, value)
    }
    return map
  } catch (err) {
    log.warn('indexed-cache file malformed — ignoring', {
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/** Persist the snapshot (atomic tmp+rename). */
export function saveIndexedCache(schemaVersion: number, entries: Map<string, number>): void {
  try {
    atomicWriteJson(getIndexedCacheFilePath(), {
      schemaVersion,
      entries: Object.fromEntries(entries),
    }, { trailingNewline: false })
  } catch (err) {
    log.warn('failed to persist indexed-cache (next boot re-scans)', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Delete the snapshot — for migration/reindex invalidation. */
export function clearIndexedCache(): void {
  const file = getIndexedCacheFilePath()
  if (!existsSync(file)) return
  try {
    unlinkSync(file)
  } catch (err) {
    log.warn('failed to clear indexed-cache file', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}
