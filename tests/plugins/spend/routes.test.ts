/**
 * Spend plugin routes + hooks: the replacement edit surface after the
 * ownership cutover (plan T2.7). Limits are written through PUT /limits
 * (ids server-assigned), status/incidents/billing/spend ride the spend
 * plugin, and the spend.* hooks answer pricing + billing + policy. The
 * roster comes from the models plugin over `models.listAgentModels`.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { ActivatedPlugin } from '../test-helpers'

const testDir = join(tmpdir(), `bakin-test-spend-routes-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

const contentDir = join(testDir, '.bakin')
const contentDirMock = () => ({
  getContentDir: () => contentDir,
  getBakinPaths: () => ({ root: contentDir, home: contentDir, db: join(contentDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

const broadcasts: Array<Record<string, unknown>> = []
mock.module('../../../src/core/sse', () => ({ broadcast: (event: Record<string, unknown>) => { broadcasts.push(event) } }))
mock.module('@/core/sse', () => ({ broadcast: (event: Record<string, unknown>) => { broadcasts.push(event) } }))

class FakeLedgerUnavailable extends Error {}
let incidentsList: unknown[] = []
const incidentResolves: Array<Record<string, unknown>> = []
// In-memory milestone rows (the real verbs are pinned in tests/core/budget-milestones-ledger.test.ts).
const milestoneRows: Array<Record<string, unknown> & { id: number; acknowledgedAt: number | null }> = []
mock.module('../../../src/core/execution-ledger', () => ({
  recordMilestoneCrossings: (inputs: Array<Record<string, unknown>>) => inputs.map((input) => {
    const row = { ...input, id: milestoneRows.length + 1, eventId: `evt-${milestoneRows.length + 1}`, coveredBy: null, notifiedAt: null, acknowledgedAt: null }
    milestoneRows.push(row)
    return row
  }),
  listMilestones: () => milestoneRows,
  acknowledgeMilestone: (id: number) => {
    const row = milestoneRows.find((r) => r.id === id)
    if (!row || row.acknowledgedAt !== null) return false
    row.acknowledgedAt = Date.now()
    return true
  },
  listRunCostsSince: mock(() => [
    { runId: 'r1', agent: 'pixel', model: 'anthropic/claude-sonnet-4-6', provider: 'anthropic', lane: 'metered', usageKind: 'tokens', totalTokens: 100, costUsdMicros: 150_000, workClass: 'scheduled', routeSource: 'class', occurredAt: Date.now() },
    { runId: 'r2', agent: 'patch', model: '', provider: null, lane: null, usageKind: 'tokens', totalTokens: 40, costUsdMicros: null, workClass: null, routeSource: null, occurredAt: Date.now() },
  ]),
  listBudgetIncidents: mock(() => incidentsList),
  resolveBudgetIncident: mock((input: unknown) => { incidentResolves.push(input as Record<string, unknown>); return true }),
  resolveExpiredBudgetIncidents: mock(() => 0),
  findOpenCapIncident: mock(() => null),
  openBudgetIncident: mock(() => ({ opened: false, id: 1 })),
  recordRunCost: mock(() => {}),
  recordModelRejection: mock(() => ({ opened: false, id: 0 })),
  resolveModelRejection: mock(() => false),
  listModelRejections: mock(() => []),
  claimNextRun: mock(() => ({ claimed: false })),
  settleRun: mock(() => true),
  loseRun: mock(() => true),
  currentSeq: mock(() => 0),
  LedgerUnavailableError: FakeLedgerUnavailable,
}))
mock.module('../../../src/core/app-services', () => ({ getAppServices: () => ({ runtime: { messaging: { send: async () => ({ id: 'm' }) }, agents: { list: async () => [{ id: 'main', name: 'Main' }] } } }) }))
mock.module('@/core/app-services', () => ({ getAppServices: () => ({ runtime: { messaging: { send: async () => ({ id: 'm' }) }, agents: { list: async () => [{ id: 'main', name: 'Main' }] } } }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => testDir, getOpenClawPath: (s: string) => join(testDir, s), resetOpenClawHome: () => {} }))
mock.module('../../../src/core/task-store', () => ({
  readTaskboard: () => ({ columns: { todo: [{ id: 't-unassigned', title: 'Badge me' }] } }),
  moveTask: async () => {},
  addTaskLog: async () => {},
  updateTask: async () => {},
  blockTask: async () => {},
}))

import { activatePlugin, findRoute, callRoute } from '../test-helpers'
import { readPluginSettings, writePluginSettings } from '../../../packages/core/src/plugins/settings-store'
const spendPlugin = (await import('../../../plugins/spend')).default

let activated: ActivatedPlugin
let roster: Array<{ agentId: string; effectiveModel: string | null }> = [
  { agentId: 'main', effectiveModel: 'anthropic/claude-opus-4-6' },
  { agentId: 'pixel', effectiveModel: 'anthropic/claude-sonnet-4-6' },
]
const UUID_RE = /^[0-9a-f-]{36}$/

/** The settings file IS the store here: getSettings reads it, updateSettings merges into it. */
function wireSettings(): void {
  activated.ctx.getSettings = (() => readPluginSettings('spend')) as typeof activated.ctx.getSettings
  activated.ctx.updateSettings = mock((patch: Record<string, unknown>) => {
    writePluginSettings('spend', { ...readPluginSettings<Record<string, unknown>>('spend'), ...patch })
  }) as unknown as typeof activated.ctx.updateSettings
}

