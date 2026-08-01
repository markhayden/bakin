/**
 * Outbox pump facade — single-flight drain chain + engine-down backoff.
 * The F2 promise: writes issued while the engine is down are journaled and
 * land on the next successful cycle after it returns.
 */
import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-outbox-pump-${Date.now()}-${randomUUID()}`)
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
  configureOutboxPump,
  nudgeOutboxPump,
  stopOutboxPump,
  enqueueIndex,
  outboxStats,
} from '../../src/core/search-outbox'
import { resetOutboxForTests } from '../../packages/core/src/search/outbox'
import { SearchEngineUnavailableError } from '../../packages/core/src/adapters/search/errors'
import { createMockSearchAdapter } from '../../packages/core/src/adapters/search/testing'
import { closeAllDbs } from '../../packages/core/src/storage/db'
import { settleFor } from '../helpers/wait'

afterAll(() => {
  stopOutboxPump()
  closeAllDbs()
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  stopOutboxPump()
  resetOutboxForTests()
})

describe('outbox pump', () => {
  it('writes while the engine is down wait, then land after recovery', async () => {
    const down = createMockSearchAdapter({
      documents: {
        ...createMockSearchAdapter().documents,
        batchIndex: async () => { throw new SearchEngineUnavailableError('down') },
      },
    })
    configureOutboxPump({ adapter: down, resolveTargets: (l) => [l] })
    enqueueIndex('bakin_t', 'k1', { title: 'queued while down' })
    const report = await nudgeOutboxPump()
    expect(report?.failedTransient).toBe(1)
    expect(outboxStats().pending).toBe(1)

    // engine returns
    const up = createMockSearchAdapter()
    await up.tables.create('bakin_t', { fields: {} })
    configureOutboxPump({ adapter: up, resolveTargets: (l) => [l] })
    // pump-level down-backoff gates immediate nudges
    const gated = await nudgeOutboxPump()
    expect(gated).toBeNull()
    // simulate the safety tick (clears the pump gate) after the row-level
    // transient backoff (1s first step) has elapsed — ticks deliberately
    // respect per-row backoff so deep-backoff rows aren't hammered
    await settleFor(1_100, 'outlast the 1s transient backoff step — ticks respect per-row backoff by design')
    const pumpState = (globalThis as Record<string, unknown>).__bakinSearchOutboxPump as { nextAttemptAt: number }
    pumpState.nextAttemptAt = 0
    const landed = await nudgeOutboxPump()
    expect(landed?.processed).toBe(1)
    expect(outboxStats().pending).toBe(0)
    expect((await up.tables.stats('bakin_t'))?.documents).toBe(1)
  })

  it('concurrent nudges share cycles (single-flight, no interleaved drains)', async () => {
    const adapter = createMockSearchAdapter()
    await adapter.tables.create('bakin_t', { fields: {} })
    configureOutboxPump({ adapter, resolveTargets: (l) => [l] })
    for (let i = 0; i < 10; i++) enqueueIndex('bakin_t', `k${i}`, { n: i })
    const reports = await Promise.all([nudgeOutboxPump(), nudgeOutboxPump(), nudgeOutboxPump()])
    const processed = reports.reduce((sum, r) => sum + (r?.processed ?? 0), 0)
    expect(processed).toBe(10)
    expect(outboxStats().pending).toBe(0)
  })
})
