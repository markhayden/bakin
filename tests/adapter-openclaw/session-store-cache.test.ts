/**
 * Tests for the sessionStoreCache LRU cap — the cache of parsed
 * sessions.json stores previously grew without bound (one entry per store
 * path, each holding the full parsed store).
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-session-cache-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.BAKIN_HOME = join(testDir, 'bakin')

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ tasks: join(testDir, 'bakin', 'tasks') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ tasks: join(testDir, 'bakin', 'tasks') }),
}))

import {
  __readSessionStoreCachedForTest as readStore,
  __sessionStoreCacheKeysForTest as cacheKeys,
  __resetSessionStoreCacheForTest as resetCache,
  SESSION_STORE_CACHE_MAX,
} from '../../packages/adapter-openclaw/src/runtime'

function writeStore(name: string, content: Record<string, unknown>): string {
  const dir = join(testDir, 'stores')
  mkdirSync(dir, { recursive: true })
  const p = join(dir, `${name}.json`)
  writeFileSync(p, JSON.stringify(content))
  return p
}

beforeEach(() => {
  resetCache()
  rmSync(join(testDir, 'stores'), { recursive: true, force: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('sessionStoreCache LRU cap', () => {
  it('never exceeds the cap; oldest entries are evicted first', () => {
    const paths: string[] = []
    for (let i = 0; i < SESSION_STORE_CACHE_MAX + 8; i++) {
      const p = writeStore(`store-${i}`, { [`key-${i}`]: { sessionId: `s-${i}` } })
      paths.push(p)
      readStore(p)
    }
    const keys = cacheKeys()
    expect(keys.length).toBe(SESSION_STORE_CACHE_MAX)
    // The 8 oldest were evicted; the newest survive.
    expect(keys).not.toContain(paths[0])
    expect(keys).not.toContain(paths[7])
    expect(keys).toContain(paths[paths.length - 1])
  })

  it('a recently re-accessed entry survives eviction (LRU, not FIFO)', () => {
    const paths: string[] = []
    for (let i = 0; i < SESSION_STORE_CACHE_MAX; i++) {
      const p = writeStore(`lru-${i}`, { k: { sessionId: `s-${i}` } })
      paths.push(p)
      readStore(p)
    }
    // Touch the oldest entry, then overflow by one.
    readStore(paths[0])
    const overflow = writeStore('lru-overflow', { k: { sessionId: 'fresh' } })
    readStore(overflow)

    const keys = cacheKeys()
    expect(keys).toContain(paths[0]) // re-touched — survived
    expect(keys).not.toContain(paths[1]) // became the coldest — evicted
  })

  it('an evicted path still reads correctly on the next access', () => {
    const first = writeStore('evicted', { k: { sessionId: 'original' } })
    readStore(first)
    for (let i = 0; i < SESSION_STORE_CACHE_MAX + 1; i++) {
      readStore(writeStore(`filler-${i}`, { k: { sessionId: `f-${i}` } }))
    }
    expect(cacheKeys()).not.toContain(first)
    expect(readStore(first)).toEqual({ k: { sessionId: 'original' } } as never)
  })

  it('mtime invalidation still re-reads a changed file', () => {
    const p = writeStore('mtime', { k: { sessionId: 'v1' } })
    expect(readStore(p)).toEqual({ k: { sessionId: 'v1' } } as never)

    writeFileSync(p, JSON.stringify({ k: { sessionId: 'v2' } }))
    // Force a distinct mtime even on coarse-grained filesystems.
    const future = Date.now() / 1000 + 5
    utimesSync(p, future, future)
    expect(readStore(p)).toEqual({ k: { sessionId: 'v2' } } as never)
  })
})
