/**
 * Tests for plugins/memory/lib/routes/sessions.ts — session + turn tier HTTP surface.
 *
 * Four routes:
 *   GET /sessions                              — list sessions for an agent
 *   GET /sessions/:agent/:sessionKey           — one session detail
 *   GET /sessions/:agent/:sessionKey/turns     — turns indexed for that session
 *   GET /turns                                 — turns by (agent, sessionId)
 *
 * Data flow mirrors the indexer:
 *   - Session list/detail: runtime memory session-store reads
 *   - Turn list: ctx.search.query against the indexed `bakin_memory` table
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-sessions-route-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../../packages/core/src/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, '.openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, '.openclaw', ...parts),
}))

const {
  mockReadSessionStore,
} = (() => ({
  mockReadSessionStore: mock<(agent: string) => unknown>(),
}))()

import {
  sessionsListRoute,
  sessionDetailRoute,
  sessionTurnsRoute,
  turnsListRoute,
} from '../../../../plugins/memory/lib/routes/sessions'
import type { PluginContext, SearchResponse } from '@bakin/core/plugin-types'

interface CtxHarness {
  ctx: PluginContext
  queryCalls: Array<Parameters<PluginContext['search']['query']>[0]>
  queryImpl: (result: SearchResponse) => void
}

function makeCtx(): CtxHarness {
  const queryCalls: CtxHarness['queryCalls'] = []
  let queryResponse: SearchResponse = {
    results: [],
    meta: { query: '', total: 0, took_ms: 0, source: 'fallback' },
  }
  const ctx = {
    pluginId: 'memory',
    storage: {} as PluginContext['storage'],
    events: {} as PluginContext['events'],
    registerNav: mock(),
    registerRoute: mock(),
    registerSlot: mock(),
    registerExecTool: mock(),
    registerSkill: mock(),
    watchFiles: mock(),
    getSettings: (() => ({})) as PluginContext['getSettings'],
    updateSettings: mock(),
    activity: { log: mock(), audit: mock() },
    runtime: {
      memory: {
        listTiers: mock(async () => [{ id: 'sessions-tier', label: 'Sessions', metadata: { sourceKind: 'session_store' } }]),
        getEntry: mock(async (_tierId: string, id: string, opts?: { agentId?: string }) => {
          const agent = opts?.agentId ?? ''
          const value = id === 'sessions.json' ? mockReadSessionStore(agent) : null
          return value === null || value === undefined
            ? null
            : {
                id,
                tierId: 'sessions-tier',
                agentId: agent,
                path: `/fake/${agent}/sessions.json`,
                content: JSON.stringify(value),
              }
        }),
      },
    },
    search: {
      registerContentType: mock(),
      registerFileBackedContentType: mock(),
      index: mock(async () => {}),
      remove: mock(async () => {}),
      transform: mock(async () => {}),
      query: mock(async (p) => {
        queryCalls.push(p)
        return queryResponse
      }),
    },
    hooks: {
      register: mock(() => () => {}),
      has: mock(() => false),
      invoke: mock(async () => undefined),
    },
  } as unknown as PluginContext
  return {
    ctx,
    queryCalls,
    queryImpl: (r) => { queryResponse = r },
  }
}

function req(path: string, params: Record<string, string>): Request {
  const url = new URL(`http://localhost${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url, { method: 'GET' })
}

function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: 'sid-1',
    updatedAt: Date.now(),
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    model: 'claude-opus-4-7',
    modelProvider: 'anthropic',
    ...overrides,
  }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mockReadSessionStore.mockReset()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── sessionsListRoute ────────────────────────────────────────────────────

describe('sessionsListRoute — shape', () => {
  it('is a GET /sessions route', () => {
    expect(sessionsListRoute.method).toBe('GET')
    expect(sessionsListRoute.path).toBe('/sessions')
  })
})

describe('sessionsListRoute — handler', () => {
  it('returns 400 when agent is missing', async () => {
    const { ctx } = makeCtx()
    const res = await sessionsListRoute.handler(req('/sessions', {}), ctx)
    expect(res.status).toBe(400)
  })

  it('lists sessions from the runtime store sorted by updatedAt desc', async () => {
    mockReadSessionStore.mockReturnValue({
      sessions: {
        'agent:chef:main': session({ updatedAt: 1000 }),
        'agent:chef:openai:xyz': session({ updatedAt: 2000 }),
      },
    })
    const { ctx } = makeCtx()
    const res = await sessionsListRoute.handler(req('/sessions', { agent: 'chef' }), ctx)
    const body = await res.json() as { sessions: Array<Record<string, unknown>> }
    expect(res.status).toBe(200)
    expect(body.sessions.map((s) => s.sessionKey)).toEqual([
      'agent:chef:openai:xyz',
      'agent:chef:main',
    ])
    expect(body.sessions[0].kind).toBe('openai')
    expect(body.sessions[1].kind).toBe('main')
  })

  it('reads plain session maps from the runtime store', async () => {
    mockReadSessionStore.mockReturnValue({ 'agent:chef:main': session() })
    const { ctx } = makeCtx()
    const res = await sessionsListRoute.handler(req('/sessions', { agent: 'chef' }), ctx)
    const body = await res.json() as { sessions: unknown[] }
    expect(body.sessions).toHaveLength(1)
  })

  it('filters by kind query param', async () => {
    mockReadSessionStore.mockReturnValue({
      'agent:chef:main': session({ sessionId: 'a' }),
      'agent:chef:openai:xyz': session({ sessionId: 'b' }),
      'agent:chef:discord:42': session({ sessionId: 'c' }),
    })
    const { ctx } = makeCtx()
    const res = await sessionsListRoute.handler(
      req('/sessions', { agent: 'chef', kind: 'openai' }),
      ctx,
    )
    const body = await res.json() as { sessions: Array<Record<string, unknown>> }
    expect(body.sessions).toHaveLength(1)
    expect(body.sessions[0].sessionKey).toBe('agent:chef:openai:xyz')
  })

  it('returns empty when the runtime store has no data', async () => {
    mockReadSessionStore.mockReturnValue(null)
    const { ctx } = makeCtx()
    const res = await sessionsListRoute.handler(req('/sessions', { agent: 'orphan' }), ctx)
    const body = await res.json() as { sessions: unknown[] }
    expect(body.sessions).toEqual([])
  })
})

// ─── sessionDetailRoute ────────────────────────────────────────────────────

describe('sessionDetailRoute — handler', () => {
  it('is a GET /sessions/:agent/:sessionKey route', () => {
    expect(sessionDetailRoute.path).toBe('/sessions/:agent/:sessionKey')
  })

  it('returns 400 when either param missing', async () => {
    const { ctx } = makeCtx()
    const res = await sessionDetailRoute.handler(req('/sessions/chef', { agent: 'chef' }), ctx)
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown session key', async () => {
    mockReadSessionStore.mockReturnValue({ 'agent:chef:main': session() })
    const { ctx } = makeCtx()
    const res = await sessionDetailRoute.handler(
      req('/sessions/chef/missing', { agent: 'chef', sessionKey: 'agent:chef:missing' }),
      ctx,
    )
    expect(res.status).toBe(404)
  })

  it('returns the session with kind extracted', async () => {
    mockReadSessionStore.mockReturnValue({ 'agent:chef:main': session({ sessionId: 'x' }) })
    const { ctx } = makeCtx()
    const res = await sessionDetailRoute.handler(
      req('/sessions/chef/main', { agent: 'chef', sessionKey: 'agent:chef:main' }),
      ctx,
    )
    const body = await res.json() as Record<string, unknown>
    expect(res.status).toBe(200)
    expect(body.kind).toBe('main')
    expect(body.sessionId).toBe('x')
  })
})

// ─── sessionTurnsRoute + turnsListRoute ────────────────────────────────────

describe('sessionTurnsRoute — handler', () => {
  it('queries search with tier=turn filter scoped by sessionKey', async () => {
    const h = makeCtx()
    h.queryImpl({
      results: [{ id: 'turn:abc', table: 'bakin_memory', score: 0.5, fields: { title: 'hi' } }],
      meta: { query: 'agent:chef:main', total: 1, took_ms: 1, source: 'search' },
    })
    const res = await sessionTurnsRoute.handler(
      req('/sessions/chef/main/turns', {
        agent: 'chef',
        sessionKey: 'agent:chef:main',
        limit: '50',
      }),
      h.ctx,
    )
    const body = await res.json() as { turns: Array<Record<string, unknown>>; total: number }
    expect(res.status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.turns).toHaveLength(1)
    expect(h.queryCalls[0].filters).toEqual({ tier: 'turn', agent: 'chef' })
    expect(h.queryCalls[0].q).toBe('agent:chef:main')
    expect(h.queryCalls[0].limit).toBe(50)
  })

  it('honors eventType filter and clamps excessive limits', async () => {
    const h = makeCtx()
    await sessionTurnsRoute.handler(
      req('/sessions/chef/main/turns', {
        agent: 'chef',
        sessionKey: 'agent:chef:main',
        eventType: 'tool_call',
        limit: '99999',
      }),
      h.ctx,
    )
    expect(h.queryCalls[0].filters?.eventType).toBe('tool_call')
    expect(h.queryCalls[0].limit).toBe(100) // clamps to default when out-of-range
  })
})

describe('turnsListRoute — handler', () => {
  it('queries by (agent, sessionId) — note sessionId not key', async () => {
    const h = makeCtx()
    await turnsListRoute.handler(
      req('/turns', { agent: 'chef', sessionId: 'sess-a' }),
      h.ctx,
    )
    expect(h.queryCalls[0].filters).toEqual({ tier: 'turn', agent: 'chef' })
  })

  it('returns 400 when agent or sessionId missing', async () => {
    const { ctx } = makeCtx()
    const res = await turnsListRoute.handler(req('/turns', { agent: 'chef' }), ctx)
    expect(res.status).toBe(400)
  })
})
