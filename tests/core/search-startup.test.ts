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
let bootstrapHangs = false
const createRegisteredTables = mock(async () => {
  if (bootstrapHangs) {
    // A wedged antfly: the table call never returns (no client cancellation).
    return new Promise<never>(() => {})
  }
  if (bootstrapFailuresRemaining > 0) {
    bootstrapFailuresRemaining -= 1
    return { failures: ['bakin_tasks: connect ECONNREFUSED'], created: [] }
  }
  return { failures: [], created: [] }
})
const runPendingReconciles = mock(async () => {})
const reindexContentTypes = mock(async () => [])
const getSearchHealth = mock(async () => ({ tables: [] }))
const resumeTableMigrations = mock(async () => {})
const startMigrationPump = mock(() => {})
mock.module('../../src/core/search-registry', () => ({
  createRegisteredTables,
  runPendingReconciles,
  reindexContentTypes,
  resumeTableMigrations,
  startMigrationPump,
  getSearchHealth,
}))

import { startSearchEngine, SEARCH_BOOTSTRAP_BOOT_BUDGET_MS, SEARCH_STARTUP_RETRY_SCHEDULE_MS } from '../../src/core/search-startup'


beforeEach(() => {
  vi.useFakeTimers()
  bootstrapFailuresRemaining = 0
  bootstrapHangs = false
  createRegisteredTables.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startSearchEngine', () => {
  it('runs the bootstrap exactly once when the first attempt succeeds', async () => {
    await startSearchEngine()
    await vi.advanceTimersByTimeAsync(0)
    expect(createRegisteredTables).toHaveBeenCalledTimes(1)
  })

  it('keeps retrying on the backoff schedule until the bootstrap succeeds', async () => {
    // Fail the initial attempt AND the first two scheduled retries — the old
    // single-retry behavior gave up exactly here.
    bootstrapFailuresRemaining = 3

    await startSearchEngine()
    expect(createRegisteredTables).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(SEARCH_STARTUP_RETRY_SCHEDULE_MS[0])
    await vi.advanceTimersByTimeAsync(SEARCH_STARTUP_RETRY_SCHEDULE_MS[1])
    expect(createRegisteredTables).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(SEARCH_STARTUP_RETRY_SCHEDULE_MS[2])
    await vi.advanceTimersByTimeAsync(0)
    expect(createRegisteredTables).toHaveBeenCalledTimes(4)
  })

  it('never holds the boot longer than the boot budget when antfly is wedged', async () => {
    // Field-verified: an antfly stuck in a startup catch-up retry loop
    // (error.FileNotFound) held a table call open FOREVER — the whole server
    // sat silent with no UI. The boot must proceed within the budget.
    bootstrapHangs = true

    let booted = false
    const boot = startSearchEngine().then(() => {
      booted = true
    })

    await vi.advanceTimersByTimeAsync(SEARCH_BOOTSTRAP_BOOT_BUDGET_MS - 1)
    expect(booted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await boot
    expect(booted).toBe(true)
  })

  it('gives up after the schedule is exhausted without looping forever', async () => {
    bootstrapFailuresRemaining = Number.POSITIVE_INFINITY

    await startSearchEngine()
    for (const delay of SEARCH_STARTUP_RETRY_SCHEDULE_MS) {
      await vi.advanceTimersByTimeAsync(delay)
    }
    // Initial attempt + one per schedule slot; no further timers armed.
    expect(createRegisteredTables).toHaveBeenCalledTimes(1 + SEARCH_STARTUP_RETRY_SCHEDULE_MS.length)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(createRegisteredTables).toHaveBeenCalledTimes(1 + SEARCH_STARTUP_RETRY_SCHEDULE_MS.length)
  })
})