beforeAll(async () => {
  mkdirSync(join(contentDir, 'plugin-settings'), { recursive: true })
  // A legacy models.json — activation must upgrade it before anything answers.
  writePluginSettings('models', { budget: { rules: [{ scope: 'global', lane: 'metered', dailyCap: 25, warnPct: 0.8 }] }, billing: { overrides: [] } })
  activated = await activatePlugin(spendPlugin, testDir)
  wireSettings()
  activated.ctx.hooks.invoke = mock(async (name: string, data: Record<string, unknown>) => {
    if (name === 'models.listAgentModels') return roster
    if (name === 'models.getEffectiveModel') return roster.find((r) => r.agentId === data.agentId)?.effectiveModel ?? null
    return undefined
  }) as unknown as typeof activated.ctx.hooks.invoke
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  mock.restore()
})

/** The revision every write must present — what GET /limits serves right now. */
async function rev(): Promise<string> {
  return (await callRoute(findRoute(activated.routes, 'GET', '/limits')!, activated.ctx)).body.revision as string
}

function handler(name: string): (data: Record<string, unknown>) => Promise<Record<string, unknown>> {
  const call = (activated.ctx.hooks.register as ReturnType<typeof mock>).mock.calls.find((c: unknown[]) => c[0] === name)!
  return call[1] as (data: Record<string, unknown>) => Promise<Record<string, unknown>>
}

describe('activation', () => {
  it('upgrades models.json into spend.json BEFORE registering the spend.* hooks, then mounts the routes', () => {
    const spend = readPluginSettings<{ limits: { rules: Array<Record<string, unknown>> }; billing: { overrides: unknown[] } }>('spend')
    expect(spend.limits.rules).toHaveLength(1)
    expect(spend.limits.rules[0].id).toMatch(UUID_RE)
    expect('warnPct' in spend.limits.rules[0]).toBe(false)
    expect(readPluginSettings<Record<string, unknown>>('models')).toEqual({})

    const hookNames = (activated.ctx.hooks.register as ReturnType<typeof mock>).mock.calls.map((c: unknown[]) => c[0])
    expect(hookNames.sort()).toEqual(['spend.getBudgetPolicy', 'spend.priceImage', 'spend.priceTurn', 'spend.resolveBilling', 'spend.updateBudgetPolicy'])
    expect(activated.routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'GET /coverage', 'GET /incidents', 'GET /limits', 'GET /spend', 'GET /status',
      'POST /incidents/:id/resolve', 'POST /milestones/:id/ack', 'PUT /billing/overrides', 'PUT /limits',
    ])
    expect(activated.routes.find((route) => route.path === '/status')?.activityClass).toBe('routine')
  })
})

