/**
 * Spend observer + single-worker delivery (spec S9, D19/D22/D29/D32):
 * observeSpend records milestone crossings durably (lower ones covered by
 * the highest new one), opens the cap incident at 100, and every alert is
 * delivered at-least-once from durable rows by ONE coalesced worker that
 * marks the exact (id, event_id) it sent. Crashes at any boundary are
 * recovered by the next pass; a reopen during an in-flight delivery is
 * never swallowed; the memo never serves pre-write totals.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync } from 'fs'

const dir = join(tmpdir(), `bakin-test-spend-observer-${Date.now()}-${randomUUID()}`)
mkdirSync(dir, { recursive: true })
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => dir, getBakinPaths: () => ({ home: dir, db: join(dir, 'bakin.db') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => dir, getBakinPaths: () => ({ home: dir, db: join(dir, 'bakin.db') }) }))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

// The policy the spend plugin would serve.
let policy: { rules: Array<Record<string, unknown>> } = { rules: [] }
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    has: (name: string) => name === 'spend.getBudgetPolicy',
    invoke: async (name: string) => (name === 'spend.getBudgetPolicy' ? policy : undefined),
  }),
}))

// The ONE spend engine, stubbed at its boundary: monthly metered spend for
// the test's own agent (each test owns a fresh agent-scoped rule, so the
// ledger's rule-independent incident identity cannot bleed across tests).
let monthlySpendUsdMicros = 0
let facetReads = 0
let currentAgent = 'nobody'
let duringFacetRead: (() => void) | null = null
const NOW = new Date(2026, 8, 22, 12, 0, 0).getTime()
const MONTH_START = new Date(2026, 8, 1).getTime()
mock.module('../../src/core/budget-spend', () => ({
  assembleBudgetSpend: async (now: number) => {
    facetReads++
    const lanes = () => ({ meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 0, unpricedMeteredTokens: 0 })
    const scope = (usd: number) => ({ ...lanes(), meteredUsdMicros: usd, unattributed: { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 0 } })
    const window = (startMs: number, usd: number) => ({ startMs, global: scope(usd), byAgent: { [currentAgent]: scope(usd) }, byProvider: {}, byModel: {}, byWorkClass: {} })
    const hook = duringFacetRead
    duringFacetRead = null
    if (hook) { await Promise.resolve(); hook() }
    return {
      computedAt: now,
      observedUsageEvidence: { status: 'available' },
      spendEvidence: { daily: { status: 'complete', gaps: [] }, monthly: { status: 'complete', gaps: [] } },
      daily: window(new Date(2026, 8, 22).getTime(), 0),
      monthly: window(MONTH_START, monthlySpendUsdMicros),
    }
  },
}))

// Delivery sinks.
const broadcasts: Array<Record<string, unknown>> = []
let broadcastImpl: (d: Record<string, unknown>) => void = (d) => { broadcasts.push(d) }
mock.module('../../src/core/sse', () => ({ broadcast: (d: Record<string, unknown>) => broadcastImpl(d) }))
// Incident fan-out (SSE + relay) is budget-notify's — pinned in its own
// test. Here it is a sink that can be made to throw mid-send, which is how
// "the process died between send and mark" looks to the worker.
const relays: Array<Record<string, unknown>> = []
let notifyImpl: (n: Record<string, unknown>) => void = (n) => { broadcasts.push({ event: 'budget.incident_opened', ...n }); relays.push(n) }
mock.module('../../src/core/budget-notify', () => ({
  notifyBudgetIncidentOpened: (n: Record<string, unknown>) => notifyImpl(n),
  emitBudgetIncidentResolved: () => {},
}))
mock.module('../../src/core/app-services', () => ({ getAppServices: () => ({ runtime: {} }) }))

import { closeDb } from '../../packages/core/src/storage/db'
import { listBudgetIncidents, listMilestones, listUnnotifiedIncidents, listUnnotifiedMilestones, resolveBudgetIncident } from '../../src/core/execution-ledger'
import { _resetSpendObserver, bumpSpendGeneration, deliverPending, observeSpend, startSpendObserver } from '../../src/core/spend-observer'
import { emitSpendRecorded } from '../../src/core/spend-events'

const RULE = { id: 'rule-100', scope: 'agent', scopeId: 'nobody', lane: 'metered', monthlyCap: 100, atCap: 'defer' }

afterAll(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  _resetSpendObserver()
  broadcasts.length = 0
  relays.length = 0
  broadcastImpl = (d) => { broadcasts.push(d) }
  notifyImpl = (n) => { broadcasts.push({ event: 'budget.incident_opened', ...n }); relays.push(n) }
  facetReads = 0
  duringFacetRead = null
  currentAgent = `agent-${randomUUID()}`
  policy = { rules: [{ ...RULE, id: `rule-${randomUUID()}`, scopeId: currentAgent }] }
  monthlySpendUsdMicros = 0
})

const ruleId = () => policy.rules[0]!.id as string
/** Spend arrives: what recordSpend / a scan does before the observer runs. */
function spendArrives(usdMicros: number): void {
  monthlySpendUsdMicros = usdMicros
  bumpSpendGeneration()
}
const milestoneEvents = () => broadcasts.filter((b) => b.event === 'spend.milestone')
const incidentEvents = () => broadcasts.filter((b) => b.event === 'budget.incident_opened')

