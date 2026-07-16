/**
 * GET /usage-history — day-aligned windows over the real usage store, plus
 * the scan timer's arm/disarm lifecycle (#359).
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-usage-route-${Date.now()}-${randomUUID()}`)

// ES imports are hoisted above mock.module — set env so module-top reads
// resolve into the temp dir.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

// The plugin module pulls the doctor/repair graph — irrelevant here.
mock.module('../../../src/core/doctor', () => ({
  getLastReport: () => null,
  runDiagnostics: async () => null,
  runTargetedDiagnostics: async () => null,
}))
mock.module('../../../src/core/doctor-repair', () => ({
  planDoctorRepair: async () => ({ items: [], errors: [] }),
  applyDoctorRepair: async () => ({ status: 'applied' }),
}))
mock.module('../../../src/core/doctor-delegate', () => ({
  delegateDoctorRepair: async () => ({ status: 'sent' }),
  verifyDoctorRepairRequest: async () => ({ verified: true }),
}))
mock.module('../../../src/core/doctor-repair-store', () => ({
  DoctorRepairRequestNotFoundError: class DoctorRepairRequestNotFoundError extends Error {},
  listDoctorRepairRequests: () => [],
  getDoctorRepairRequest: () => null,
}))

import healthPlugin from '../../../plugins/health'
import { activatePlugin, callRoute, findRoute, type ActivatedPlugin } from '../test-helpers'
import { replaceSessionUsage, toLocalDayKey } from '@bakin/core/usage-history/store'
import { closeAllDbs } from '@bakin/core/storage/db'
import {
  MAX_SCAN_MINUTES,
  MIN_SCAN_MINUTES,
  getUsageHistoryScanStaleAfterMs,
  isUsageHistoryScanInFlight,
  normalizeUsageHistoryScanMinutes,
  runUsageHistoryScan,
  startUsageHistoryTimer,
  stopUsageHistoryTimer,
} from '../../../plugins/health/lib/usage-history-timer'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'

let activated: ActivatedPlugin
const usageScanGlobal = globalThis as typeof globalThis & {
  __bakinUsageHistoryLastScan?: unknown
  __bakinUsageHistoryScanInFlight?: Promise<void> | null
  __bakinUsageHistoryScanPending?: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000
const today = toLocalDayKey(Date.now())
const tenDaysAgo = toLocalDayKey(Date.now() - 10 * DAY_MS)
const fortyDaysAgo = toLocalDayKey(Date.now() - 40 * DAY_MS)

function seed(sessionId: string, agent: string, day: string, total: number, tsMs: number) {
  replaceSessionUsage(
    sessionId,
    agent,
    [{
      day,
      model: 'm1',
      inputTokens: total,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: total,
      costUsdMicros: null,
      costedMessages: 0,
      messageCount: 1,
      firstTs: tsMs,
      lastTs: tsMs,
    }],
    { mtimeMs: 1, size: 1 },
  )
}

beforeAll(async () => {
  usageScanGlobal.__bakinUsageHistoryLastScan = null
  usageScanGlobal.__bakinUsageHistoryScanInFlight = null
  usageScanGlobal.__bakinUsageHistoryScanPending = false
  activated = await activatePlugin(healthPlugin, testDir)
  seed('s-today', 'basil', today, 100, Date.now())
  seed('s-10d', 'basil', tenDaysAgo, 1_000, Date.now() - 10 * DAY_MS)
  seed('s-40d', 'clover', fortyDaysAgo, 10_000, Date.now() - 40 * DAY_MS)
})

afterAll(() => {
  stopUsageHistoryTimer()
  usageScanGlobal.__bakinUsageHistoryLastScan = null
  usageScanGlobal.__bakinUsageHistoryScanInFlight = null
  usageScanGlobal.__bakinUsageHistoryScanPending = false
  closeAllDbs()
  rmSync(testDir, { recursive: true, force: true })
})

async function getHistory(searchParams: Record<string, string> = {}) {
  const route = findRoute(activated.routes, 'GET', '/usage-history')
  if (!route) throw new Error('route /usage-history not registered')
  return callRoute(route, activated.ctx, { searchParams })
}

describe('GET /usage-history', () => {
  it('default window is 24h and excludes older days', async () => {
    const { status, body } = await getHistory()
    expect(status).toBe(200)
    expect(body.window).toBe('24h')
    const byAgent = body.byAgent as Array<{ agent: string; tokens: { total: number } }>
    expect(byAgent.find((a) => a.agent === 'basil')?.tokens.total).toBe(100)
    expect(byAgent.find((a) => a.agent === 'clover')).toBeUndefined()
  })

  it('7d window still excludes the 10-day-old row', async () => {
    const { body } = await getHistory({ window: '7d' })
    const byAgent = body.byAgent as Array<{ agent: string; tokens: { total: number } }>
    expect(byAgent.find((a) => a.agent === 'basil')?.tokens.total).toBe(100)
  })

  it('30d window includes the 10-day-old row but not the 40-day-old one', async () => {
    const { body } = await getHistory({ window: '30d' })
    const byAgent = body.byAgent as Array<{ agent: string; tokens: { total: number } }>
    expect(byAgent.find((a) => a.agent === 'basil')?.tokens.total).toBe(1_100)
    expect(byAgent.find((a) => a.agent === 'clover')).toBeUndefined()

    const byDay = body.byDay as Array<{ day: string }>
    expect(byDay.map((d) => d.day).sort()).toEqual([tenDaysAgo, today].sort())
  })

  it('rejects an unknown window with 400', async () => {
    const { status } = await getHistory({ window: '1y' })
    expect(status).toBe(400)
  })

  it('reports scannedAt null before any sweep has completed', async () => {
    const { body } = await getHistory()
    expect(body.scannedAt).toBeNull()
    expect(body.coverage).toEqual({
      status: 'unavailable',
      reason: 'scan_not_run',
      agents: [],
    })
    expect(body.since).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.throughDay).toBe(today)
  })

  it('publishes partial per-agent coverage without claiming a completed legacy scan', async () => {
    usageScanGlobal.__bakinUsageHistoryLastScan = {
      at: Date.now(),
      report: {
        scanned: 1,
        skipped: 0,
        failed: 1,
        coverage: {
          status: 'partial',
          reason: 'agent_scan_failed',
          agents: [
            { agent: 'basil', status: 'complete' },
            { agent: 'clover', status: 'partial' },
          ],
        },
      },
    }

    const { body } = await getHistory()

    expect(body.scannedAt).toBeNull()
    expect(body.coverage).toEqual({
      status: 'partial',
      reason: 'agent_scan_failed',
      agents: [
        { agent: 'basil', status: 'complete' },
        { agent: 'clover', status: 'partial' },
      ],
    })
    usageScanGlobal.__bakinUsageHistoryLastScan = null
  })

  it('downgrades an expired complete scan instead of presenting retained rows as current', async () => {
    usageScanGlobal.__bakinUsageHistoryLastScan = {
      at: Date.now() - getUsageHistoryScanStaleAfterMs() - 1,
      report: {
        scanned: 1,
        skipped: 0,
        failed: 0,
        coverage: {
          status: 'complete',
          reason: 'complete',
          agents: [{ agent: 'basil', status: 'complete' }],
        },
      },
    }

    const { body } = await getHistory()

    expect(body.scannedAt).toBeNull()
    expect(body.coverage).toEqual({
      status: 'unavailable',
      reason: 'scan_stale',
      agents: [],
    })
    expect((body.byAgent as Array<{ agent: string }>).some((row) => row.agent === 'basil')).toBe(true)
    usageScanGlobal.__bakinUsageHistoryLastScan = null
  })

  it('withholds complete evidence while a new scan generation is in progress', async () => {
    const completeReport = {
      scanned: 1,
      skipped: 0,
      failed: 0,
      coverage: {
        status: 'complete' as const,
        reason: 'complete' as const,
        agents: [{ agent: 'basil', status: 'complete' as const }],
      },
    }
    usageScanGlobal.__bakinUsageHistoryLastScan = {
      at: Date.now(),
      report: completeReport,
    }
    let releaseScan!: (report: typeof completeReport) => void
    let pendingWasVisibleAtScannerStart = false
    const scan = runUsageHistoryScan(createMockRuntimeAdapter(), async () => {
      pendingWasVisibleAtScannerStart = isUsageHistoryScanInFlight()
      return await new Promise<typeof completeReport>((resolve) => { releaseScan = resolve })
    })

    const during = await getHistory()

    expect(pendingWasVisibleAtScannerStart).toBe(true)
    expect(during.body.scannedAt).toBeNull()
    expect(during.body.coverage).toEqual({
      status: 'unavailable',
      reason: 'scan_in_progress',
      agents: [],
    })

    releaseScan(completeReport)
    await scan
    const after = await getHistory()
    expect(after.body.coverage).toEqual(completeReport.coverage)
    expect(after.body.scannedAt).not.toBeNull()
  })

  it('returns unavailable when the durable store cannot be read', async () => {
    closeAllDbs()
    const storePath = join(testDir, 'usage.db')
    rmSync(storePath, { force: true })
    mkdirSync(storePath)

    const { status, body } = await getHistory()

    expect(status).toBe(503)
    expect(body.error).toBe('Usage history store could not be read.')
    rmSync(storePath, { recursive: true, force: true })
  })
})

describe('usage-history timer', () => {
  it('keeps the same timer for the same interval and reschedules a changed interval', () => {
    const g = globalThis as { __bakinUsageHistoryTimer?: unknown }
    // activate() already armed it.
    expect(g.__bakinUsageHistoryTimer).toBeTruthy()
    const first = g.__bakinUsageHistoryTimer
    startUsageHistoryTimer(createMockRuntimeAdapter(), 5)
    expect(g.__bakinUsageHistoryTimer).toBe(first)

    startUsageHistoryTimer(createMockRuntimeAdapter(), 12)
    expect(g.__bakinUsageHistoryTimer).not.toBe(first)
    expect(getUsageHistoryScanStaleAfterMs()).toBe(24 * 60_000)

    stopUsageHistoryTimer()
    expect(g.__bakinUsageHistoryTimer).toBeNull()

    startUsageHistoryTimer(createMockRuntimeAdapter(), 5)
    expect(g.__bakinUsageHistoryTimer).toBeTruthy()
    stopUsageHistoryTimer()
  })

  it('normalizes non-finite, fractional, and out-of-range intervals', () => {
    expect(normalizeUsageHistoryScanMinutes(Number.NaN)).toBe(5)
    expect(normalizeUsageHistoryScanMinutes(Number.POSITIVE_INFINITY)).toBe(5)
    expect(normalizeUsageHistoryScanMinutes(2.6)).toBe(3)
    expect(normalizeUsageHistoryScanMinutes(-10)).toBe(MIN_SCAN_MINUTES)
    expect(normalizeUsageHistoryScanMinutes(MAX_SCAN_MINUTES + 10)).toBe(MAX_SCAN_MINUTES)
  })

  it('applies saved interval changes without a plugin restart', async () => {
    const g = globalThis as { __bakinUsageHistoryTimer?: unknown }
    startUsageHistoryTimer(activated.ctx.runtime, 5)
    const before = g.__bakinUsageHistoryTimer

    await healthPlugin.onSettingsChange?.({ usageHistoryScanMinutes: 9 })

    expect(g.__bakinUsageHistoryTimer).not.toBe(before)
    expect(getUsageHistoryScanStaleAfterMs()).toBe(18 * 60_000)
  })
})