describe('spend.* hooks', () => {
  it('getBudgetPolicy answers the upgraded rule list with ids', async () => {
    const policy = await handler('spend.getBudgetPolicy')({}) as { rules: Array<{ id: string; dailyCap: number }> }
    expect(policy.rules[0]).toMatchObject({ dailyCap: 25 })
    expect(policy.rules[0].id).toMatch(UUID_RE)
  })

  it('priceTurn prices an explicit catalog model, null for unpriced, resolves the agent model through models.getEffectiveModel', async () => {
    const priced = await handler('spend.priceTurn')({ model: 'anthropic/claude-sonnet-4-6', input: 1_000_000, output: 1_000_000 })
    expect(priced).toMatchObject({ model: 'anthropic/claude-sonnet-4-6', costUsdMicros: 18_000_000 })
    expect((await handler('spend.priceTurn')({ model: 'mystery/unknown', input: 1000, output: 500 })).costUsdMicros).toBeNull()
    expect((await handler('spend.priceTurn')({ agentId: 'pixel', input: 10, output: 10 })).model).toBe('anthropic/claude-sonnet-4-6')
  })

  it('priceImage bills at the flat rate × count and never lets the agent chat auth suppress image dollars', async () => {
    const originalStatus = activated.ctx.runtime.credentialStatus
    activated.ctx.runtime.credentialStatus = (async () => ({
      llmProviders: ['black-forest-labs'],
      llmCredentials: [{ provider: 'black-forest-labs', kind: 'oauth' as const }],
      channels: [],
    })) as typeof activated.ctx.runtime.credentialStatus
    try {
      const r = await handler('spend.priceImage')({ agentId: 'main', model: 'black-forest-labs/flux-pro', count: 2 })
      expect(r).toMatchObject({ provider: 'black-forest-labs', lane: 'metered', costUsdMicros: 110_000 })
      expect((await handler('spend.priceImage')({ model: 'openai/gpt-image-2', count: 1 })).costUsdMicros).toBeNull()
    } finally {
      activated.ctx.runtime.credentialStatus = originalStatus
    }
  })

  it('updateBudgetPolicy accepts only a past-or-today day key and keeps the rules intact', async () => {
    expect(await handler('spend.updateBudgetPolicy')({ acceptUnattributedBefore: '2999-01-01' })).toMatchObject({ ok: false })
    expect(await handler('spend.updateBudgetPolicy')({ acceptUnattributedBefore: '2026-01-01' })).toEqual({ ok: true })
    const policy = await handler('spend.getBudgetPolicy')({}) as { rules: unknown[]; acceptUnattributedBefore?: string }
    expect(policy.acceptUnattributedBefore).toBe('2026-01-01')
    expect(policy.rules).toHaveLength(1)
  })
})

