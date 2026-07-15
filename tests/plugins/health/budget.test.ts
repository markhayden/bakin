/**
 * Budget doctor check: ok when no caps or spend is low, warns as a global cap
 * is approached or runs were deferred, fails at/over a cap, errors when the
 * spend ledger is unreachable (gating fails closed without it).
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, appendFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-budget-check-${Date.now()}-${randomUUID()}`)
let dbPath = join(testDir, 'bakin.db')

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, audit: join(testDir, 'audit.jsonl'), logs: join(testDir, 'logs'), db: dbPath }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

let budgetPolicy: unknown = {}
const hookRegistryMock = () => ({
  getHookRegistry: () => ({ invoke: async (name: string) => (name === 'models.getBudgetPolicy' ? budgetPolicy : undefined) }),
})
// getHookRegistry lives in the leaf module post-WS2 K1; mock the leaf + legacy facade.
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)
mock.module('../../../src/core/plugin-registry', hookRegistryMock)

import { checkBudget } from '@bakin/health/lib/system-checks/budget'
import { recordRunCost } from '../../../src/core/execution-ledger'
import { closeAllDbs, closeDb } from '../../../packages/core/src/storage/db'
import type { HealthCheckRunInput } from '@makinbakin/sdk'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'

const usageScanGlobal = globalThis as typeof globalThis & {
  __bakinUsageHistoryLastScan?: unknown
  __bakinUsageHistoryScanIntervalMs?: number
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
  dbPath = join(testDir, 'bakin.db')
  budgetPolicy = {}
  usageScanGlobal.__bakinUsageHistoryScanIntervalMs = 5 * 60_000
  usageScanGlobal.__bakinUsageHistoryLastScan = {
    at: Date.now(),
    report: {
      scanned: 0,
      skipped: 0,
      failed: 0,
      coverage: { status: 'complete', reason: 'complete', agents: [] },
    },
  }
})

afterEach(() => {
  closeAllDbs()
  usageScanGlobal.__bakinUsageHistoryLastScan = null
  usageScanGlobal.__bakinUsageHistoryScanIntervalMs = undefined
  rmSync(testDir, { recursive: true, force: true })
})

function seedSpend(costUsdMicros: number): void {
  recordRunCost({ runId: `seed:${randomUUID()}`, taskId: 't', agent: 'pixel', model: 'm', inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsdMicros, occurredAt: Date.now() })
}

function observed(run: HealthCheckRunInput) {
  const parsed = parseHealthCheckRunInput(run)
  expect(parsed.outcome).toBe('observed')
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}

describe('budget health check', () => {
  it('WARNS (standing nag) when no caps are configured — spend is uncapped', async () => {
    const [r] = observed(await checkBudget())
    expect(r.status).toBe('warning')
    expect(r.summary).toContain('uncapped')
  })

  it('is ok when spend is well under the cap', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 100 }] }
    seedSpend(5_000_000) // $5 of $100
    const [r] = observed(await checkBudget())
    expect(r.status).toBe('healthy')
  })

  it('is unknown when observed usage storage is unavailable', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 100 }] }
    seedSpend(5_000_000)
    closeAllDbs()
    mkdirSync(join(testDir, 'usage.db'))

    const rows = observed(await checkBudget())

    expect(rows.some((row) => row.key === 'spend' && row.status === 'unknown')).toBe(true)
    expect(rows.some((row) => row.key === 'spend' && row.status === 'healthy')).toBe(false)
  })

  it('is unknown when the most recent transcript scan is stale', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 100 }] }
    seedSpend(5_000_000)
    usageScanGlobal.__bakinUsageHistoryLastScan = {
      at: Date.now() - 11 * 60_000,
      report: {
        scanned: 0,
        skipped: 0,
        failed: 0,
        coverage: { status: 'complete', reason: 'complete', agents: [] },
      },
    }

    const rows = observed(await checkBudget())

    expect(rows.some((row) => row.key === 'spend' && row.status === 'unknown')).toBe(true)
  })

  it('is unknown when the most recent transcript scan has partial coverage', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 100 }] }
    seedSpend(5_000_000)
    usageScanGlobal.__bakinUsageHistoryLastScan = {
      at: Date.now(),
      report: {
        scanned: 1,
        skipped: 0,
        failed: 1,
        coverage: { status: 'partial', reason: 'agent_scan_failed', agents: [{ agent: 'pixel', status: 'partial' }] },
      },
    }

    const rows = observed(await checkBudget())

    expect(rows.some((row) => row.key === 'spend' && row.status === 'unknown')).toBe(true)
    expect(rows.some((row) => row.key === 'spend' && row.status === 'healthy')).toBe(false)
  })

  it('keeps a known cap breach critical when observed evidence is incomplete', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] }
    seedSpend(10_000_000)
    usageScanGlobal.__bakinUsageHistoryLastScan = {
      at: Date.now(),
      report: {
        scanned: 0,
        skipped: 0,
        failed: 1,
        coverage: { status: 'partial', reason: 'agent_scan_failed', agents: [{ agent: 'pixel', status: 'partial' }] },
      },
    }

    const rows = observed(await checkBudget())

    expect(rows.some((row) => row.key === 'spend' && row.status === 'error')).toBe(true)
  })

  it('warns as spend approaches the cap (>= warnPct)', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] }
    seedSpend(8_500_000) // $8.50 of $10 = 85%
    const [r] = observed(await checkBudget())
    expect(r.status).toBe('warning')
  })

  it('errors at/over the cap (dispatch blocked)', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] }
    seedSpend(10_000_000)
    const rows = observed(await checkBudget())
    expect(rows.some((row) => row.status === 'error' && row.key === 'spend')).toBe(true)
  })

  it('warns when runs were deferred even if utilization looks ok', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 1000 }] }
    appendFileSync(join(testDir, 'audit.jsonl'), JSON.stringify({ ts: new Date().toISOString(), event: 'budget.deferred', agent: 'pixel', data: {} }) + '\n', 'utf-8')
    const [r] = observed(await checkBudget())
    expect(r.status).toBe('warning')
  })

  it('errors when the ledger is unreachable', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] }
    closeDb()
    mkdirSync(join(testDir, 'blocked.db'), { recursive: true }) // a dir where the db file should be
    dbPath = join(testDir, 'blocked.db')
    const rows = observed(await checkBudget())
    expect(rows.some((row) => row.status === 'error' && row.key === 'spend-ledger')).toBe(true)
  })

  it('is rule-aware: a breaching per-agent rule attributes the agent in data.agents (chips)', async () => {
    budgetPolicy = {
      rules: [
        { scope: 'global', lane: 'metered', dailyCap: 1000 },
        { scope: 'agent', scopeId: 'pixel', lane: 'metered', dailyCap: 2 },
      ],
    }
    seedSpend(3_000_000) // $3 by pixel: global fine, pixel's $2 cap breached
    const [r] = observed(await checkBudget())
    expect(r.status).toBe('error')
    const data = r.evidence as { agents?: string[]; rules?: Array<Record<string, unknown>> }
    expect(data.agents).toEqual(['pixel'])
    expect(data.rules?.some((x) => x.scope === 'agent' && x.scopeId === 'pixel' && x.action === 'defer')).toBe(true)
  })

  it('surfaces the kill switch as its own warn row', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 1000 }] }
    writeFileSync(join(testDir, 'settings.json'), JSON.stringify({ dispatch: { paused: true } }), 'utf-8')
    const { resetSettingsCache } = await import('../../../src/core/settings')
    resetSettingsCache()
    try {
      const rows = observed(await checkBudget())
      expect(rows.some((r) => r.status === 'warning' && /paused/i.test(r.summary))).toBe(true)
    } finally {
      rmSync(join(testDir, 'settings.json'), { force: true })
      resetSettingsCache()
    }
  })
})
