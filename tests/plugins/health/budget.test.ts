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
let resolveBilling: (() => Promise<unknown>) | null = null
let refreshModelsRegistered = true
let refreshModelsResult: unknown = { count: 3, live: true, error: null }
const hookRegistryMock = () => ({
  getHookRegistry: () => ({
    has: (name: string) => (name === 'models.refreshAvailableModels' ? refreshModelsRegistered : true),
    invoke: async (name: string) => {
      if (name === 'models.getBudgetPolicy') return budgetPolicy
      if (name === 'models.resolveBilling' && resolveBilling) return await resolveBilling()
      if (name === 'models.refreshAvailableModels') return refreshModelsResult
      return undefined
    },
  }),
})
// getHookRegistry lives in the leaf module post-WS2 K1; mock the leaf + legacy facade.
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)
mock.module('../../../src/core/plugin-registry', hookRegistryMock)

import { checkBudget, spendEvidenceRepair } from '@bakin/health/lib/system-checks/budget'
import { recordRunCost } from '../../../src/core/execution-ledger'
import { closeAllDbs, closeDb } from '../../../packages/core/src/storage/db'
import { replaceSessionUsage, toLocalDayKey } from '../../../packages/core/src/usage-history/store'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import {
  isUsageHistoryScanInFlight,
  runUsageHistoryScan,
} from '../../../plugins/health/lib/usage-history-timer'
import type { HealthCheckRunInput } from '@makinbakin/sdk'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'

const usageScanGlobal = globalThis as typeof globalThis & {
  __bakinUsageHistoryLastScan?: unknown
  __bakinUsageHistoryScanIntervalMs?: number
  __bakinUsageHistoryScanInFlight?: Promise<void> | null
  __bakinUsageHistoryScanPending?: boolean
  __bakinUsageHistoryScanGeneration?: number
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
  dbPath = join(testDir, 'bakin.db')
  budgetPolicy = {}
  resolveBilling = null
  refreshModelsRegistered = true
  refreshModelsResult = { count: 3, live: true, error: null }
  usageScanGlobal.__bakinUsageHistoryScanIntervalMs = 5 * 60_000
  usageScanGlobal.__bakinUsageHistoryScanInFlight = null
  usageScanGlobal.__bakinUsageHistoryScanPending = false
  usageScanGlobal.__bakinUsageHistoryScanGeneration = 0
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
  usageScanGlobal.__bakinUsageHistoryScanInFlight = null
  usageScanGlobal.__bakinUsageHistoryScanPending = false
  usageScanGlobal.__bakinUsageHistoryScanGeneration = undefined
  rmSync(testDir, { recursive: true, force: true })
})

