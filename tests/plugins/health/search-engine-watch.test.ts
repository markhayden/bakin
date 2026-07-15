/**
 * Search canary + engine-burn watchdog — the checks born from the
 * 2026-07-12 incident where a wedged engine passed every health probe for
 * 17h while all real queries starved (see search-engine-watch.ts).
 */
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-engine-watch-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'

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
import type { HealthCheckRunInput, HealthRepairTarget } from '@makinbakin/sdk'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'

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

function observed(run: HealthCheckRunInput) {
  const parsed = parseHealthCheckRunInput(run)
  expect(parsed.outcome).toBe('observed')
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}

const repairTarget: HealthRepairTarget = {
  type: 'observations',
  reportId: 'report-test',
  ids: ['health.search-canary:queries.canary'],
}

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
  it('treats an absent streak file as a fresh install', async () => {
    rmSync(join(testDir, 'plugin-data', 'health', 'engine-watch.json'), { force: true })
    canaryTables = [t({ budget: 'omitted' })]

    const [result] = observed(await checkSearchCanary())

    expect(result.status).toBe('warning')
    expect(result.evidence?.darkStreak).toBe(1)
  })

  it('surfaces corrupt persisted streak evidence as unknown without overwriting it', async () => {
    const path = join(testDir, 'plugin-data', 'health', 'engine-watch.json')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '{not-json')

    const [result] = observed(await checkSearchCanary())

    expect(result.status).toBe('unknown')
    expect(result.summary).toContain('watch history could not be verified')
    expect(result.incident?.resolution).toMatchObject({
      type: 'instructions',
      label: 'Restore watch history',
    })
    expect(readFileSync(path, 'utf-8')).toBe('{not-json')
  })

  it('all tables answering → ok', async () => {
    canaryTables = [t(), t(), t()]
    const [result] = observed(await checkSearchCanary())
    expect(result.status).toBe('healthy')
  })

  it('one dark sample warns; two consecutive samples escalate to a repairable error', async () => {
    canaryTables = [t({ budget: 'omitted' }), t({ budget: 'omitted' })]
    const [first] = observed(await checkSearchCanary())
    expect(first.status).toBe('warning')

    const [second] = observed(await checkSearchCanary())
    expect(second.status).toBe('error')
    expect(second.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'search-canary-restart' })
    expect(second.summary).toContain('not serving real queries')
  })

  it('a healthy run between dark samples resets the streak', async () => {
    canaryTables = [t({ budget: 'omitted' })]
    await checkSearchCanary() // dark #1
    canaryTables = [t()]
    await checkSearchCanary() // healthy — streak resets
    canaryTables = [t({ budget: 'omitted' })]
    const [result] = observed(await checkSearchCanary()) // dark #1 again
    expect(result.status).toBe('warning')
  })

  it('partial degrade warns without escalating', async () => {
    canaryTables = [t({ budget: 'degraded' }), t()]
    const [first] = observed(await checkSearchCanary())
    const [second] = observed(await checkSearchCanary())
    expect(first.status).toBe('warning')
    expect(second.status).toBe('warning')
  })

  it('engine down → empty (the base search check owns it)', async () => {
    searchAvailable = false
    expect(await checkSearchCanary()).toMatchObject({ outcome: 'not_applicable' })
  })

  it('an outage gap RESETS the streak — non-adjacent dark samples never escalate', async () => {
    canaryTables = [t({ budget: 'omitted' })]
    await checkSearchCanary() // dark #1
    searchAvailable = false
    await checkSearchCanary() // outage — chain broken, streak reset
    searchAvailable = true
    const [result] = observed(await checkSearchCanary()) // dark again = #1, not #2
    expect(result.status).toBe('warning')
  })

  it('streaks survive a simulated restart (persisted, not module state)', async () => {
    canaryTables = [t({ budget: 'omitted' })]
    await checkSearchCanary() // dark #1 — persisted to plugin-data
    // A server restart re-evaluates the module; the persisted file is the
    // continuity. Same-process second call reads it back the same way.
    const [second] = observed(await checkSearchCanary())
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
    expect(await checkSearchEngineBurn()).toMatchObject({ outcome: 'not_applicable' })
  })

  it('mode that cannot measure (guest) → empty', async () => {
    engineStatus = async () => null
    expect(await checkSearchEngineBurn()).toMatchObject({ outcome: 'not_applicable' })
  })

  it('one wedge sample warns; two consecutive samples escalate to a repairable error', async () => {
    engineStatus = async () => status({ wedgeSignals: ['startup-catchup-spin'], cpuUtilization: 1.8 })
    const [first] = observed(await checkSearchEngineBurn())
    expect(first.status).toBe('warning')

    const [second] = observed(await checkSearchEngineBurn())
    expect(second.status).toBe('error')
    expect(second.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'search-engine-burn-restart' })
    expect(second.evidence?.wedgeSignals).toContain('startup-catchup-spin')
  })

  it('sustained high CPU without a wedge signature only warns (backfills are legitimate)', async () => {
    engineStatus = async () => status({ cpuUtilization: 1.5 })
    await checkSearchEngineBurn()
    const [second] = observed(await checkSearchEngineBurn())
    expect(second.status).toBe('warning')
    expect(second.incident?.disposition).toBe('watch')
  })

  it('healthy engine → ok with the measured rate', async () => {
    engineStatus = async () => status()
    const [result] = observed(await checkSearchEngineBurn())
    expect(result.status).toBe('healthy')
  })

  it('a not-running gap RESETS the wedge streak — a respawn does not inherit it', async () => {
    engineStatus = async () => status({ wedgeSignals: ['startup-catchup-spin'] })
    await checkSearchEngineBurn() // wedge #1
    engineStatus = async () => status({ running: false })
    await checkSearchEngineBurn() // crash gap — streak reset
    engineStatus = async () => status({ wedgeSignals: ['startup-catchup-spin'] })
    const [result] = observed(await checkSearchEngineBurn()) // wedge #1 again
    expect(result.status).toBe('warning')
  })
})