describe('GET/PUT /limits', () => {
  it('PUT persists the FULL rule list, assigns ids to new rules and keeps existing ones', async () => {
    const existing = (await handler('spend.getBudgetPolicy')({}) as { rules: Array<{ id: string }> }).rules[0].id
    const route = findRoute(activated.routes, 'PUT', '/limits')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { revision: await rev(), rules: [
        { id: existing, scope: 'global', lane: 'metered', dailyCap: 25, monthlyCap: 500 },
        { scope: 'agent', scopeId: 'pixel', lane: 'metered', dailyCap: 5 },
        { scope: 'provider', scopeId: 'google', lane: 'metered', dailyCap: 5, atCap: 'pause' },
        { scope: 'agent', scopeId: 'main', lane: 'subscription', dailyCap: 5_000_000 },
      ] },
    })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    const saved = (await callRoute(findRoute(activated.routes, 'GET', '/limits')!, activated.ctx)).body as { rules: Array<{ id: string; scope: string }> }
    expect(saved.rules).toHaveLength(4)
    expect(saved.rules[0].id).toBe(existing)
    expect(saved.rules.slice(1).every((r) => UUID_RE.test(r.id))).toBe(true)
    expect(saved.rules.map((r) => r.scope)).toEqual(['global', 'agent', 'provider', 'agent'])
  })

  it('rejects a negative cap, a scoped rule without a scopeId, and a capless rule', async () => {
    const route = findRoute(activated.routes, 'PUT', '/limits')!
    const revision = await rev()
    expect((await callRoute(route, activated.ctx, { body: { revision, rules: [{ scope: 'global', lane: 'metered', dailyCap: -5 }] } })).status).toBe(400)
    expect((await callRoute(route, activated.ctx, { body: { revision, rules: [{ scope: 'provider', lane: 'metered', dailyCap: 5 }] } })).status).toBe(400)
    expect((await callRoute(route, activated.ctx, { body: { revision, rules: [{ scope: 'global', lane: 'metered' }] } })).status).toBe(400)
  })

  it('warns on unknown agent/provider scopeIds (typo = fake safety) and normalizes model-scope ids', async () => {
    const route = findRoute(activated.routes, 'PUT', '/limits')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { revision: await rev(), rules: [
        { scope: 'agent', scopeId: 'no-such-agent', lane: 'metered', dailyCap: 5 },
        { scope: 'provider', scopeId: 'Anthropic', lane: 'metered', dailyCap: 5 },
        { scope: 'model', scopeId: 'claude-opus-4-6', lane: 'metered', dailyCap: 10 },
      ] },
    })
    expect(status).toBe(200)
    const warnings = body.warnings as string[]
    expect(warnings.some((w) => w.includes('no-such-agent'))).toBe(true)
    expect(warnings.some((w) => w.includes("'Anthropic'"))).toBe(true)
    const saved = readPluginSettings<{ limits: { rules: Array<{ scope: string; scopeId?: string }> } }>('spend')
    expect(saved.limits.rules.find((r) => r.scope === 'model')?.scopeId).toBe('anthropic/claude-opus-4-6')
  })

  it('resolves live incidents whose rule was deleted (no orphaned banner rows)', async () => {
    incidentsList = [{ id: 12, scope: 'provider', scopeId: 'google', lane: 'metered', window: 'daily', kind: 'cap', status: 'open' }]
    const { status } = await callRoute(findRoute(activated.routes, 'PUT', '/limits')!, activated.ctx, { body: { revision: await rev(), rules: [] } })
    expect(status).toBe(200)
    expect(incidentResolves.at(-1)).toMatchObject({ id: 12, status: 'resolved', resolution: 'rule_removed' })
    incidentsList = []
  })

  it('a PUT under a revision the editor did not load is REFUSED (409 stale_revision, current revision returned) — a snapshot that never saw the current limits cannot replace them', async () => {
    const route = findRoute(activated.routes, 'PUT', '/limits')!
    const before = (await callRoute(findRoute(activated.routes, 'GET', '/limits')!, activated.ctx)).body as { rules: unknown[]; revision: string }
    const refused = await callRoute(route, activated.ctx, { body: { revision: 'rev-from-a-failed-load', rules: [{ scope: 'global', lane: 'metered', monthlyCap: 1 }] } })
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({ error: 'stale_revision', current: before.revision })
    const after = (await callRoute(findRoute(activated.routes, 'GET', '/limits')!, activated.ctx)).body as { rules: unknown[] }
    expect(after.rules).toEqual(before.rules)
  })

  it('one rule per (scope, scopeId, lane): a duplicate identity or a repeated id is a 400, never two ladders on one cap', async () => {
    const route = findRoute(activated.routes, 'PUT', '/limits')!
    const dupIdentity = await callRoute(route, activated.ctx, { body: { revision: await rev(), rules: [
      { scope: 'global', lane: 'metered', dailyCap: 5 },
      { scope: 'global', lane: 'metered', monthlyCap: 50 },
    ] } })
    expect(dupIdentity.status).toBe(400)
    const dupId = await callRoute(route, activated.ctx, { body: { revision: await rev(), rules: [
      { id: 'same', scope: 'global', lane: 'metered', dailyCap: 5 },
      { id: 'same', scope: 'agent', scopeId: 'pixel', lane: 'metered', dailyCap: 5 },
    ] } })
    expect(dupId.status).toBe(400)
  })

  it('reconciles live incidents on every edit: a raised cap resolves raised, a removed window cap or a recreated id resolves rule_removed', async () => {
    const route = findRoute(activated.routes, 'PUT', '/limits')!
    writePluginSettings('spend', { limits: { rules: [{ id: 'g', scope: 'global', lane: 'metered', dailyCap: 10, monthlyCap: 100 }] }, billing: { overrides: [] } })
    try {
      // Raised: the daily incident recorded a $10 cap; the edit makes it $30.
      incidentsList = [{ id: 31, scope: 'global', scopeId: '', lane: 'metered', window: 'daily', kind: 'cap', status: 'open', capValue: 10_000_000 }]
      expect((await callRoute(route, activated.ctx, { body: { revision: await rev(), rules: [{ id: 'g', scope: 'global', lane: 'metered', dailyCap: 30, monthlyCap: 100 }] } })).status).toBe(200)
      expect(incidentResolves.at(-1)).toMatchObject({ id: 31, resolution: 'raised' })
      // Window cap removed: the rule survives (monthly), the daily hold cannot.
      incidentsList = [{ id: 32, scope: 'global', scopeId: '', lane: 'metered', window: 'daily', kind: 'cap', status: 'open', capValue: 30_000_000 }]
      expect((await callRoute(route, activated.ctx, { body: { revision: await rev(), rules: [{ id: 'g', scope: 'global', lane: 'metered', monthlyCap: 100 }] } })).status).toBe(200)
      expect(incidentResolves.at(-1)).toMatchObject({ id: 32, resolution: 'rule_removed' })
      // Same identity under a NEW id: a recreated rule starts fresh.
      incidentsList = [{ id: 33, scope: 'global', scopeId: '', lane: 'metered', window: 'monthly', kind: 'cap', status: 'open', capValue: 100_000_000 }]
      expect((await callRoute(route, activated.ctx, { body: { revision: await rev(), rules: [{ scope: 'global', lane: 'metered', monthlyCap: 100 }] } })).status).toBe(200)
      expect(incidentResolves.at(-1)).toMatchObject({ id: 33, resolution: 'rule_removed' })
      // Every resolution reached the browsers.
      expect(broadcasts.filter((b) => b.event === 'budget.incident_resolved').map((b) => b.resolution)).toEqual(expect.arrayContaining(['raised', 'rule_removed']))
    } finally {
      incidentsList = []
    }
  })

  it('an invalid spend.json fails CLOSED everywhere: the policy hook throws, reads are 422 naming the file, writes never touch it', async () => {
    const file = join(contentDir, 'plugin-settings', 'spend.json')
    const invalid = '{"limits":{"rules":[{"id":"g","scope":"global","lane":"metered","dailyCap":"100"}]},"billing":{"overrides":[]}}'
    writeFileSync(file, invalid)
    try {
      await expect(handler('spend.getBudgetPolicy')({})).rejects.toMatchObject({ code: 'spend_settings_invalid', file })
      const read = await callRoute(findRoute(activated.routes, 'GET', '/limits')!, activated.ctx)
      expect(read.status).toBe(422)
      expect(read.body).toMatchObject({ error: 'spend_settings_invalid', file })
      const write = await callRoute(findRoute(activated.routes, 'PUT', '/limits')!, activated.ctx, { body: { revision: 'x', rules: [] } })
      expect(write.status).toBe(422)
      const overrides = await callRoute(findRoute(activated.routes, 'PUT', '/billing/overrides')!, activated.ctx, { body: { overrides: [] } })
      expect(overrides.status).toBe(422)
      expect(readFileSync(file, 'utf-8')).toBe(invalid)
    } finally {
      writePluginSettings('spend', { limits: { rules: [] }, billing: { overrides: [] } })
    }
  })
})

