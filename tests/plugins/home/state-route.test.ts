/**
 * GET /api/plugins/home/state (home-first-run plan, task 1.6): the real
 * route through the plugin harness, with the harness's mock runtime.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { ActivatedPlugin } from '../test-helpers'

const testDir = join(tmpdir(), `bakin-test-home-route-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
mock.module('../../../src/core/watcher', () => ({ startWatcher: () => {}, stopWatcher: () => {} }))
mock.module('../../../src/core/agent-packages/capability-readiness', () => ({ listCapabilities: async () => [] }))
mock.module('../../../src/core/model-eligibility', () => ({
  getModelEligibility: async (_runtime: unknown, opts: { extraIds?: string[] }) => ({ byModel: new Map((opts.extraIds ?? []).map((id) => [id, { eligibility: { status: 'eligible' } }])) }),
}))

let syncOutcome: { status: string; outcome?: { message?: string } } = { status: 'succeeded' }
const syncsStarted: string[] = []
mock.module('../../../src/core/operations', () => ({
  getOperationRegistry: () => ({
    start: async (input: { kind: string }) => { syncsStarted.push(input.kind); return { operationId: 'op-1' } },
    await: async () => syncOutcome,
  }),
}))
mock.module('../../../src/core/onboarding/index', () => ({ installableComponent: (name: string) => ({ name, resources: [], plan: { stages: [], pointOfNoReturn: null } }) }))
mock.module('../../../src/core/onboarding/operation', () => ({ componentInstallOperation: (component: { name: string }) => ({ kind: `onboarding:${component.name}` }) }))
const operatorNames: string[] = []
mock.module('../../../src/core/team-context', () => ({ setOperatorName: (name: string) => { operatorNames.push(name); return true } }))

import homePlugin from '../../../plugins/home'
import { decisionsPath, readDecisions } from '../../../plugins/home/lib/decisions'
import type { HomeStateResponse } from '../../../plugins/home/types'
import { activatePlugin, callRoute, findRoute } from '../test-helpers'

let activated: ActivatedPlugin
/** What the stand-in runtime answers; the route reads only these members. */
let roster: Array<{ id: string; name: string; role?: string }> = []
let providers: string[] = []
let rosterThrows = false

