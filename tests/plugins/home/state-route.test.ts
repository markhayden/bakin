/**
 * GET /api/plugins/home/state (home-first-run plan, task 1.6): the real
 * route through the plugin harness, with the harness's mock runtime.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
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

import homePlugin from '../../../plugins/home'
import { decisionsPath } from '../../../plugins/home/lib/decisions'
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
beforeEach(() => {
  roster = [{ id: 'main', name: 'Main', role: 'orchestrator' }]
  providers = []
  rosterThrows = false
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

  it('a named agent with no provider logged in needs a login', async () => {
    roster = [{ id: 'main', name: 'Nova', role: 'orchestrator' }]
    expect((await state()).state).toEqual({ name: 'needs-login', agent: { id: 'main', name: 'Nova' } })
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
