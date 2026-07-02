/**
 * bootSearch retry contract: a transiently failing table bootstrap retries on
 * the backoff schedule instead of giving up after one deferred attempt. Two
 * early failures used to leave tables missing and the warm signal stuck cold
 * until a manual restart, even after antfly recovered seconds later.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const isolationDir = join(tmpdir(), `bakin-test-search-startup-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => isolationDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => isolationDir,
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

let bootstrapFailuresRemaining = 0
const createRegisteredTables = mock(async () => {
  if (bootstrapFailuresRemaining > 0) {
    bootstrapFailuresRemaining -= 1
    return { failures: ['bakin_tasks: connect ECONNREFUSED'], created: [] }
  }
  return { failures: [], created: [] }
})
const runPendingReconciles = mock(async () => {})
const reindexContentTypes = mock(async () => [])
const getSearchHealth = mock(async () => ({ tables: [] }))
mock.module('../../src/core/search-registry', () => ({
  createRegisteredTables,
  runPendingReconciles,
  reindexContentTypes,
  getSearchHealth,
}))

const warmSearchQueryPath = mock(async () => {})
mock.module('../../src/core/search-warmup', () => ({
  warmSearchQueryPath,
}))

import { bootSearch, SEARCH_STARTUP_RETRY_SCHEDULE_MS } from '../../src/core/search-startup'

const migration = { migrated: false, from: 1, to: 1 } as Parameters<typeof bootSearch>[0]

beforeEach(() => {
  vi.useFakeTimers()
  bootstrapFailuresRemaining = 0
  createRegisteredTables.mockClear()
  warmSearchQueryPath.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('bootSearch', () => {
  it('warms immediately when the first bootstrap succeeds', async () => {
    await bootSearch(migration)
    expect(createRegisteredTables).toHaveBeenCalledTimes(1)
    expect(warmSearchQueryPath).toHaveBeenCalledTimes(1)
  })

  it('keeps retrying on the backoff schedule until the bootstrap succeeds', async () => {
    // Fail the initial attempt AND the first two scheduled retries — the old
    // single-retry behavior gave up exactly here.
    bootstrapFailuresRemaining = 3

    await bootSearch(migration)
    expect(warmSearchQueryPath).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(SEARCH_STARTUP_RETRY_SCHEDULE_MS[0])
    await vi.advanceTimersByTimeAsync(SEARCH_STARTUP_RETRY_SCHEDULE_MS[1])
    expect(warmSearchQueryPath).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(SEARCH_STARTUP_RETRY_SCHEDULE_MS[2])
    expect(createRegisteredTables).toHaveBeenCalledTimes(4)
    expect(warmSearchQueryPath).toHaveBeenCalledTimes(1)
  })

  it('gives up after the schedule is exhausted without looping forever', async () => {
    bootstrapFailuresRemaining = Number.POSITIVE_INFINITY

    await bootSearch(migration)
    for (const delay of SEARCH_STARTUP_RETRY_SCHEDULE_MS) {
      await vi.advanceTimersByTimeAsync(delay)
    }
    // Initial attempt + one per schedule slot; no further timers armed.
    expect(createRegisteredTables).toHaveBeenCalledTimes(1 + SEARCH_STARTUP_RETRY_SCHEDULE_MS.length)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(createRegisteredTables).toHaveBeenCalledTimes(1 + SEARCH_STARTUP_RETRY_SCHEDULE_MS.length)
    expect(warmSearchQueryPath).not.toHaveBeenCalled()
  })
})
