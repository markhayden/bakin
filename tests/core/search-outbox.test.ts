/**
 * Search outbox — durable write journal (D5). Every index/remove/transform
 * is enqueued to SQLite first; a drain pump lands rows in the adapter and
 * acks. Antfly down = rows wait. Boot = resume drain. No scans, ever.
 */
import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-outbox-${Date.now()}-${randomUUID()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import {
  enqueueIndex,
  enqueueRemove,
  enqueueTransform,
  drainOnce,
  outboxStats,
  retryQuarantined,
  resetOutboxForTests,
} from '../../packages/core/src/search/outbox'
import {
  SearchEngineUnavailableError,
  SearchRequestRejectedError,
} from '../../packages/core/src/adapters/search/errors'
import { createMockSearchAdapter } from '../../packages/core/src/adapters/search/testing'
import { closeAllDbs } from '../../packages/core/src/storage/db'
import type { SearchAdapter } from '../../packages/core/src/adapters/search'

afterAll(() => {
  closeAllDbs()
  rmSync(testDir, { recursive: true, force: true })
})

function makeTarget(adapter: SearchAdapter, targets: Record<string, string[]> = {}) {
  return {
    adapter,
    resolveTargets: (logical: string) => targets[logical] ?? [logical],
  }
}

beforeEach(() => {
  resetOutboxForTests()
})

describe('enqueue coalescing', () => {
  it('last write wins: repeated index enqueues keep ONE row with the newest payload', async () => {
    enqueueIndex('bakin_t', 'k1', { title: 'v1' })
    enqueueIndex('bakin_t', 'k1', { title: 'v2' })
    enqueueIndex('bakin_t', 'k1', { title: 'v3' })
    expect(outboxStats().pending).toBe(1)

    const adapter = createMockSearchAdapter()
    await adapter.tables.create('bakin_t', { fields: {} })
    await drainOnce(makeTarget(adapter))
    for await (const d of adapter.scan('bakin_t', { fields: ['title'] })) {
      expect(d.document.title).toBe('v3')
    }
    expect(outboxStats().pending).toBe(0)
  })

  it('remove replaces a pending index for the same key', async () => {
    enqueueIndex('bakin_t', 'k1', { title: 'doomed' })
    enqueueRemove('bakin_t', 'k1')
    expect(outboxStats().pending).toBe(1)

    const adapter = createMockSearchAdapter()
    await adapter.tables.create('bakin_t', { fields: {} })
    await adapter.documents.index('bakin_t', 'k1', { title: 'old' })
    await drainOnce(makeTarget(adapter))
    const stats = await adapter.tables.stats('bakin_t')
    expect(stats?.documents).toBe(0)
  })

  it('transform merges into a pending index payload instead of adding a row', async () => {
    enqueueIndex('bakin_t', 'k1', { title: 'doc', status: 'draft', views: 1 })
    enqueueTransform('bakin_t', 'k1', [
      { op: '$set', field: 'status', value: 'done' },
      { op: '$inc', field: 'views', value: 2 },
    ])
    expect(outboxStats().pending).toBe(1)

    const adapter = createMockSearchAdapter()
    await adapter.tables.create('bakin_t', { fields: {} })
    await drainOnce(makeTarget(adapter))
    for await (const d of adapter.scan('bakin_t', { fields: ['status', 'views'] })) {
      expect(d.document.status).toBe('done')
      expect(d.document.views).toBe(3)
    }
  })

  it('standalone transform applies ops to the engine document at drain', async () => {
    const adapter = createMockSearchAdapter()
    await adapter.tables.create('bakin_t', { fields: {} })
    await adapter.documents.index('bakin_t', 'k1', { status: 'draft', tags: ['a'] })

    enqueueTransform('bakin_t', 'k1', [
      { op: '$set', field: 'status', value: 'done' },
      { op: '$push', field: 'tags', value: 'b' },
    ])
    await drainOnce(makeTarget(adapter))
    for await (const d of adapter.scan('bakin_t', { fields: ['status', 'tags'] })) {
      expect(d.document.status).toBe('done')
      expect(d.document.tags).toEqual(['a', 'b'])
    }
  })

  it('acked-hash dedupe: re-enqueueing identical content after a successful drain is a no-op', async () => {
    const adapter = createMockSearchAdapter()
    await adapter.tables.create('bakin_t', { fields: {} })
    enqueueIndex('bakin_t', 'k1', { title: 'same', n: 1 })
    await drainOnce(makeTarget(adapter))
    expect(outboxStats().pending).toBe(0)

    // identical content (different key order — canonicalized)
    enqueueIndex('bakin_t', 'k1', { n: 1, title: 'same' })
    expect(outboxStats().pending).toBe(0)

    // changed content re-enqueues
    enqueueIndex('bakin_t', 'k1', { title: 'changed', n: 1 })
    expect(outboxStats().pending).toBe(1)
  })

  it('remove clears the acked hash so later identical re-index is NOT deduped', async () => {
    const adapter = createMockSearchAdapter()
    await adapter.tables.create('bakin_t', { fields: {} })
    enqueueIndex('bakin_t', 'k1', { title: 'same' })
    await drainOnce(makeTarget(adapter))
    enqueueRemove('bakin_t', 'k1')
    await drainOnce(makeTarget(adapter))

    enqueueIndex('bakin_t', 'k1', { title: 'same' })
    expect(outboxStats().pending).toBe(1)
  })
})

describe('drain failure handling', () => {
  it('engine-unavailable is transient: row waits with backoff, attempts NOT advanced', async () => {
    const adapter = createMockSearchAdapter({
      documents: {
        ...createMockSearchAdapter().documents,
        batchIndex: async () => { throw new SearchEngineUnavailableError('connect refused') },
      },
    })
    enqueueIndex('bakin_t', 'k1', { title: 'waits' })
    const r1 = await drainOnce(makeTarget(adapter))
    expect(r1.failedTransient).toBe(1)
    expect(outboxStats().pending).toBe(1)
    expect(outboxStats().quarantined).toBe(0)

    // still pending after MANY transient failures — never quarantined
    for (let i = 0; i < 6; i++) await drainOnce(makeTarget(adapter), { ignoreBackoff: true })
    expect(outboxStats().quarantined).toBe(0)
    expect(outboxStats().pending).toBe(1)

    // engine recovers → row lands
    const ok = createMockSearchAdapter()
    await ok.tables.create('bakin_t', { fields: {} })
    await drainOnce(makeTarget(ok), { ignoreBackoff: true })
    expect(outboxStats().pending).toBe(0)
    expect((await ok.tables.stats('bakin_t'))?.documents).toBe(1)
  })

  it('missing-table 404 is TRANSIENT: rows wait for the table, never quarantine (cutover fix)', async () => {
    const noTable = createMockSearchAdapter({
      documents: {
        ...createMockSearchAdapter().documents,
        batchIndex: async () => { throw new SearchRequestRejectedError('no such table', undefined, 404) },
      },
    })
    enqueueIndex('bakin_t', 'k1', { title: 'waits for its table' })
    for (let i = 0; i < 8; i++) await drainOnce(makeTarget(noTable), { ignoreBackoff: true })
    expect(outboxStats().quarantined).toBe(0)
    expect(outboxStats().pending).toBe(1)

    // table shows up (blue/green ensure completed) → row lands
    const ok = createMockSearchAdapter()
    await ok.tables.create('bakin_t', { fields: {} })
    await drainOnce(makeTarget(ok), { ignoreBackoff: true })
    expect(outboxStats().pending).toBe(0)
    expect((await ok.tables.stats('bakin_t'))?.documents).toBe(1)
  })

  it('request-rejected is permanent: quarantined after 5 attempts, retryQuarantined revives', async () => {
    const bad = createMockSearchAdapter({
      documents: {
        ...createMockSearchAdapter().documents,
        batchIndex: async () => { throw new SearchRequestRejectedError('schema mismatch') },
      },
    })
    enqueueIndex('bakin_t', 'k1', { title: 'poison' })
    for (let i = 0; i < 5; i++) await drainOnce(makeTarget(bad), { ignoreBackoff: true })
    expect(outboxStats().quarantined).toBe(1)
    expect(outboxStats().pending).toBe(0)

    // quarantined rows are not drained
    const r = await drainOnce(makeTarget(bad), { ignoreBackoff: true })
    expect(r.processed).toBe(0)

    expect(retryQuarantined()).toBe(1)
    expect(outboxStats().pending).toBe(1)
  })

  it('a fresh enqueue for a quarantined key replaces the row and revives it', async () => {
    const bad = createMockSearchAdapter({
      documents: {
        ...createMockSearchAdapter().documents,
        batchIndex: async () => { throw new SearchRequestRejectedError('bad doc') },
      },
    })
    enqueueIndex('bakin_t', 'k1', { broken: true })
    for (let i = 0; i < 5; i++) await drainOnce(makeTarget(bad), { ignoreBackoff: true })
    expect(outboxStats().quarantined).toBe(1)

    enqueueIndex('bakin_t', 'k1', { fixed: true })
    expect(outboxStats().quarantined).toBe(0)
    expect(outboxStats().pending).toBe(1)
  })

  it('per-item batch failures quarantine only the failed rows', async () => {
    const adapter = createMockSearchAdapter()
    await adapter.tables.create('bakin_t', { fields: {} })
    const partial = createMockSearchAdapter({
      documents: {
        ...adapter.documents,
        batchIndex: async (table, items) => {
          const good = items.filter((i) => i.key !== 'bad')
          for (const item of good) await adapter.documents.index(table, item.key, item.doc)
          return { indexed: good.length, failed: items.filter((i) => i.key === 'bad').map((i) => ({ key: i.key, error: 'invalid' })) }
        },
      },
    })
    enqueueIndex('bakin_t', 'good1', { n: 1 })
    enqueueIndex('bakin_t', 'bad', { n: 2 })
    enqueueIndex('bakin_t', 'good2', { n: 3 })
    for (let i = 0; i < 5; i++) await drainOnce(makeTarget(partial), { ignoreBackoff: true })
    expect(outboxStats().quarantined).toBe(1)
    expect(outboxStats().pending).toBe(0)
    expect((await adapter.tables.stats('bakin_t'))?.documents).toBe(2)
  })
})

describe('dual-write and crash recovery', () => {
  it('writes to every resolved target and acks only when ALL succeed', async () => {
    const blue = createMockSearchAdapter()
    await blue.tables.create('t_v1', { fields: {} })
    // green table missing → its write fails → row must stay pending
    const flaky = createMockSearchAdapter({
      documents: {
        ...blue.documents,
        batchIndex: async (table, items) => {
          if (table === 't_v2') throw new SearchEngineUnavailableError('green not ready')
          return blue.documents.batchIndex(table, items)
        },
      },
    })
    enqueueIndex('bakin_t', 'k1', { title: 'dual' })
    await drainOnce(makeTarget(flaky, { bakin_t: ['t_v1', 't_v2'] }))
    expect(outboxStats().pending).toBe(1)

    // green comes up → both land, row acks
    const ok = createMockSearchAdapter({
      documents: {
        ...blue.documents,
        batchIndex: async (table, items) => blue.documents.batchIndex(table === 't_v2' ? 't_v2_real' : table, items),
      },
    })
    await blue.tables.create('t_v2_real', { fields: {} })
    await drainOnce(makeTarget(ok, { bakin_t: ['t_v1', 't_v2'] }), { ignoreBackoff: true })
    expect(outboxStats().pending).toBe(0)
  })

  it('stale inflight rows are reset to pending at the next drain (crash recovery)', async () => {
    enqueueIndex('bakin_t', 'k1', { title: 'orphaned' })
    // simulate a crash mid-drain: row left inflight
    const { markInflightForTests } = await import('../../packages/core/src/search/outbox')
    markInflightForTests('bakin_t', 'k1')
    expect(outboxStats().pending).toBe(0)

    const adapter = createMockSearchAdapter()
    await adapter.tables.create('bakin_t', { fields: {} })
    await drainOnce(makeTarget(adapter))
    expect((await adapter.tables.stats('bakin_t'))?.documents).toBe(1)
  })
})