describe('GET /status', () => {
  it('is side-effect-free and reports configured=false with no rules, still carrying per-agent billing lanes', async () => {
    const { status, body } = await callRoute(findRoute(activated.routes, 'GET', '/status')!, activated.ctx)
    expect(status).toBe(200)
    expect(body).toMatchObject({ configured: false, paused: false, perAgent: {} })
    expect((body.billing as Record<string, { model: string }>).pixel.model).toBe('anthropic/claude-sonnet-4-6')
  })

  it('degrades (200, empty perAgent) when the roster is unreadable', async () => {
    writePluginSettings('spend', { limits: { rules: [{ id: 'g', scope: 'global', lane: 'metered', dailyCap: 10 }] }, billing: { overrides: [] } })
    const saved = roster
    roster = []
    const originalInvoke = activated.ctx.hooks.invoke
    activated.ctx.hooks.invoke = mock(async () => { throw new Error('runtime down') }) as unknown as typeof activated.ctx.hooks.invoke
    try {
      const { status, body } = await callRoute(findRoute(activated.routes, 'GET', '/status')!, activated.ctx)
      expect(status).toBe(200)
      expect(body.configured).toBe(true)
      expect(body.perAgent).toEqual({})
    } finally {
      roster = saved
      activated.ctx.hooks.invoke = originalInvoke
    }
  })

  it('computes perTask holds with the main-agent fallback (unassigned tasks badge)', async () => {
    // $0.10 daily cap; the mocked ledger has $0.15 attributed → deferred.
    writePluginSettings('spend', { limits: { rules: [{ id: 'g', scope: 'global', lane: 'metered', dailyCap: 0.1 }] }, billing: { overrides: [] } })
    // The unassigned task falls back to the runtime's main agent.
    const originalAgents = activated.ctx.runtime.agents
    activated.ctx.runtime.agents = { ...originalAgents, list: (async () => [{ id: 'main', name: 'Main' }]) } as typeof activated.ctx.runtime.agents
    try {
      const { status, body } = await callRoute(findRoute(activated.routes, 'GET', '/status')!, activated.ctx)
      expect(status).toBe(200)
      expect((body.perTask as Record<string, string>)['t-unassigned']).toBe('deferred')
      expect((body.perAgent as Record<string, string>).main).toBe('deferred')
    } finally {
      activated.ctx.runtime.agents = originalAgents
    }
  })

  it('?lite=1 returns the kill switch + ladder rows (milestones, open incidents) and nothing that needs facets', async () => {
    const { status, body } = await callRoute(findRoute(activated.routes, 'GET', '/status')!, activated.ctx, { searchParams: { lite: '1' } })
    expect(status).toBe(200)
    expect(Object.keys(body).sort()).toEqual(['milestones', 'openIncidents', 'paused'])
  })
})