function seedSpend(costUsdMicros: number): void {
  recordRunCost({ workClass: null,
    runId: `seed:${randomUUID()}`,
    taskId: 't',
    agent: 'pixel',
    model: 'test/m',
    provider: 'test',
    lane: 'metered',
    usageKind: 'tokens',
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    costUsdMicros,
    occurredAt: Date.now(),
  })
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

  it('is unknown, never healthy, when a subscription run has no token total', async () => {
    budgetPolicy = { rules: [{ scope: 'provider', scopeId: 'openai-codex', lane: 'subscription', dailyCap: 100_000 }] }
    recordRunCost({ workClass: null,
      runId: `unknown-tokens:${randomUUID()}`,
      agent: 'pixel',
      // All billing dimensions are unknown. The evidence must conservatively
      // remain relevant to a provider-scoped subscription cap.
      provider: null,
      lane: null,
      usageKind: 'tokens',
      occurredAt: Date.now(),
    })

    const rows = observed(await checkBudget())
    const spend = rows.find((row) => row.key === 'spend')

    expect(spend?.status).toBe('unknown')
    expect(spend?.summary).toContain('fully verified')
    expect(spend?.evidence).toMatchObject({
      spendEvidence: {
        daily: { status: 'incomplete' },
      },
    })
    expect(rows.some((row) => row.key === 'spend' && row.status === 'healthy')).toBe(false)
  })

  it('is unknown when a metered media row has no applicable price', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 100 }] }
    recordRunCost({ workClass: null,
      runId: `image:pricing-hook-failed:${randomUUID()}`,
      agent: 'pixel',
      model: 'openai/gpt-image-2',
      provider: 'openai',
      lane: 'metered',
      usageKind: 'media',
      costUsdMicros: null,
      occurredAt: Date.now(),
    })

    const rows = observed(await checkBudget())
    const spend = rows.find((row) => row.key === 'spend')

    expect(spend?.status).toBe('unknown')
    expect(spend?.evidence).toMatchObject({
      incompleteSpendRules: [{
        lane: 'metered',
        window: 'daily',
        unit: 'usd_micros',
        knownSpentValue: 0,
        unknownEvidenceCount: 1,
      }],
      spendEvidence: { daily: { status: 'incomplete' } },
    })
  })

  it('is unknown for partial observed costs while retaining the reported subtotal', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 100 }] }
    // Mirror the real hook shape — a lane is only trusted with a resolved provider (#689).
    resolveBilling = async () => ({ provider: 'google', lane: 'metered' })
    const now = Date.now()
    replaceSessionUsage('partial-cost', 'main', [{
      day: toLocalDayKey(now),
      model: 'google/gemini-3-flash',
      inputTokens: 500,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 600,
      costUsdMicros: 250_000,
      costedMessages: 1,
      messageCount: 3,
      userMessages: 0,
      firstTs: now,
      lastTs: now,
    }], { mtimeMs: now, size: 1 })

    const rows = observed(await checkBudget())
    const spend = rows.find((row) => row.key === 'spend')

    expect(spend?.status).toBe('unknown')
    expect(spend?.evidence).toMatchObject({
      incompleteSpendRules: [{
        window: 'daily',
        unit: 'usd_micros',
        knownSpentValue: 250_000,
        unknownEvidenceCount: 2,
      }],
      spendEvidence: {
        daily: {
          gaps: [expect.objectContaining({
            source: 'observed_message',
            reasons: ['value_missing'],
            unknownCount: 2,
          })],
        },
      },
    })
    // The card is concrete and resolvable (2026-07-22 field feedback):
    // a pricing gap names the model in the copy and offers the one-click
    // catalog-refresh repair — never "open a page and pray".
    expect(spend?.detail).toContain('unpriced')
    expect(spend?.detail).toContain('gemini-3-flash')
    expect(spend?.incident?.resolution).toMatchObject({
      type: 'repair',
      actionId: 'spend-evidence-refresh-pricing',
    })
  })

  it('uses monthly evidence for a monthly verdict without contaminating a daily-only rule', async () => {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(1, 0, 0, 0)
    recordRunCost({ workClass: null,
      runId: `image:older-unpriced:${randomUUID()}`,
      agent: 'pixel',
      model: 'openai/gpt-image-2',
      provider: 'openai',
      lane: 'metered',
      usageKind: 'media',
      costUsdMicros: null,
      occurredAt: monthStart.getTime(),
    })

    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 100 }] }
    let rows = observed(await checkBudget())
    expect(rows.find((row) => row.key === 'spend')?.status).toBe('healthy')

    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', monthlyCap: 100 }] }
    rows = observed(await checkBudget())
    const spend = rows.find((row) => row.key === 'spend')
    expect(spend?.status).toBe('unknown')
    expect(spend?.evidence).toMatchObject({
      incompleteSpendRules: [{ window: 'monthly', knownSpentValue: 0 }],
      spendEvidence: {
        daily: { status: 'complete' },
        monthly: { status: 'incomplete' },
      },
    })
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

  it('does not require observed usage storage for attributed-only provider rules', async () => {
    budgetPolicy = { rules: [{ scope: 'provider', scopeId: 'test', lane: 'metered', dailyCap: 100 }] }
    seedSpend(5_000_000)
    closeAllDbs()
    mkdirSync(join(testDir, 'usage.db'))

    const rows = observed(await checkBudget())
    const spend = rows.find((row) => row.key === 'spend')

    expect(spend?.status).toBe('healthy')
    expect(spend?.evidence).toMatchObject({
      observedUsageEvidence: { status: 'unavailable' },
    })
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

  it('is unknown while the observed-usage store is changing scan generations', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 100 }] }
    seedSpend(5_000_000)
    usageScanGlobal.__bakinUsageHistoryScanPending = true

    const rows = observed(await checkBudget())
    const spend = rows.find((row) => row.key === 'spend')

    expect(spend?.status).toBe('unknown')
    expect(spend?.evidence).toMatchObject({
      observedUsageEvidence: { status: 'unavailable', reason: 'scan_in_progress' },
    })
  })

  it('cannot publish healthy evidence when a scan finishes during spend assembly', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 100 }] }
    const now = Date.now()
    replaceSessionUsage('mid-assembly', 'main', [{
      day: toLocalDayKey(now),
      model: 'provider/model',
      inputTokens: 50,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 100,
      costUsdMicros: 1_000_000,
      costedMessages: 1,
      messageCount: 1,
      userMessages: 0,
      firstTs: now,
      lastTs: now,
    }], { mtimeMs: now, size: 1 })

    let releaseBilling!: () => void
    const billingGate = new Promise<void>((resolve) => { releaseBilling = resolve })
    let markBillingStarted!: () => void
    const billingStarted = new Promise<void>((resolve) => { markBillingStarted = resolve })
    resolveBilling = async () => {
      markBillingStarted()
      await billingGate
      return { lane: 'metered' }
    }

    const check = checkBudget()
    await billingStarted
    await runUsageHistoryScan(createMockRuntimeAdapter(), async () => ({
      scanned: 1,
      skipped: 0,
      failed: 0,
      coverage: {
        status: 'complete',
        reason: 'complete',
        agents: [{ agent: 'main', status: 'complete' }],
      },
    }))
    expect(isUsageHistoryScanInFlight()).toBe(false)
    releaseBilling()

    const rows = observed(await check)
    const spend = rows.find((row) => row.key === 'spend')
    expect(spend?.status).toBe('unknown')
    expect(spend?.evidence).toMatchObject({
      observedUsageEvidence: { status: 'unavailable', reason: 'scan_generation_changed' },
    })
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

  it('keeps a proven cap breach critical when matching spend values are also missing', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] }
    seedSpend(10_000_000)
    recordRunCost({ workClass: null,
      runId: `image:unpriced-alongside-breach:${randomUUID()}`,
      agent: 'pixel',
      model: 'openai/gpt-image-2',
      provider: 'openai',
      lane: 'metered',
      usageKind: 'media',
      costUsdMicros: null,
      occurredAt: Date.now(),
    })

    const rows = observed(await checkBudget())
    const spend = rows.find((row) => row.key === 'spend')

    expect(spend?.status).toBe('error')
    expect(spend?.summary).toContain('at or over')
    expect(spend?.evidence).toMatchObject({
      rules: [{ action: 'defer', spentValue: 10_000_000 }],
      spendEvidence: { daily: { status: 'incomplete' } },
    })
  })

  it('reports unknown when incomplete evidence coexists with a warning threshold', async () => {
    budgetPolicy = {
      rules: [
        { scope: 'global', lane: 'metered', dailyCap: 10 },
        { scope: 'agent', scopeId: 'pixel', lane: 'subscription', dailyCap: 10_000 },
      ],
    }
    seedSpend(8_500_000)
    recordRunCost({ workClass: null,
      runId: `subscription:unknown-beside-warning:${randomUUID()}`,
      agent: 'pixel',
      model: 'openai-codex/gpt-5.5-codex',
      provider: 'openai-codex',
      lane: 'subscription',
      usageKind: 'tokens',
      totalTokens: null,
      occurredAt: Date.now(),
    })

    const rows = observed(await checkBudget())
    const spend = rows.find((row) => row.key === 'spend')

    expect(spend?.status).toBe('unknown')
    expect(spend?.evidence).toMatchObject({
      rules: [expect.objectContaining({ action: 'warn' })],
      incompleteSpendRules: [expect.objectContaining({ cause: 'spend_evidence_incomplete' })],
    })
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

  it('stamps cap breaches budget_block — never demotable by sensitivity (#690)', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] }
    seedSpend(10_000_000)
    const rows = observed(await checkBudget())
    const breach = rows.find((row) => row.status === 'error' && row.key === 'spend')!
    expect(breach.incident?.class).toBe('budget_block')
  })

  it('a rule-affecting evidence gap is evidence_gap at watch — the tripwire never degrades silently (D12)', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] }
    resolveBilling = async () => ({ provider: 'google', lane: 'metered' })
    // A metered observed row with NULL cost gives the rule incomplete value evidence.
    replaceSessionUsage('gap-session', 'main', [{
      day: toLocalDayKey(Date.now()),
      model: 'google/gemini-3-flash',
      inputTokens: 500,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 600,
      costUsdMicros: null,
      costedMessages: 0,
      messageCount: 2,
      userMessages: 0,
      firstTs: Date.now(),
      lastTs: Date.now(),
    }], { mtimeMs: 5, size: 5 })
    const rows = observed(await checkBudget())
    const gap = rows.find((row) => row.incident?.key === 'spend-evidence-incomplete')
    expect(gap).toBeDefined()
    expect(gap!.incident?.class).toBe('evidence_gap')
    expect(gap!.incident?.disposition).toBe('watch')
  })

  it('warns when runs were deferred even if utilization looks ok', async () => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 1000 }] }
    appendFileSync(join(testDir, 'audit.jsonl'), JSON.stringify({ ts: new Date().toISOString(), event: 'budget.deferred', agent: 'pixel', data: {} }) + '\n', 'utf-8')
    const [r] = observed(await checkBudget())
    expect(r.status).toBe('warning')
  })

  it.each([
    'spend-evidence-incomplete',
    'spend-evidence-unavailable',
    'ledger-unavailable',
    'token-evidence-incomplete',
  ])('does not call a healed %s deferral spend pressure', async (reason) => {
    budgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 1000 }] }
    appendFileSync(join(testDir, 'audit.jsonl'), JSON.stringify({
      ts: new Date().toISOString(),
      event: 'budget.deferred',
      agent: 'pixel',
      data: { reason },
    }) + '\n', 'utf-8')

    const [r] = observed(await checkBudget())

    expect(r.status).toBe('healthy')
    expect(r.summary).not.toContain('approaching')
    expect(r.evidence).toMatchObject({ deferred: 0, evidenceDeferred: 1 })
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