describe('engine restart repair', () => {
  it('plans a non-destructive restart for the canonical target', async () => {
    const plan = await searchCanaryRepair().plan(repairTarget)
    expect(plan).toHaveLength(1)
    expect(plan[0].safety).toBe('safe')
    expect(plan[0].actionId).toBe('search-canary-restart')
    expect(plan[0].observationIds).toEqual(repairTarget.ids)
  })

  it('applies via restartEngine and reports applied once the engine SERVES QUERIES (not just health probes)', async () => {
    let restarted = false
    restartEngine = async () => { restarted = true }
    canaryTables = [t(), t()] // post-restart probe answers clean
    const plan = await searchCanaryRepair().plan(repairTarget)
    const [result] = await searchCanaryRepair().apply(plan)
    expect(restarted).toBe(true)
    expect(result.status).toBe('applied')
  })

  it('a second correlated repair inside the debounce window skips the duplicate bounce', async () => {
    let restarts = 0
    restartEngine = async () => { restarts++ }
    canaryTables = [t()]
    const canaryPlan = await searchCanaryRepair().plan(repairTarget)
    await searchCanaryRepair().apply(canaryPlan)
    const burnPlan = await searchEngineBurnRepair().plan({
      type: 'observations',
      reportId: 'report-test',
      ids: ['health.search-engine-burn:engine.burn'],
    })
    const [second] = await searchEngineBurnRepair().apply(burnPlan)
    expect(restarts).toBe(1) // one bounce serves both detections
    expect(second.status).toBe('applied')
    expect(second.message).toContain('skipped a duplicate bounce')
  })

  it('fails honestly when the adapter cannot restart the engine', async () => {
    const plan = await searchCanaryRepair().plan(repairTarget)
    const [result] = await searchCanaryRepair().apply(plan)
    expect(result.status).toBe('failed')
    expect(result.message).toContain('does not support')
  })
})