describe('incidents', () => {
  it('GET /incidents lists open incidents', async () => {
    incidentsList = [{ id: 1, scope: 'global', scopeId: '', lane: 'metered', window: 'daily', kind: 'cap', status: 'open' }]
    const { status, body } = await callRoute(findRoute(activated.routes, 'GET', '/incidents')!, activated.ctx)
    expect(status).toBe(200)
    expect((body.incidents as unknown[]).length).toBe(1)
    incidentsList = []
  })

  it('POST resolve ack acknowledges without touching settings', async () => {
    incidentsList = [{ id: 4, scope: 'global', scopeId: '', lane: 'metered', window: 'daily', kind: 'cap', status: 'open' }]
    const before = JSON.stringify(readPluginSettings('spend'))
    const { status, body } = await callRoute(findRoute(activated.routes, 'POST', '/incidents/:id/resolve')!, activated.ctx, { searchParams: { id: '4' }, body: { action: 'ack' } })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(incidentResolves.at(-1)).toMatchObject({ id: 4, status: 'acknowledged' })
    expect(JSON.stringify(readPluginSettings('spend'))).toBe(before)
    incidentsList = []
  })

  it('POST resolve raise validates the new cap against current spend, updates the rule in place (same id), resolves raised', async () => {
    writePluginSettings('spend', { limits: { rules: [{ id: 'g', scope: 'global', lane: 'metered', dailyCap: 0.1 }] }, billing: { overrides: [] } })
    incidentsList = [{ id: 9, scope: 'global', scopeId: '', lane: 'metered', window: 'daily', kind: 'cap', status: 'open' }]
    const route = findRoute(activated.routes, 'POST', '/incidents/:id/resolve')!
    try {
      const low = await callRoute(route, activated.ctx, { searchParams: { id: '9' }, body: { action: 'raise', cap: 0.12 } })
      expect(low.status).toBe(400)
      expect(String(low.body.error)).toContain('must exceed current')

      const ok = await callRoute(route, activated.ctx, { searchParams: { id: '9' }, body: { action: 'raise', cap: 5 } })
      expect(ok.status).toBe(200)
      expect(readPluginSettings<{ limits: { rules: Array<Record<string, unknown>> } }>('spend').limits.rules).toEqual([{ id: 'g', scope: 'global', lane: 'metered', dailyCap: 5 }])
      expect(incidentResolves.at(-1)).toMatchObject({ id: 9, status: 'resolved', resolution: 'raised' })
    } finally {
      incidentsList = []
    }
  })

  it('S12: resume is refused with 409 still_over_limit while spend is still at/over the cap; raise is the way out', async () => {
    // $0.10 daily cap; the mocked ledger has $0.15 attributed → still over.
    writePluginSettings('spend', { limits: { rules: [{ id: 'g', scope: 'global', lane: 'metered', dailyCap: 0.1, atCap: 'pause' }] }, billing: { overrides: [] } })
    incidentsList = [{ id: 21, scope: 'global', scopeId: '', lane: 'metered', window: 'daily', kind: 'cap', status: 'open', atCap: 'pause' }]
    const route = findRoute(activated.routes, 'POST', '/incidents/:id/resolve')!
    try {
      const refused = await callRoute(route, activated.ctx, { searchParams: { id: '21' }, body: { action: 'resume' } })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('still_over_limit')
      expect(incidentResolves.some((r) => r.id === 21)).toBe(false)
      // Under the cap (rule raised meanwhile) ⇒ resume clears it.
      writePluginSettings('spend', { limits: { rules: [{ id: 'g', scope: 'global', lane: 'metered', dailyCap: 5, atCap: 'pause' }] }, billing: { overrides: [] } })
      const ok = await callRoute(route, activated.ctx, { searchParams: { id: '21' }, body: { action: 'resume' } })
      expect(ok.status).toBe(200)
      // `resumed` — reopenable: going over again is a new episode, so a pause rule re-engages its hold.
      expect(incidentResolves.at(-1)).toMatchObject({ id: 21, status: 'resolved', resolution: 'resumed' })
    } finally {
      incidentsList = []
    }
  })

  it('POST resolve 404s for an unknown incident', async () => {
    const { status } = await callRoute(findRoute(activated.routes, 'POST', '/incidents/:id/resolve')!, activated.ctx, { searchParams: { id: '999' }, body: { action: 'ack' } })
    expect(status).toBe(404)
  })
})