describe('spend evidence repair (spend-evidence-refresh-pricing)', () => {
  it('force-refreshes the model catalog through the models hook and reports the count', async () => {
    const repair = spendEvidenceRepair()
    const outcomes = await repair.apply(await repair.plan({ type: 'all_actionable', reportId: 'r1' }))
    expect(outcomes).toEqual([
      expect.objectContaining({ status: 'applied', affectedCheckIds: ['budget'] }),
    ])
    expect(outcomes[0]!.message).toContain('3 models')
  })

  it('fails honestly when the models plugin is absent', async () => {
    refreshModelsRegistered = false
    const repair = spendEvidenceRepair()
    const outcomes = await repair.apply(await repair.plan({ type: 'all_actionable', reportId: 'r1' }))
    expect(outcomes[0]).toMatchObject({ status: 'failed' })
    expect(outcomes[0]!.message).toContain('models plugin is not active')
  })

  it('fails with the credentials pointer when the provider returns zero models', async () => {
    refreshModelsResult = { count: 0, live: true, error: null }
    const repair = spendEvidenceRepair()
    const outcomes = await repair.apply(await repair.plan({ type: 'all_actionable', reportId: 'r1' }))
    expect(outcomes[0]).toMatchObject({ status: 'failed' })
    expect(outcomes[0]!.message).toContain('bakin check llm')
  })

  it('surfaces the fetch error when the refresh itself fails', async () => {
    refreshModelsResult = { count: 0, live: false, error: 'gateway unreachable' }
    const repair = spendEvidenceRepair()
    const outcomes = await repair.apply(await repair.plan({ type: 'all_actionable', reportId: 'r1' }))
    expect(outcomes[0]).toMatchObject({ status: 'failed' })
    expect(outcomes[0]!.message).toContain('gateway unreachable')
  })
})