beforeAll(async () => {
  activated = await activatePlugin(homePlugin, testDir)
  const runtime = activated.ctx.runtime as unknown as Record<string, unknown>
  runtime.agents = {
    ...(runtime.agents as object),
    list: async () => { if (rosterThrows) throw new Error('runtime down'); return roster },
    readWorkspaceFile: async () => null,
  }
  runtime.credentialStatus = async () => ({ llmProviders: providers, channels: [] })
  runtime.models = { ...(runtime.models as object), routingPolicy: async () => ({ defaultModel: '', fallbackModels: [], defaultSubagentModel: null, aliases: {} }) }
})
const identityUpdates: Array<Record<string, unknown>> = []
let identityThrows = false
beforeEach(() => {
  roster = [{ id: 'main', name: 'Main', role: 'orchestrator' }]
  providers = []
  rosterThrows = false
  syncOutcome = { status: 'succeeded' }
  syncsStarted.length = 0
  operatorNames.length = 0
  identityUpdates.length = 0
  identityThrows = false
  rmSync(join(testDir, 'plugin-data'), { recursive: true, force: true })
  // Team's hook, as the harness's registry would route it; it renames the roster entry.
  const invoke = activated.ctx.hooks.invoke as unknown as { mockImplementation: (fn: (name: string, data: Record<string, unknown>) => Promise<unknown>) => void }
  invoke.mockImplementation(async (name, data) => {
    if (name !== 'team.updateIdentity') return undefined
    if (identityThrows) throw new Error('runtime refused the rename')
    identityUpdates.push(data)
    roster = roster.map((agent) => (agent.id === data.agentId ? { ...agent, name: String(data.name) } : agent))
    return { updated: ['name', 'vibe', 'soul'] }
  })
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

async function state(): Promise<HomeStateResponse> {
  const route = findRoute(activated.routes, 'GET', '/state')!
  const res = await callRoute(route, activated.ctx)
  expect(res.status).toBe(200)
  return res.body as unknown as HomeStateResponse
}

describe('GET /state', () => {
  it('a fresh home: meet your agent, with the starters that need nothing', async () => {
    const body = await state()
    expect(body.state).toEqual({ name: 'meet-agent', agent: { id: 'main', name: 'Main' } })
    expect(body.starters.map((starter) => starter.id)).toEqual(['schedule-recurring', 'summarize-document', 'goal-into-tasks', 'draft-something', 'brainstorm', 'daily-briefing', 'show-me'])
    expect(body.starters.find((starter) => starter.id === 'summarize-document')?.needsAttachment).toBe(true)
  })

  it('a named agent with no provider logged in needs a login, and is told how on the active runtime', async () => {
    roster = [{ id: 'main', name: 'Nova', role: 'orchestrator' }]
    const body = await state()
    expect(body.state).toEqual({ name: 'needs-login', agent: { id: 'main', name: 'Nova' } })
    // The harness home runs the default runtime; its own steps come through untouched.
    expect(body.login?.runtime).toBe('OpenClaw')
    expect(body.login?.steps.length).toBeGreaterThan(0)
    expect(body.login?.docsUrl).toMatch(/^https:/)
  })

  it('no login help is sent when no login is needed', async () => {
    roster = [{ id: 'main', name: 'Nova', role: 'orchestrator' }]
    providers = ['openai-codex']
    expect((await state()).login).toBeUndefined()
    roster = [{ id: 'main', name: 'Main', role: 'orchestrator' }]
    providers = []
    expect((await state()).login).toBeUndefined() // meet-agent comes first
  })

  it('a named agent with a login is ready', async () => {
    roster = [{ id: 'main', name: 'Nova', role: 'orchestrator' }]
    providers = ['openai-codex']
    expect((await state()).state).toEqual({ name: 'ready', agent: { id: 'main', name: 'Nova' } })
  })

  it('a runtime that cannot be read is unavailable and points at Health', async () => {
    rosterThrows = true
    expect((await state()).state).toEqual({ name: 'unavailable', reason: 'runtime_unreachable', href: '/health' })
  })

  it('reading the state writes nothing', async () => {
    await state()
    expect(existsSync(decisionsPath())).toBe(false)
  })
})

describe('POST /introduction', () => {
  const ANSWERS = { agentName: 'Nova', personality: { kind: 'preset' as const, id: 'warm' }, userName: 'Mark' }
  const introduce = (body: unknown = ANSWERS) => callRoute(findRoute(activated.routes, 'POST', '/introduction')!, activated.ctx, { body })

  it('names the main agent through Team, records the person, syncs, and Home moves on', async () => {
    const res = await introduce()
    expect(res.status).toBe(200)
    expect(identityUpdates).toEqual([expect.objectContaining({ agentId: 'main', name: 'Nova', vibe: 'Warm and encouraging' })])
    expect(operatorNames).toEqual(['Mark'])
    expect(syncsStarted).toEqual(['onboarding:agent-sync'])
    expect(readDecisions().introduction?.status).toBe('completed')
    // The host prefixes the plugin id: the event is recorded as home.introduction_completed.
    expect(activated.ctx.activity.audit).toHaveBeenCalledWith('introduction_completed', 'human', { agent: 'main' })
    expect((await state()).state).toEqual({ name: 'needs-login', agent: { id: 'main', name: 'Nova' } })
  })

  it('a sync that fails answers 502 naming the step, and the state route still offers the introduction with the answers', async () => {
    syncOutcome = { status: 'failed', outcome: { message: 'install-state is busy' } }
    const res = await introduce()
    expect(res.status).toBe(502)
    expect(res.body).toEqual({ ok: false, step: 'sync', error: 'install-state is busy' })
    // The agent is already called Nova, yet the introduction is not hidden.
    expect((await state()).state).toEqual({ name: 'meet-agent', agent: { id: 'main', name: 'Nova' }, resume: ANSWERS })
    syncOutcome = { status: 'succeeded' }
    expect((await introduce()).status).toBe(200)
    expect((await state()).state.name).toBe('needs-login')
  })

  it('a rename the runtime refuses stops there: nothing else is written', async () => {
    identityThrows = true
    const res = await introduce()
    expect(res.status).toBe(502)
    expect(res.body).toMatchObject({ ok: false, step: 'identity' })
    expect(operatorNames).toEqual([])
    expect(syncsStarted).toEqual([])
  })

  it('refuses answers it cannot use before writing anything: a blank name, an unknown personality', async () => {
    expect((await introduce({ ...ANSWERS, agentName: '   ' })).status).toBe(400)
    expect((await introduce({ ...ANSWERS, personality: { kind: 'preset', id: 'grumpy' } })).status).toBe(400)
    expect(identityUpdates).toEqual([])
    expect(existsSync(decisionsPath())).toBe(false)
  })
})

describe('POST /introduction/skip', () => {
  it('records the skip; Home stops opening on the introduction', async () => {
    expect((await state()).introductionSkipped).toBe(false)
    const res = await callRoute(findRoute(activated.routes, 'POST', '/introduction/skip')!, activated.ctx)
    expect(res.status).toBe(200)
    // Home keeps a way back to an introduction that was skipped.
    expect((await state()).introductionSkipped).toBe(true)
    expect((await state()).state.name).toBe('needs-login')
  })
})

describe('what the plugin is allowed to do', () => {
  it('declares the permission its audit record needs', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, '../../../plugins/home/bakin-plugin.json'), 'utf8')) as { permissions: string[] }
    expect(manifest.permissions).toContain('events.emit')
  })
})

describe('saying hello', () => {
  const ANSWERS = { agentName: 'Nova', personality: { kind: 'preset' as const, id: 'warm' }, userName: 'Mark' }

  it('is offered once the introduction is completed, and not after the hello is recorded', async () => {
    expect((await state()).hello).toBe(false)
    await callRoute(findRoute(activated.routes, 'POST', '/introduction')!, activated.ctx, { body: ANSWERS })
    expect((await state()).hello).toBe(true)
    const res = await callRoute(findRoute(activated.routes, 'POST', '/hello')!, activated.ctx)
    expect(res.status).toBe(200)
    expect((await state()).hello).toBe(false)
    expect(readDecisions().introduction?.status).toBe('completed')
    // Doing it again later (reopened) keeps both records.
    expect((await callRoute(findRoute(activated.routes, 'POST', '/introduction')!, activated.ctx, { body: { ...ANSWERS, agentName: 'Juno' } })).status).toBe(200)
    const again = await state()
    expect([again.state, again.hello, again.introductionSkipped]).toEqual([{ name: 'needs-login', agent: { id: 'main', name: 'Juno' } }, false, false])
  })

  it('is not offered after a skip: nobody was introduced', async () => {
    await callRoute(findRoute(activated.routes, 'POST', '/introduction/skip')!, activated.ctx)
    expect((await state()).hello).toBe(false)
  })
})

describe('GET /state — what the introduction needs', () => {
  it('offers the four personalities, each with a sample line, and never the personality text itself', async () => {
    const body = await state()
    expect(body.personalities.map((preset) => preset.id)).toEqual(['warm', 'direct', 'witty', 'calm'])
    expect(Object.keys(body.personalities[0]!).sort()).toEqual(['id', 'label', 'sample'])
  })
})