describe('PUT /billing/overrides', () => {
  it('validates and persists lane overrides without disturbing the limits', async () => {
    const route = findRoute(activated.routes, 'PUT', '/billing/overrides')!
    const rulesBefore = readPluginSettings<{ limits: { rules: unknown[] } }>('spend').limits.rules
    const ok = await callRoute(route, activated.ctx, { body: { overrides: [{ agentId: 'main', lane: 'subscription' }] } })
    expect(ok.status).toBe(200)
    const saved = readPluginSettings<{ limits: { rules: unknown[] }; billing: { overrides: unknown[] } }>('spend')
    expect(saved.billing.overrides).toEqual([{ agentId: 'main', lane: 'subscription' }])
    expect(saved.limits.rules).toEqual(rulesBefore)
    const bad = await callRoute(route, activated.ctx, { body: { overrides: [{ lane: 'metered' }] } })
    expect(bad.status).toBe(400)
  })
})

describe('GET /spend', () => {
  it('exposes cap-window facets + pace alongside NULL-honest rollups', async () => {
    const { status, body } = await callRoute(findRoute(activated.routes, 'GET', '/spend')!, activated.ctx, { searchParams: { window: '24h' } })
    expect(status).toBe(200)
    expect(body.window).toBe('24h')
    expect(body.totalUsdMicros).toBe(150_000)
    expect(body.byAgent).toEqual([
      { agent: 'pixel', costUsdMicros: 150_000, runs: 1 },
      { agent: 'patch', costUsdMicros: null, runs: 1 },
    ])
    expect(body.byModel).toEqual(expect.arrayContaining([
      { model: 'anthropic/claude-sonnet-4-6', costUsdMicros: 150_000, runs: 1 },
      { model: 'unknown', costUsdMicros: null, runs: 1 },
    ]))
    expect(body.byWorkClass).toEqual(expect.arrayContaining([
      expect.objectContaining({ workClass: 'scheduled', runs: 1, costUsdMicros: 150_000, avgCostUsdMicros: 150_000 }),
      expect.objectContaining({ workClass: 'unclassified', runs: 1, costUsdMicros: null }),
    ]))
    const facets = body.facets as { daily: { global: Record<string, unknown> } }
    expect(facets.daily.global.meteredUsdMicros).toBe(150_000)
    expect(body.pace).toHaveProperty('daily')
    expect(body.pace).toHaveProperty('monthly')
    expect((body.timeline as unknown[]).length).toBe(6)
    // Pace basis: no coverage receipts on a fresh install ⇒ 0 observed days, honestly.
    expect(body.observedDays).toMatchObject({ month: 0 })
    expect((body.observedDays as { daysIntoMonth: number }).daysIntoMonth).toBeGreaterThan(0)
  })

  it('defaults to a 24h window when none is given', async () => {
    const { body } = await callRoute(findRoute(activated.routes, 'GET', '/spend')!, activated.ctx)
    expect(body.window).toBe('24h')
  })
})