describe('observeSpend', () => {
  it('49% → 101% in one pass records four rows, covers 50/75/90 by 100, opens the cap incident (episode 1) and delivers exactly ONE user-visible event', async () => {
    spendArrives(49_000_000)
    await observeSpend(NOW)
    expect(listMilestones({ ruleId: ruleId() })).toEqual([])

    spendArrives(101_000_000)
    await observeSpend(NOW + 1)
    const rows = listMilestones({ ruleId: ruleId() })
    expect(rows.map((r) => [r.milestone, r.coveredBy, r.notifiedAt !== null])).toEqual([[50, 100, true], [75, 100, true], [90, 100, true], [100, 100, true]])
    const incidents = listBudgetIncidents({ openOnly: true }).filter((i) => i.scopeId === currentAgent)
    expect(incidents).toHaveLength(1)
    expect(incidents[0]).toMatchObject({ scope: 'agent', scopeId: currentAgent, lane: 'metered', window: 'monthly', kind: 'cap', episode: 1, capValue: 100_000_000, spentValue: 101_000_000, atCap: 'defer' })
    // Delivery ran at the end of the pass: the cap incident is the one alert.
    expect(incidents[0]!.notifiedAt).not.toBeNull()
    expect(milestoneEvents()).toHaveLength(0)
    expect(incidentEvents()).toHaveLength(1)
    expect(incidentEvents()[0]).toMatchObject({ eventId: incidents[0]!.eventId, episode: 1 })
    expect(relays).toHaveLength(1)
  })

  it('step by step: 50 then 75 then 90 each deliver one aggregated milestone event; nothing is re-sent on later passes', async () => {
    spendArrives(51_000_000)
    await observeSpend(NOW)
    expect(milestoneEvents()).toHaveLength(1)
    expect(milestoneEvents()[0]).toMatchObject({ highest: 50, count: 1, ruleId: ruleId() })
    await observeSpend(NOW + 1)
    expect(milestoneEvents()).toHaveLength(1)
    spendArrives(91_000_000)
    await observeSpend(NOW + 2)
    expect(milestoneEvents()).toHaveLength(2)
    expect(milestoneEvents()[1]).toMatchObject({ highest: 90, count: 2 })
    const rows = listMilestones({ ruleId: ruleId() })
    expect(rows.find((r) => r.milestone === 75)?.coveredBy).toBe(90)
    expect(rows.every((r) => r.notifiedAt !== null)).toBe(true)
    expect(listUnnotifiedMilestones()).toEqual([])
    expect(incidentEvents()).toHaveLength(0)
  })

  it('the facet memo is keyed on the spend generation: a post-write pass never reuses pre-write totals, an unchanged generation reads nothing', async () => {
    spendArrives(10_000_000)
    await observeSpend(NOW)
    expect(facetReads).toBe(1)
    await observeSpend(NOW + 1)
    expect(facetReads).toBe(1)
    spendArrives(60_000_000)
    await observeSpend(NOW + 2)
    expect(facetReads).toBe(2)
    expect(listMilestones({ ruleId: ruleId() }).map((r) => r.milestone)).toEqual([50])
  })

  it('a raise then re-breach in the same window reopens the incident as episode 2 with a new event id and delivers once more', async () => {
    spendArrives(101_000_000)
    await observeSpend(NOW)
    const first = listBudgetIncidents({ openOnly: true }).filter((i) => i.scopeId === currentAgent)[0]!
    resolveBudgetIncident({ id: first.id, status: 'resolved', resolution: 'raised' })
    policy = { rules: [{ ...RULE, id: ruleId(), scopeId: currentAgent, monthlyCap: 120 }] }
    spendArrives(121_000_000)
    await observeSpend(NOW + 1)
    const second = listBudgetIncidents({ openOnly: true }).filter((i) => i.scopeId === currentAgent)[0]!
    expect(second.id).toBe(first.id)
    expect(second.episode).toBe(2)
    expect(second.eventId).not.toBe(first.eventId)
    expect(second.notifiedAt).not.toBeNull()
    expect(incidentEvents().map((e) => e.eventId)).toEqual([first.eventId, second.eventId])
  })

  it('lowering a limit below spend records the newly crossed rows on the next pass; raising never un-records', async () => {
    spendArrives(60_000_000)
    await observeSpend(NOW)
    expect(listMilestones({ ruleId: ruleId() }).map((r) => r.milestone)).toEqual([50])
    policy = { rules: [{ ...RULE, id: ruleId(), scopeId: currentAgent, monthlyCap: 62 }] }
    await observeSpend(NOW + 1)
    expect(listMilestones({ ruleId: ruleId() }).map((r) => r.milestone)).toEqual([50, 75, 90])
    policy = { rules: [{ ...RULE, id: ruleId(), scopeId: currentAgent, monthlyCap: 1000 }] }
    await observeSpend(NOW + 2)
    expect(listMilestones({ ruleId: ruleId() }).map((r) => r.milestone)).toEqual([50, 75, 90])
  })

  it('observer passes coalesce: spend arriving DURING the facets read schedules exactly ONE follow-up that sees it', async () => {
    spendArrives(51_000_000)
    const pending: Promise<void>[] = []
    // Two spend events land while the first pass is reading facets — after
    // its memo key was captured, so the follow-up pass must recompute.
    duringFacetRead = () => {
      spendArrives(76_000_000)
      pending.push(observeSpend(NOW + 1))
      spendArrives(91_000_000)
      pending.push(observeSpend(NOW + 2))
    }
    await observeSpend(NOW)
    await Promise.all(pending)
    // First pass + one follow-up — not three.
    expect(facetReads).toBe(2)
    expect(listMilestones({ ruleId: ruleId() }).map((r) => r.milestone)).toEqual([50, 75, 90])
  })
})

