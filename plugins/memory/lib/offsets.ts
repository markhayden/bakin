/**
 * Persisted byte-offset tracking for incremental JSONL indexing.
 *
 * The indexer streams append-only JSONL (session transcripts, checkpoints,
 * audit log) and needs to remember where it left off so a reindex doesn't
 * re-read the whole file every time. Offsets are keyed by a caller-supplied
 * file key (usually the path) and stored in a single JSON file under the
 * plugin's settings dir.
 *
 * Writes go through tmp + rename for atomicity — a crash mid-write leaves
 * the previous snapshot intact.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@bakin/core/content-dir'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('memory:offsets')

let cache: Map<string, number> | null = null
let loaded = false

function pluginDir(): string {
  return join(getContentDir(), 'plugin-settings', 'memory')
}

export function getOffsetsFilePath(): string {
  return join(pluginDir(), 'offsets.json')
}

function load(): void {
  if (loaded) return
  loaded = true
  cache = new Map()
  const file = getOffsetsFilePath()
  if (!existsSync(file)) return
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    if (parsed && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
          cache.set(key, value)
        }
      }
    }
  } catch (err) {
    log.warn('offsets file malformed — rebuilding', { err: err instanceof Error ? err.message : String(err) })
    cache = new Map()
  }
}

function persist(): void {
  if (!cache) return
  atomicWriteJson(getOffsetsFilePath(), Object.fromEntries(cache), { trailingNewline: false })
}

export function getOffset(fileKey: string): number {
  load()
  return cache!.get(fileKey) ?? 0
}

export function setOffset(fileKey: string, offset: number): void {
  if (!Number.isFinite(offset) || offset < 0) {
    throw new Error(`Invalid offset for "${fileKey}": ${offset}`)
  }
  load()
  cache!.set(fileKey, offset)
  persist()
}

/** Reset the in-memory cache. Exported for tests; no-op in production. */
export function clearAllOffsets(): void {
  cache = null
  loaded = false
}