describe('GET /coverage', () => {
  it('reports observed-days coverage and an honest no-suggestion state on a fresh install (no receipts yet)', async () => {
    const { status, body } = await callRoute(findRoute(activated.routes, 'GET', '/coverage')!, activated.ctx)
    expect(status).toBe(200)
    expect(body.lookbackDays).toBe(30)
    expect(body.coveredDays).toEqual([])
    expect((body.uncoveredDays as string[]).length).toBe(30)
    expect(body.suggestion).toEqual({ status: 'insufficient_history', coveredDays: 0, daysNeeded: 14 })
    // Spend recorded on unobserved days is reported, never blended into a rate.
    expect((body.uncovered as { window: { global: { meteredUsdMicros: number } } }).window.global.meteredUsdMicros).toBe(150_000)
  })
})

describe('POST /milestones/:id/ack', () => {
  it('acknowledges a live row once; a second ack (or an unknown id) is 404', async () => {
    const { recordMilestoneCrossings } = await import('../../../src/core/execution-ledger')
    const [row] = recordMilestoneCrossings([{ ruleId: 'g', window: 'daily', windowStartMs: 0, milestone: 90, spentValue: 9, capValue: 10, unit: 'usd_micros', crossedAt: 1 }])
    const route = findRoute(activated.routes, 'POST', '/milestones/:id/ack')!
    expect((await callRoute(route, activated.ctx, { searchParams: { id: String(row!.id) } })).status).toBe(200)
    expect((await callRoute(route, activated.ctx, { searchParams: { id: String(row!.id) } })).status).toBe(404)
    expect((await callRoute(route, activated.ctx, { searchParams: { id: '999999' } })).status).toBe(404)
  })
})
