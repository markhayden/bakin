/**
 * budgetGate — the dispatch-side budget consultation. Focused on the paths
 * the pure evaluator can't cover: reading the policy via hook, summing ledger
 * spend, and FAIL-CLOSED behavior when the spend read throws (defer, not
 * allow). The allow/warn/defer arithmetic itself lives in budget.test.ts.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const dir = join(tmpdir(), 'bakin-test-budget-gate')

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => dir,
  getBakinPaths: () => ({ root: dir, home: dir, db: join(dir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => dir,
  getBakinPaths: () => ({ root: dir, home: dir, db: join(dir, 'bakin.db') }),
}))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

const auditCalls: Array<[string, string, string, Record<string, unknown>]> = []
mock.module('../../src/core/audit', () => ({ appendAudit: (...a: unknown[]) => { auditCalls.push(a as never) } }))

// App-services / task-store / openclaw-home are imported transitively by
// dispatch at load — stub them so importing dispatch is side-effect-free.
mock.module('../../src/core/app-services', () => ({ getAppServices: () => ({ runtime: { messaging: { send: async () => ({ id: 'm' }) }, agents: { list: async () => [] } } }) }))
mock.module('@/core/app-services', () => ({ getAppServices: () => ({ runtime: { messaging: { send: async () => ({ id: 'm' }) }, agents: { list: async () => [] } } }) }))
mock.module('../../src/core/task-store', () => ({ readTaskboard: () => ({ columns: {} }), addTaskLog: async () => {}, updateTask: async () => {}, moveTask: async () => {}, blockTask: async () => {} }))
mock.module('@/core/task-store', () => ({ readTaskboard: () => ({ columns: {} }), addTaskLog: async () => {}, updateTask: async () => {}, moveTask: async () => {}, blockTask: async () => {} }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => dir, getOpenClawPath: (s: string) => join(dir, s) }))

// The two seams under test.
let budgetPolicy: unknown = {}
let billingImpl: (data: Record<string, unknown>) => unknown = () => undefined
const hookRegistryMock = () => ({
  getHookRegistry: () => ({
    invoke: async (name: string, data: Record<string, unknown>) => {
      if (name === 'models.getBudgetPolicy') return budgetPolicy
      if (name === 'models.resolveBilling') return billingImpl(data)
      return undefined
    },
  }),
})
// getHookRegistry lives in the leaf module post-WS2 K1; mock the leaf + legacy facade.
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)
mock.module('../../src/core/plugin-registry', hookRegistryMock)

let spendThrows = false
type CostRow = { runId: string; agent: string; model: string | null; provider: string | null; lane: 'metered' | 'subscription' | null; totalTokens: number | null; costUsdMicros: number | null; occurredAt: number }
const costRows: CostRow[] = []
// In-memory emulation of the budget_incidents UNIQUE (the durable debounce).
const incidentKeys = new Map<string, { id: number; status: string; atCap: string }>()
const incidentOpens: Array<Record<string, unknown>> = []
let nextIncidentId = 1
mock.module('../../src/core/execution-ledger', () => ({
  // dispatch imports several verbs at load; only the spend reads matter here.
  claimNextRun: () => ({ claimed: false }),
  currentSeq: () => 0,
  loseRun: () => true,
  settleRun: () => true,
  recordRunCost: () => {},
  spendTotal: () => { if (spendThrows) throw new Error('ledger down'); return 0 },
  listRunCostsSince: (sinceMs: number) => {
    if (spendThrows) throw new Error('ledger down')
    return costRows.filter((r) => r.occurredAt >= sinceMs)
  },
  openBudgetIncident: (input: Record<string, unknown>) => {
    const key = `${input.scope}:${input.scopeId ?? ''}:${input.lane}:${input.window}:${input.windowStartMs}:${input.kind}`
    const existing = incidentKeys.get(key)
    if (existing && existing.status !== 'resolved') return { opened: false, id: existing.id }
    const id = existing?.id ?? nextIncidentId++
    incidentKeys.set(key, { id, status: 'open', atCap: String(input.atCap) })
    incidentOpens.push({ ...input, id })
    return { opened: true, id }
  },
  resolveExpiredBudgetIncidents: () => 0,
  findOpenCapIncident: (key: { scope: string; scopeId?: string; lane: string }) => {
    for (const [k, v] of incidentKeys) {
      const [scope, scopeId, lane, , , kind] = k.split(':')
      if (kind === 'cap' && v.status !== 'resolved' && scope === key.scope && scopeId === (key.scopeId ?? '') && lane === key.lane) {
        return { id: v.id, scope, scopeId, lane, window: 'daily', windowStartMs: 0, kind, unit: 'usd_micros', capValue: 1, spentValue: 2, atCap: v.atCap, openedAt: 0, status: v.status, resolvedAt: null, resolution: null }
      }
    }
    return null
  },
}))

// The spend engine's observed-usage side (usage.db) — empty unless a test seeds it.
type UsageCell = { agent: string; day: string; model: string; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }; costUsdMicros: number | null; costedMessages: number; messageCount: number }
const usageCells: UsageCell[] = []
mock.module('../../packages/core/src/usage-history/store', () => ({
  usageByAgentModelDaySince: (sinceDay: string) => usageCells.filter((c) => c.day >= sinceDay),
  toLocalDayKey: (tsMs: number) => {
    const d = new Date(tsMs)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  },
}))

import { budgetGate } from '../../src/core/dispatch'

beforeEach(() => {
  budgetPolicy = {}
  billingImpl = () => undefined
  spendThrows = false
  auditCalls.length = 0
  costRows.length = 0
  usageCells.length = 0
  incidentKeys.clear()
  incidentOpens.length = 0
})

const GLOBAL_10: unknown = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] }

describe('budgetGate', () => {
  it('allows when no policy is configured', async () => {
    expect((await budgetGate('pixel', dir)).action).toBe('allow')
  })

  it('allows when caps are set but spend is zero', async () => {
    budgetPolicy = GLOBAL_10
    expect((await budgetGate('pixel', dir)).action).toBe('allow')
  })

  it('FAIL-CLOSED: defers and audits when the spend read throws', async () => {
    budgetPolicy = GLOBAL_10
    spendThrows = true
    const decision = await budgetGate('pixel', dir)
    expect(decision.action).toBe('defer')
    expect(auditCalls.some((c) => c[1] === 'budget.deferred')).toBe(true)
  })

  it('defers on attributed spend at the cap (parity with the pre-engine gate)', async () => {
    budgetPolicy = GLOBAL_10
    costRows.push({ runId: 'r1', agent: 'pixel', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered', totalTokens: 100, costUsdMicros: 10_000_000, occurredAt: Date.now() })
    expect((await budgetGate('pixel', dir)).action).toBe('defer')
  })

  it('counts UNATTRIBUTED observed spend toward the cap (total-observed basis, V4)', async () => {
    budgetPolicy = GLOBAL_10
    const now = Date.now()
    const d = new Date(now)
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    // Nothing attributed; the runtime transcripts observed $11 of metered spend today.
    usageCells.push({
      agent: 'pixel', day: today, model: 'google/gemini-3-flash',
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 5000 },
      costUsdMicros: 11_000_000, costedMessages: 1, messageCount: 1,
    })
    const decision = await budgetGate('pixel', dir)
    expect(decision.action).toBe('defer')
  })

  it('provider rule defers only turns bound for that provider', async () => {
    budgetPolicy = { rules: [{ scope: 'provider', scopeId: 'google', lane: 'metered', dailyCap: 5 }] }
    billingImpl = (d) => {
      const model = (d.model as string | undefined) ?? 'anthropic/claude-sonnet-4-6'
      return { provider: model.split('/')[0], lane: 'metered', model }
    }
    costRows.push({ runId: 'r-g', agent: 'pixel', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered', totalTokens: 10, costUsdMicros: 5_000_000, occurredAt: Date.now() })

    // Turn routed to a Google model → provider rule matches → defer.
    expect((await budgetGate('pixel', dir, undefined, { model: 'google/gemini-3-flash' })).action).toBe('defer')
    // Turn on the agent's default (anthropic) → rule does not match → allow.
    expect((await budgetGate('pixel', dir)).action).toBe('allow')
  })

  it('subscription-lane turns are not blocked by metered rules', async () => {
    budgetPolicy = GLOBAL_10
    billingImpl = () => ({ provider: 'openai-codex', lane: 'subscription', model: 'openai-codex/gpt-5.5-codex' })
    costRows.push({ runId: 'r-m', agent: 'pixel', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered', totalTokens: 10, costUsdMicros: 99_000_000, occurredAt: Date.now() })
    expect((await budgetGate('pixel', dir)).action).toBe('allow')
  })

  it('a breach opens ONE incident and ONE audit across repeated gate calls (durable debounce)', async () => {
    budgetPolicy = GLOBAL_10
    costRows.push({ runId: 'r1', agent: 'pixel', model: 'google/g', provider: 'google', lane: 'metered', totalTokens: 100, costUsdMicros: 10_000_000, occurredAt: Date.now() })
    expect((await budgetGate('pixel', dir)).action).toBe('defer')
    expect((await budgetGate('pixel', dir)).action).toBe('defer')
    expect((await budgetGate('rolo', dir)).action).toBe('defer') // same GLOBAL rule identity — no second incident
    expect(incidentOpens).toHaveLength(1)
    expect(incidentOpens[0]).toMatchObject({ scope: 'global', lane: 'metered', window: 'daily', kind: 'cap', unit: 'usd_micros', atCap: 'defer' })
    const deferAudits = auditCalls.filter((c) => c[1] === 'budget.deferred')
    expect(deferAudits).toHaveLength(1)
    expect((deferAudits[0][3] as Record<string, unknown>).incidentId).toBe(incidentOpens[0].id)
  })

  it('PAUSE mode: an open cap incident keeps blocking even when spend is back under cap', async () => {
    budgetPolicy = { rules: [{ scope: 'agent', scopeId: 'pixel', lane: 'metered', dailyCap: 10, atCap: 'pause' }] }
    // Breach once (opens the pause-mode incident)…
    costRows.push({ runId: 'r1', agent: 'pixel', model: 'google/g', provider: 'google', lane: 'metered', totalTokens: 1, costUsdMicros: 10_000_000, occurredAt: Date.now() })
    expect((await budgetGate('pixel', dir)).action).toBe('defer')
    // …then simulate the window rolling over (no spend anymore): still blocked.
    costRows.length = 0
    expect((await budgetGate('pixel', dir)).action).toBe('defer')
    // Other agents are not blocked by pixel's pause incident.
    expect((await budgetGate('rolo', dir)).action).toBe('allow')
    // Resolving the incident (human raise/resume) unblocks.
    for (const [k, v] of incidentKeys) if (k.startsWith('agent:pixel:')) incidentKeys.set(k, { ...v, status: 'resolved' })
    expect((await budgetGate('pixel', dir)).action).toBe('allow')
  })

  it('DEFER mode does not block once spend clears (regression)', async () => {
    budgetPolicy = GLOBAL_10
    costRows.push({ runId: 'r1', agent: 'pixel', model: 'google/g', provider: 'google', lane: 'metered', totalTokens: 1, costUsdMicros: 10_000_000, occurredAt: Date.now() })
    expect((await budgetGate('pixel', dir)).action).toBe('defer')
    costRows.length = 0 // window rolled / spend cleared — defer-mode incidents don't hold
    expect((await budgetGate('pixel', dir)).action).toBe('allow')
  })

  it('a warn threshold opens a warn incident and audits budget.warn once', async () => {
    budgetPolicy = GLOBAL_10
    costRows.push({ runId: 'r1', agent: 'pixel', model: 'google/g', provider: 'google', lane: 'metered', totalTokens: 100, costUsdMicros: 8_500_000, occurredAt: Date.now() })
    expect((await budgetGate('pixel', dir)).action).toBe('warn')
    expect((await budgetGate('pixel', dir)).action).toBe('warn')
    expect(incidentOpens).toHaveLength(1)
    expect(incidentOpens[0]).toMatchObject({ kind: 'warn' })
    expect(auditCalls.filter((c) => c[1] === 'budget.warn')).toHaveLength(1)
  })
})
