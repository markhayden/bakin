/**
 * Pre-claim model hold (#907, S15/D31): the EFFECTIVE model a turn would run
 * on — route/tag → agent pin → runtime default — is checked for eligibility
 * in the agent's credential context BEFORE the claim. A dead selection holds
 * the task with the ref that is dead; unknown evidence never holds; an
 * install with zero budget rules still gets the hold.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync } from 'fs'

const dir = join(tmpdir(), `bakin-test-model-hold-${Date.now()}`)
mkdirSync(dir, { recursive: true })
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => dir, getBakinPaths: () => ({ home: dir, db: join(dir, 'bakin.db'), audit: join(dir, 'audit.jsonl') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => dir, getBakinPaths: () => ({ home: dir, db: join(dir, 'bakin.db'), audit: join(dir, 'audit.jsonl') }) }))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))
const auditCalls: unknown[][] = []
mock.module('../../src/core/audit', () => ({ appendAudit: (...a: unknown[]) => { auditCalls.push(a) } }))
mock.module('../../src/core/settings', () => ({ getSettings: () => ({ dispatch: { paused: false } }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => dir, getOpenClawPath: (s: string) => join(dir, s) }))

// Zero budget rules: the hold must not depend on budget status at all.
const hookRegistryMock = () => ({
  getHookRegistry: () => ({
    invoke: async (name: string) => (name === 'models.getBudgetPolicy' ? { rules: [] } : null),
    has: () => true,
  }),
})
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)
mock.module('../../src/core/execution-ledger', () => ({
  resolveExpiredBudgetIncidents: () => 0,
  findOpenCapIncident: () => null,
  listModelRejections: () => [],
  openBudgetIncident: () => ({ opened: false, id: 0 }),
  claimNextRun: () => ({ claimed: false }),
  settleRun: () => true,
  loseRun: () => true,
  currentSeq: () => 0,
  recordRunCost: () => {},
  LedgerUnavailableError: class extends Error {},
}))

import { createMockRuntimeAdapter, mockCredentials } from '../../packages/core/src/adapters/runtime/testing'

const LIVE = 'openai-codex/gpt-5.5'
const DEAD = 'openai/gpt-5.6-luna'
const agents = new Map<string, { model?: string }>([['pixel', {}], ['enrich', { model: DEAD }]])
let defaultModel = LIVE
const base = createMockRuntimeAdapter({
  credentials: mockCredentials([{ providerId: 'openai-codex', configured: true }, { providerId: 'openai', configured: false }]),
})
const runtime = {
  ...base,
  agents: { ...base.agents, get: async (id: string) => (agents.has(id) ? { id, name: id, ...agents.get(id) } : null) },
  models: {
    ...base.models,
    listAvailable: async () => [
      { id: LIVE, available: true },
      { id: DEAD, available: false, unavailableReason: 'no_credentials' as const },
      { id: 'openai-codex/gpt-5.6-luna', available: true },
    ],
    routingPolicy: async () => ({ defaultModel, fallbackModels: [], defaultSubagentModel: null, aliases: {} }),
  },
}
mock.module('../../src/core/app-services-store', () => ({ getAppServices: () => ({ runtime }) }))
mock.module('@/core/app-services-store', () => ({ getAppServices: () => ({ runtime }) }))

import { explainDeadSelectionFailure, preDispatchGate, _resetModelHoldMemo } from '../../src/core/dispatch-turns'
import { RuntimeError } from '../../packages/core/src/adapters/runtime'

afterAll(() => rmSync(dir, { recursive: true, force: true }))
beforeEach(() => { _resetModelHoldMemo(); auditCalls.length = 0; defaultModel = LIVE })

describe('preDispatchGate — effective-model hold', () => {
  it('healthy uncapped dispatch: eligible pin, zero rules ⇒ no hold', async () => {
    agents.set('pixel', { model: LIVE })
    expect(await preDispatchGate('pixel', dir, undefined, { taskId: 't1' })).toBeNull()
  })

  it('inherited dead agent pin ⇒ hold naming agent:<id>:model, audited once per task', async () => {
    const hold = await preDispatchGate('enrich', dir, undefined, { taskId: 't2' })
    expect(hold).toEqual({ reason: 'model_not_eligible', ref: 'agent:enrich:model', model: DEAD, code: 'no_credentials', detail: 'no credentials for openai', proposal: 'openai-codex/gpt-5.6-luna' })
    await preDispatchGate('enrich', dir, undefined, { taskId: 't2' })
    const audits = auditCalls.filter((a) => a[1] === 'task.deferred')
    expect(audits).toHaveLength(1)
    expect(audits[0]![3]).toMatchObject({ taskId: 't2', reason: 'model_not_eligible', ref: 'agent:enrich:model' })
  })

  it('inherited dead runtime default ⇒ hold naming policy:defaultModel', async () => {
    agents.set('pixel', {})
    defaultModel = DEAD
    const hold = await preDispatchGate('pixel', dir, undefined, { taskId: 't3' })
    expect(hold).toMatchObject({ reason: 'model_not_eligible', ref: 'policy:defaultModel', model: DEAD })
  })

  it('a routed dead model names the route (class) or the tag override', async () => {
    agents.set('pixel', { model: LIVE })
    const byClass = await preDispatchGate('pixel', dir, undefined, { model: DEAD, routeSource: 'class', workClass: 'scheduled', taskId: 't4' })
    expect(byClass).toMatchObject({ reason: 'model_not_eligible', ref: 'route:scheduled' })
    const byTag = await preDispatchGate('pixel', dir, undefined, { model: DEAD, routeSource: 'tag:legal', workClass: 'scheduled', taskId: 't5' })
    expect(byTag).toMatchObject({ ref: 'tag:legal' })
  })

  it('a model the catalog lacks entirely is not_in_catalog; unknown evidence never holds', async () => {
    agents.set('pixel', { model: 'openai-codex/gpt-4.9-retired' })
    expect(await preDispatchGate('pixel', dir, undefined, { taskId: 't6' })).toMatchObject({ ref: 'agent:pixel:model', detail: expect.stringMatching(/not in the runtime's model catalog/) })
    // Catalog read failure ⇒ unknown ⇒ no hold (fail open on missing evidence).
    const listAvailable = runtime.models.listAvailable
    runtime.models.listAvailable = async () => { throw new Error('gateway down') }
    _resetModelHoldMemo()
    try {
      expect(await preDispatchGate('pixel', dir, undefined, { taskId: 't7' })).toBeNull()
    } finally {
      runtime.models.listAvailable = listAvailable
    }
  })
})

describe('explainDeadSelectionFailure — the true remediation (S2)', () => {
  it("translates Pi's auth-unavailable cooldown on a dead pin into the #907 message with the same-id proposal", async () => {
    const err = new RuntimeError('Pi provider auth unavailable: No API key found for openai. Use /login to log into a provider', {
      kind: 'provider_cooldown',
      providerInfo: { model: DEAD, authProfileUnavailable: true },
    })
    const explained = await explainDeadSelectionFailure(err, 'enrich', runtime)
    expect(explained).toEqual({
      message: "The 'enrich' agent uses openai/gpt-5.6-luna, but this install has no credentials for openai. Use openai-codex/gpt-5.6-luna instead? Fix in Models.",
      ref: 'agent:enrich:model',
      model: DEAD,
      proposal: 'openai-codex/gpt-5.6-luna',
      href: '/models?ref=agent%3Aenrich%3Amodel',
    })
  })

  it('leaves unrelated failures and healthy selections alone (classification by kind, never message text)', async () => {
    agents.set('pixel', { model: LIVE })
    const cooldownOnHealthy = new RuntimeError('No API key found for openai. Use /login', { kind: 'provider_cooldown', providerInfo: { authProfileUnavailable: true } })
    expect(await explainDeadSelectionFailure(cooldownOnHealthy, 'pixel', runtime)).toBeNull()
    const transport = new RuntimeError('No API key found for openai. Use /login', { kind: 'transport' })
    expect(await explainDeadSelectionFailure(transport, 'enrich', runtime)).toBeNull()
    expect(await explainDeadSelectionFailure(new Error('plain'), 'enrich', runtime)).toBeNull()
  })
})
