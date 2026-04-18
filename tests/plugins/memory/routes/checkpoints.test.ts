/**
 * Tests for plugins/memory/lib/routes/checkpoints.ts.
 *
 * Both endpoints hit the indexed `bakin_memory` table (tier=checkpoint) —
 * neither re-reads the filesystem. The adapter and gateway are mocked
 * defensively so a missing `~/.openclaw/` never leaks through.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-checkpoints-route-${Date.now()}`)

vi.mock('../../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('../../../../packages/core/src/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, '.openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, '.openclaw', ...parts),
}))

import {
  checkpointsListRoute,
  checkpointDetailRoute,
} from '../../../../plugins/memory/lib/routes/checkpoints'
import type { PluginContext, SearchResponse } from '../../../../src/lib/plugin-types'

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
    registerNav: vi.fn(),
    registerRoute: vi.fn(),
    registerSlot: vi.fn(),
    registerExecTool: vi.fn(),
    registerSkill: vi.fn(),
    watchFiles: vi.fn(),
    getSettings: (() => ({})) as PluginContext['getSettings'],
    updateSettings: vi.fn(),
    activity: { log: vi.fn(), audit: vi.fn() },
    search: {
      registerContentType: vi.fn(),
      registerFileBackedContentType: vi.fn(),
      index: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      transform: vi.fn(async () => {}),
      query: vi.fn(async (p) => {
        queryCalls.push(p)
        return queryResponse
      }),
    },
    hooks: {
      register: vi.fn(() => () => {}),
      has: vi.fn(() => false),
      invoke: vi.fn(async () => undefined),
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

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── checkpointsListRoute ────────────────────────────────────────────────

describe('checkpointsListRoute — shape', () => {
  it('is a GET /checkpoints route', () => {
    expect(checkpointsListRoute.method).toBe('GET')
    expect(checkpointsListRoute.path).toBe('/checkpoints')
  })
})

describe('checkpointsListRoute — handler', () => {
  it('returns 400 when agent is missing', async () => {
    const { ctx } = makeCtx()
    const res = await checkpointsListRoute.handler(req('/checkpoints', {}), ctx)
    expect(res.status).toBe(400)
  })

  it('queries bakin_memory with tier=checkpoint filter scoped by agent', async () => {
    const h = makeCtx()
    h.queryImpl({
      results: [
        { id: 'checkpoint:abcd', table: 'bakin_memory', score: 0.9, fields: { title: 'cp' } },
      ],
      meta: { query: '', total: 1, took_ms: 1, source: 'antfly' },
    })
    const res = await checkpointsListRoute.handler(
      req('/checkpoints', { agent: 'main' }),
      h.ctx,
    )
    const body = await res.json() as { checkpoints: Array<Record<string, unknown>>; total: number }
    expect(res.status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.checkpoints).toHaveLength(1)
    expect(h.queryCalls[0].filters).toEqual({ tier: 'checkpoint', agent: 'main' })
    expect(h.queryCalls[0].q).toBe('')
  })

  it('passes sessionId as q-string when provided', async () => {
    const h = makeCtx()
    await checkpointsListRoute.handler(
      req('/checkpoints', { agent: 'main', sessionId: 'sess-1' }),
      h.ctx,
    )
    expect(h.queryCalls[0].q).toBe('sess-1')
    expect(h.queryCalls[0].filters).toEqual({ tier: 'checkpoint', agent: 'main' })
  })

  it('clamps excessive limits to the 100 default', async () => {
    const h = makeCtx()
    await checkpointsListRoute.handler(
      req('/checkpoints', { agent: 'main', limit: '99999' }),
      h.ctx,
    )
    expect(h.queryCalls[0].limit).toBe(100)
  })

  it('accepts a valid in-range limit', async () => {
    const h = makeCtx()
    await checkpointsListRoute.handler(
      req('/checkpoints', { agent: 'main', limit: '25' }),
      h.ctx,
    )
    expect(h.queryCalls[0].limit).toBe(25)
  })
})

// ─── checkpointDetailRoute ───────────────────────────────────────────────

describe('checkpointDetailRoute — shape', () => {
  it('is a GET /checkpoints/:agent/:sessionId/:checkpointId route', () => {
    expect(checkpointDetailRoute.method).toBe('GET')
    expect(checkpointDetailRoute.path).toBe('/checkpoints/:agent/:sessionId/:checkpointId')
  })
})

describe('checkpointDetailRoute — handler', () => {
  it('returns 400 when any param is missing', async () => {
    const { ctx } = makeCtx()
    const res = await checkpointDetailRoute.handler(
      req('/checkpoints/main/sess-1', { agent: 'main', sessionId: 'sess-1' }),
      ctx,
    )
    expect(res.status).toBe(400)
  })

  it('returns the matching row when meta carries the right ids', async () => {
    const h = makeCtx()
    h.queryImpl({
      results: [
        {
          id: 'checkpoint:wrong1',
          table: 'bakin_memory',
          score: 0.8,
          fields: {
            meta: JSON.stringify({ sessionId: 'other', checkpointId: 'nope' }),
            title: 'other',
          },
        },
        {
          id: 'checkpoint:right1',
          table: 'bakin_memory',
          score: 0.9,
          fields: {
            meta: JSON.stringify({ sessionId: 'sess-1', checkpointId: 'cp-a' }),
            title: 'hit',
          },
        },
      ],
      meta: { query: '', total: 2, took_ms: 1, source: 'antfly' },
    })
    const res = await checkpointDetailRoute.handler(
      req('/checkpoints/main/sess-1/cp-a', {
        agent: 'main',
        sessionId: 'sess-1',
        checkpointId: 'cp-a',
      }),
      h.ctx,
    )
    const body = await res.json() as Record<string, unknown>
    expect(res.status).toBe(200)
    expect(body.id).toBe('checkpoint:right1')
    expect(body.title).toBe('hit')
    expect(h.queryCalls[0].filters).toEqual({ tier: 'checkpoint', agent: 'main' })
  })

  it('returns 404 when no meta entry matches both ids', async () => {
    const h = makeCtx()
    h.queryImpl({
      results: [
        {
          id: 'checkpoint:x',
          table: 'bakin_memory',
          score: 0.5,
          fields: {
            meta: JSON.stringify({ sessionId: 'not-sess', checkpointId: 'not-cp' }),
          },
        },
      ],
      meta: { query: '', total: 1, took_ms: 1, source: 'antfly' },
    })
    const res = await checkpointDetailRoute.handler(
      req('/checkpoints/main/sess-1/cp-a', {
        agent: 'main',
        sessionId: 'sess-1',
        checkpointId: 'cp-a',
      }),
      h.ctx,
    )
    expect(res.status).toBe(404)
  })

  it('tolerates results whose meta is not valid JSON', async () => {
    const h = makeCtx()
    h.queryImpl({
      results: [
        { id: 'checkpoint:bad', table: 'bakin_memory', score: 0.3, fields: { meta: '{not json' } },
      ],
      meta: { query: '', total: 1, took_ms: 1, source: 'antfly' },
    })
    const res = await checkpointDetailRoute.handler(
      req('/checkpoints/main/sess-1/cp-a', {
        agent: 'main',
        sessionId: 'sess-1',
        checkpointId: 'cp-a',
      }),
      h.ctx,
    )
    expect(res.status).toBe(404)
  })
})