describe('deliverPending', () => {
  it('recovers a crash between send and mark: the row is re-sent with the SAME event id and consumers de-duplicate on it', async () => {
    spendArrives(51_000_000)
    // First delivery "crashes" after broadcasting (before the mark).
    broadcastImpl = (d) => { broadcasts.push(d); throw new Error('process died mid-delivery') }
    await observeSpend(NOW)
    expect(milestoneEvents()).toHaveLength(1)
    expect(listUnnotifiedMilestones()).toHaveLength(1)
    broadcastImpl = (d) => { broadcasts.push(d) }
    await deliverPending()
    expect(milestoneEvents()).toHaveLength(2)
    expect(milestoneEvents()[0]!.eventId).toBe(milestoneEvents()[1]!.eventId)
    expect(listUnnotifiedMilestones()).toEqual([])
  })

  it('a reopen during an in-flight delivery: episode 1 completes marking only (id, event_id₁); episode 2 stays pending and the next pass delivers it once', async () => {
    spendArrives(101_000_000)
    await observeSpend(NOW)
    const first = listBudgetIncidents({ openOnly: true }).filter((i) => i.scopeId === currentAgent)[0]!
    // Simulate: episode 1 was sent but its mark had not landed when the reopen happened.
    resolveBudgetIncident({ id: first.id, status: 'resolved', resolution: 'raised' })
    policy = { rules: [{ ...RULE, id: ruleId(), scopeId: currentAgent, monthlyCap: 120 }] }
    spendArrives(121_000_000)
    // The observer's own delivery of episode 2 dies before its mark lands.
    notifyImpl = (n) => { broadcasts.push({ event: 'budget.incident_opened', ...n }); throw new Error('crash before mark') }
    await observeSpend(NOW + 1)
    const second = listBudgetIncidents({ openOnly: true }).filter((i) => i.scopeId === currentAgent)[0]!
    expect(second.episode).toBe(2)
    expect(listUnnotifiedIncidents().filter((i) => i.scopeId === currentAgent).map((i) => i.id)).toEqual([second.id])
    // The stale episode-1 mark must not clear episode 2.
    const { markIncidentNotified } = await import('../../src/core/execution-ledger')
    expect(markIncidentNotified(first.id, first.eventId)).toBe(0)
    notifyImpl = (n) => { broadcasts.push({ event: 'budget.incident_opened', ...n }); relays.push(n) }
    await deliverPending()
    expect(listUnnotifiedIncidents().filter((i) => i.scopeId === currentAgent)).toEqual([])
    expect(incidentEvents().filter((e) => e.eventId === second.eventId)).toHaveLength(2) // crashed attempt + recovery
  })

  it('concurrent boot + watchdog callers produce ONE send per pending row', async () => {
    spendArrives(51_000_000)
    broadcastImpl = (d) => { broadcasts.push(d); throw new Error('no mark this time') }
    await observeSpend(NOW)
    broadcastImpl = (d) => { broadcasts.push(d) }
    broadcasts.length = 0
    await Promise.all([deliverPending(), deliverPending(), deliverPending()])
    expect(milestoneEvents()).toHaveLength(1)
    expect(listUnnotifiedMilestones()).toEqual([])
  })

  it('no limits ⇒ nothing is observed (no facet read), nothing is sent, nothing throws', async () => {
    policy = { rules: [] }
    spendArrives(500_000_000)
    await observeSpend(NOW)
    expect(facetReads).toBe(0)
    expect(broadcasts).toEqual([])
  })

  it('a spend write announced through the leaf seam bumps the generation and runs a pass — once subscribed at boot', async () => {
    monthlySpendUsdMicros = 51_000_000
    emitSpendRecorded() // not subscribed yet: nothing happens
    expect(facetReads).toBe(0)
    startSpendObserver()
    startSpendObserver() // idempotent
    emitSpendRecorded()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await observeSpend(NOW) // joins/awaits the pass the write started
    expect(facetReads).toBe(1)
    expect(listMilestones({ ruleId: ruleId() }).map((r) => r.milestone)).toEqual([50])
  })
})
