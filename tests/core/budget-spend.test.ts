/**
 * assembleBudgetSpend — the ONE spend engine every budget surface consumes
 * (gate, health check, /spend, /budget/status, CLI). Facets: daily + monthly
 * local-calendar windows × {global, byAgent, byProvider, byModel} × lanes.
 *
 * Cap basis is TOTAL OBSERVED (spec V4): attributed run_costs plus the
 * observed-minus-attributed delta from usage.db, computed per (agent, local
 * day, lane) and clamped ≥ 0. Dollars only where actually reported/priced —
 * NULL-honest; subscription lanes never carry dollars (unit-per-lane, V8).
 * Provider/model facets are attributed-only (observed model ids can't be
 * provider-resolved authoritatively).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const dir = join(tmpdir(), 'bakin-test-budget-spend')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => dir, getBakinPaths: () => ({ root: dir, db: join(dir, 'bakin.db') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => dir, getBakinPaths: () => ({ root: dir, db: join(dir, 'bakin.db') }) }))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

// ---- fixture state the mocked stores serve -------------------------------
type CostRow = {
  runId: string; agent: string; model: string | null; provider: string | null
  lane: 'metered' | 'subscription' | null; totalTokens: number | null
  costUsdMicros: number | null; occurredAt: number
}
type UsageCell = {
  agent: string; day: string; model: string
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  costUsdMicros: number | null; costedMessages: number; messageCount: number
}
const costRows: CostRow[] = []
const usageCells: UsageCell[] = []
let usageReadFails = false

mock.module('../../src/core/execution-ledger', () => ({
  listRunCostsSince: (sinceMs: number) => costRows.filter((r) => r.occurredAt >= sinceMs),
}))

// Faithful copy of the canonical local-day key (packages/core/src/usage-history/store.ts).
function localDayKey(tsMs: number): string {
  const d = new Date(tsMs)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
mock.module('../../packages/core/src/usage-history/store', () => ({
  readUsageByAgentModelDaySince: (sinceDay: string) => {
    if (usageReadFails) throw new Error('usage store unavailable')
    return usageCells.filter((c) => c.day >= sinceDay)
  },
  toLocalDayKey: localDayKey,
}))

// Billing resolution for observed (usage.db) rows — the models plugin hook.
const resolveBillingImpl: (data: Record<string, unknown>) => unknown = (d) => {
  const model = (d.model as string) ?? ''
  const provider = model.includes('/') ? model.split('/')[0] : model.startsWith('claude-') ? 'anthropic' : 'other'
  return { provider, lane: provider === 'openai-codex' ? 'subscription' : 'metered' }
}
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: async (name: string, data: Record<string, unknown>) =>
      name === 'models.resolveBilling' ? resolveBillingImpl(data) : undefined,
  }),
}))

import { assembleBudgetSpend, paceProjection } from '../../src/core/budget-spend'
import { dayStartMs, monthStartMs } from '../../src/core/budget'

// NOW: mid-month, mid-day, local — 2026-07-15 12:00.
const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime()
const TODAY = new Date(2026, 6, 15, 9, 0, 0).getTime()
const EARLIER_THIS_MONTH = new Date(2026, 6, 3, 9, 0, 0).getTime()

function usage(agent: string, tsMs: number, model: string, total: number, costUsdMicros: number | null): UsageCell {
  return {
    agent, day: localDayKey(tsMs), model,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
    costUsdMicros, costedMessages: costUsdMicros === null ? 0 : 1, messageCount: 1,
  }
}

beforeEach(() => {
  costRows.length = 0
  usageCells.length = 0
  usageReadFails = false
})

describe('assembleBudgetSpend', () => {
  it('facets attributed spend by window, agent, provider, model and lane', async () => {
    costRows.push(
      { runId: 'r1', agent: 'pixel', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered', totalTokens: 1000, costUsdMicros: 2_000_000, occurredAt: TODAY },
      { runId: 'r2', agent: 'pixel', model: 'openai-codex/gpt-5.5-codex', provider: 'openai-codex', lane: 'subscription', totalTokens: 5000, costUsdMicros: null, occurredAt: TODAY },
      { runId: 'r3', agent: 'rolo', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered', totalTokens: 400, costUsdMicros: 1_000_000, occurredAt: EARLIER_THIS_MONTH },
    )
    const s = await assembleBudgetSpend(NOW)
    expect(s.observedUsageEvidence).toEqual({ status: 'available' })

    // Daily window: only today's rows.
    expect(s.daily.startMs).toBe(dayStartMs(NOW))
    expect(s.daily.global.meteredUsdMicros).toBe(2_000_000)
    expect(s.daily.global.subscriptionTokens).toBe(5000)
    expect(s.daily.byAgent.pixel?.meteredUsdMicros).toBe(2_000_000)
    expect(s.daily.byAgent.rolo).toBeUndefined()

    // Monthly window: both days.
    expect(s.monthly.startMs).toBe(monthStartMs(NOW))
    expect(s.monthly.global.meteredUsdMicros).toBe(3_000_000)
    expect(s.monthly.byProvider.google?.meteredUsdMicros).toBe(3_000_000)
    expect(s.monthly.byProvider['openai-codex']?.subscriptionTokens).toBe(5000)
    expect(s.monthly.byModel['google/gemini-3-flash']?.meteredUsdMicros).toBe(3_000_000)
  })

  it('treats NULL-lane rows as metered and counts unpriced metered tokens honestly', async () => {
    costRows.push({ runId: 'r4', agent: 'main', model: 'mystery/x', provider: 'mystery', lane: null, totalTokens: 300, costUsdMicros: null, occurredAt: TODAY })
    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.global.meteredUsdMicros).toBe(0)
    expect(s.daily.global.unpricedMeteredTokens).toBe(300)
    expect(s.daily.global.meteredTokens).toBe(300)
  })

  it('adds the observed-minus-attributed delta per agent/day/lane, clamped at zero', async () => {
    // Attributed: 1000 metered tokens, $2 — Observed: 1500 tokens, $2.9.
    costRows.push({ runId: 'r5', agent: 'pixel', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered', totalTokens: 1000, costUsdMicros: 2_000_000, occurredAt: TODAY })
    usageCells.push(usage('pixel', TODAY, 'google/gemini-3-flash', 1500, 2_900_000))
    // Over-attributed agent (observed < attributed) must clamp to zero, not go negative.
    costRows.push({ runId: 'r6', agent: 'rolo', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered', totalTokens: 900, costUsdMicros: 1_000_000, occurredAt: TODAY })
    usageCells.push(usage('rolo', TODAY, 'google/gemini-3-flash', 100, 200_000))

    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.byAgent.pixel?.unattributed.meteredUsdMicros).toBe(900_000)
    expect(s.daily.byAgent.pixel?.unattributed.meteredTokens).toBe(500)
    expect(s.daily.byAgent.rolo?.unattributed.meteredUsdMicros).toBe(0)
    expect(s.daily.byAgent.rolo?.unattributed.meteredTokens).toBe(0)
    // Global = sum of per-agent deltas (clamped per agent, not netted).
    expect(s.daily.global.unattributed.meteredUsdMicros).toBe(900_000)
  })

  it('routes observed subscription-lane usage to subscription tokens with no dollars', async () => {
    usageCells.push(usage('main', TODAY, 'openai-codex/gpt-5.5-codex', 8000, 5_000_000))
    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.byAgent.main?.unattributed.subscriptionTokens).toBe(8000)
    expect(s.daily.byAgent.main?.unattributed.meteredUsdMicros).toBe(0) // reported $ suppressed on the subscription lane
  })

  it('NULL-cost observed metered rows contribute tokens but no dollars', async () => {
    usageCells.push(usage('main', TODAY, 'google/gemini-3-flash', 700, null))
    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.byAgent.main?.unattributed.meteredTokens).toBe(700)
    expect(s.daily.byAgent.main?.unattributed.meteredUsdMicros).toBe(0)
  })

  it('monthly window sums every local day since the 1st; daily only today', async () => {
    usageCells.push(usage('main', EARLIER_THIS_MONTH, 'google/gemini-3-flash', 100, 100_000))
    usageCells.push(usage('main', TODAY, 'google/gemini-3-flash', 10, 10_000))
    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.global.unattributed.meteredUsdMicros).toBe(10_000)
    expect(s.monthly.global.unattributed.meteredUsdMicros).toBe(110_000)
  })

  it('marks observed usage unavailable without discarding attributed spend', async () => {
    costRows.push({ runId: 'r7', agent: 'pixel', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered', totalTokens: 1000, costUsdMicros: 2_000_000, occurredAt: TODAY })
    usageReadFails = true

    const s = await assembleBudgetSpend(NOW)

    expect(s.observedUsageEvidence).toEqual({ status: 'unavailable', reason: 'usage_store_unavailable' })
    expect(s.daily.global.meteredUsdMicros).toBe(2_000_000)
    expect(s.daily.global.unattributed.meteredUsdMicros).toBe(0)
  })
})

describe('laneKey isolation', () => {
  it('agent ids containing spaces never collide or corrupt the delta keys', async () => {
    // 'a b' spends; a hypothetical agent named 'a' must see NO delta.
    usageCells.push(usage('a b', TODAY, 'google/gemini-3-flash', 500, 400_000))
    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.byAgent['a b']?.unattributed.meteredUsdMicros).toBe(400_000)
    expect(s.daily.byAgent['a']).toBeUndefined()
  })
})

describe('paceProjection', () => {
  const dayStart = dayStartMs(NOW)
  const nextDay = dayStart + 24 * 3600 * 1000
  it('linearly extrapolates the window spend', () => {
    // Half the day elapsed, $5 spent → on pace for $10.
    expect(paceProjection(5, dayStart, nextDay, dayStart + 12 * 3600 * 1000)).toBe(10)
  })
  it('returns null when almost nothing has elapsed (no signal)', () => {
    expect(paceProjection(5, dayStart, nextDay, dayStart + 1000)).toBeNull()
  })
})
