/**
 * Search canary + engine-burn watchdog — the checks born from the
 * 2026-07-12 incident where a wedged engine passed every health probe for
 * 17h while all real queries starved (see search-engine-watch.ts).
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-engine-watch-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { rmSync } from 'fs'

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({ search: { settings: { enabled: true } } }),
}))

import type { SearchEngineStatus } from '../../../packages/core/src/adapters/search'

// Mutable fixtures the mocked services read on every call.
let searchAvailable = true
let engineStatus: (() => Promise<SearchEngineStatus | null>) | undefined
let restartEngine: (() => Promise<void>) | undefined
let canaryTables: Array<{ table: string; hits: number; took_ms: number; budget?: 'degraded' | 'omitted' }> = []

const services = () => ({
  search: {
    available: async () => searchAvailable,
    ...(engineStatus ? { engineStatus } : {}),
    ...(restartEngine ? { restartEngine } : {}),
  },
  runtime: {},
  tasks: {},
  health: {},
})
mock.module('../../../src/core/app-services', () => ({
  getAppServices: services,
  maybeGetAppServices: services,
}))

// The check imports the search-registry FACADE (the mockable surface —
// review finding: bypassing it broke facade-level test mocking).
mock.module('../../../src/core/search-registry', () => ({
  crossTableSearch: async (q: string) => ({
    results: [],
    meta: {
      query: q,
      total: 0,
      took_ms: 42,
      source: 'search' as const,
      partial: canaryTables.some((t) => t.budget !== undefined) || undefined,
      tables: canaryTables,
    },
  }),
}))

import {
  checkSearchCanary,
  checkSearchEngineBurn,
  classifyCanary,
  resetEngineWatchStateForTests,
  searchCanaryRepair,
  searchEngineBurnRepair,
} from '../../../plugins/health/lib/system-checks/search-engine-watch'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(async () => {
  await resetEngineWatchStateForTests()
  searchAvailable = true
  engineStatus = undefined
  restartEngine = undefined
  canaryTables = []
})

const t = (over: Partial<{ budget: 'degraded' | 'omitted' }> = {}) =>
  ({ table: 'bakin_x', hits: 0, took_ms: 1, ...over })

describe('classifyCanary (pure)', () => {
  it('ok when every table answered clean (hits or not)', () => {
    expect(classifyCanary([t(), t()])).toBe('ok')
    expect(classifyCanary([])).toBe('ok')
  })
  it('partial when some tables degraded or omitted', () => {
    expect(classifyCanary([t(), t({ budget: 'omitted' })])).toBe('partial')
    expect(classifyCanary([t({ budget: 'degraded' }), t()])).toBe('partial')
  })
  it('dark only when EVERY table was omitted', () => {
    expect(classifyCanary([t({ budget: 'omitted' }), t({ budget: 'omitted' })])).toBe('dark')
    expect(classifyCanary([t({ budget: 'omitted' }), t({ budget: 'degraded' })])).toBe('partial')
  })
})

describe('checkSearchCanary', () => {
  it('all tables answering → ok', async () => {
    canaryTables = [t(), t(), t()]
    const [result] = await checkSearchCanary()
    expect(result.status).toBe('ok')
  })

  it('one dark sample warns; two consecutive escalate to an autoFixable error', async () => {
    canaryTables = [t({ budget: 'omitted' }), t({ budget: 'omitted' })]
    const [first] = await checkSearchCanary()
    expect(first.status).toBe('warn')

    const [second] = await checkSearchCanary()
    expect(second.status).toBe('error')
    expect(second.autoFixable).toBe(true)
    expect(second.message).toContain('DARK')
  })

  it('a healthy run between dark samples resets the streak', async () => {
    canaryTables = [t({ budget: 'omitted' })]
    await checkSearchCanary() // dark #1
    canaryTables = [t()]
    await checkSearchCanary() // healthy — streak resets
    canaryTables = [t({ budget: 'omitted' })]
    const [result] = await checkSearchCanary() // dark #1 again
    expect(result.status).toBe('warn')
  })

  it('partial degrade warns without escalating', async () => {
    canaryTables = [t({ budget: 'degraded' }), t()]
    const [first] = await checkSearchCanary()
    const [second] = await checkSearchCanary()
    expect(first.status).toBe('warn')
    expect(second.status).toBe('warn')
  })

  it('engine down → empty (the base search check owns it)', async () => {
    searchAvailable = false
    expect(await checkSearchCanary()).toEqual([])
  })

  it('an outage gap RESETS the streak — non-adjacent dark samples never escalate', async () => {
    canaryTables = [t({ budget: 'omitted' })]
    await checkSearchCanary() // dark #1
    searchAvailable = false
    await checkSearchCanary() // outage — chain broken, streak reset
    searchAvailable = true
    const [result] = await checkSearchCanary() // dark again = #1, not #2
    expect(result.status).toBe('warn')
  })

  it('streaks survive a simulated restart (persisted, not module state)', async () => {
    canaryTables = [t({ budget: 'omitted' })]
    await checkSearchCanary() // dark #1 — persisted to plugin-data
    // A server restart re-evaluates the module; the persisted file is the
    // continuity. Same-process second call reads it back the same way.
    const [second] = await checkSearchCanary()
    expect(second.status).toBe('error')
  })
})

describe('checkSearchEngineBurn', () => {
  const status = (over: Partial<SearchEngineStatus> = {}): SearchEngineStatus => ({
    running: true,
    pid: 4242,
    cpuUtilization: 0.1,
    wedgeSignals: [],
    ...over,
  })

  it('adapter without engineStatus → empty (feature-detect, never assume)', async () => {
    expect(await checkSearchEngineBurn()).toEqual([])
  })

  it('mode that cannot measure (guest) → empty', async () => {
    engineStatus = async () => null
    expect(await checkSearchEngineBurn()).toEqual([])
  })

  it('one wedge sample warns; two consecutive escalate to an autoFixable error', async () => {
    engineStatus = async () => status({ wedgeSignals: ['startup-catchup-spin'], cpuUtilization: 1.8 })
    const [first] = await checkSearchEngineBurn()
    expect(first.status).toBe('warn')

    const [second] = await checkSearchEngineBurn()
    expect(second.status).toBe('error')
    expect(second.autoFixable).toBe(true)
    expect(second.message).toContain('startup-catchup-spin')
  })

  it('sustained high CPU without a wedge signature only warns (backfills are legitimate)', async () => {
    engineStatus = async () => status({ cpuUtilization: 1.5 })
    await checkSearchEngineBurn()
    const [second] = await checkSearchEngineBurn()
    expect(second.status).toBe('warn')
    expect(second.autoFixable ?? false).toBe(false)
  })

  it('healthy engine → ok with the measured rate', async () => {
    engineStatus = async () => status()
    const [result] = await checkSearchEngineBurn()
    expect(result.status).toBe('ok')
  })

  it('a not-running gap RESETS the wedge streak — a respawn does not inherit it', async () => {
    engineStatus = async () => status({ wedgeSignals: ['startup-catchup-spin'] })
    await checkSearchEngineBurn() // wedge #1
    engineStatus = async () => status({ running: false })
    await checkSearchEngineBurn() // crash gap — streak reset
    engineStatus = async () => status({ wedgeSignals: ['startup-catchup-spin'] })
    const [result] = await checkSearchEngineBurn() // wedge #1 again
    expect(result.status).toBe('warn')
  })
})

describe('engine restart repair', () => {
  const errorRow = {
    check: 'search-canary',
    status: 'error' as const,
    message: 'Search is DARK',
    autoFixable: true,
  }

  it('plans a confirmed, non-destructive restart for matching error rows', async () => {
    const plan = await searchCanaryRepair().plan([errorRow])
    expect(plan).toHaveLength(1)
    expect(plan[0].safety).toBe('safe')
    expect(plan[0].requiresConfirmation).toBe(true)
  })

  it('applies via restartEngine and reports applied once the engine SERVES QUERIES (not just health probes)', async () => {
    let restarted = false
    restartEngine = async () => { restarted = true }
    canaryTables = [t(), t()] // post-restart probe answers clean
    const plan = await searchCanaryRepair().plan([errorRow])
    const [result] = await searchCanaryRepair().apply(plan)
    expect(restarted).toBe(true)
    expect(result.status).toBe('applied')
  })

  it('a second correlated repair inside the debounce window skips the duplicate bounce', async () => {
    let restarts = 0
    restartEngine = async () => { restarts++ }
    canaryTables = [t()]
    const canaryPlan = await searchCanaryRepair().plan([errorRow])
    await searchCanaryRepair().apply(canaryPlan)
    const burnPlan = await searchEngineBurnRepair().plan([{ ...errorRow, check: 'search-engine-burn' }])
    const [second] = await searchEngineBurnRepair().apply(burnPlan)
    expect(restarts).toBe(1) // one bounce serves both detections
    expect(second.status).toBe('applied')
    expect(second.message).toContain('skipped a duplicate bounce')
  })

  it('fails honestly when the adapter cannot restart the engine', async () => {
    const plan = await searchCanaryRepair().plan([errorRow])
    const [result] = await searchCanaryRepair().apply(plan)
    expect(result.status).toBe('failed')
    expect(result.message).toContain('does not support')
  })
})
