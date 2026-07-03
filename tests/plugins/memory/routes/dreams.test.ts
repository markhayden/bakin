/**
 * Tests for plugins/memory/lib/routes/dreams.ts.
 *
 * Both endpoints hit the indexed `bakin_memory` table (tier=dream) — routes
 * never re-read the filesystem. Runtime memory is mocked
 * defensively so a missing `~/.openclaw/` never leaks through.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-dreams-route-${Date.now()}`)

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
mock.module('../../../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => join(testDir, '.openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, '.openclaw', ...parts),
}))

import {
  dreamsListRoute,
  dreamDetailRoute,
} from '../../../../plugins/memory/lib/routes/dreams'
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
    meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' },
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

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── dreamsListRoute ─────────────────────────────────────────────────────

describe('dreamsListRoute — shape', () => {
  it('is a GET /dreams route', () => {
    expect(dreamsListRoute.method).toBe('GET')
    expect(dreamsListRoute.path).toBe('/dreams')
  })
})

describe('dreamsListRoute — handler', () => {
  it('returns 400 when agent is missing', async () => {
    const { ctx } = makeCtx()
    const res = await dreamsListRoute.handler(req('/dreams', {}), ctx, {})
    expect(res.status).toBe(400)
  })

  it('queries bakin_memory with tier=dream filter scoped by agent', async () => {
    const h = makeCtx()
    h.queryImpl({
      results: [
        {
          id: 'dream:abcd',
          table: 'bakin_memory',
          score: 0.9,
          fields: {
            title: 'Dream · light · 2026-04-17',
            meta: JSON.stringify({ artifactType: 'phase_doc', phase: 'light', date: '2026-04-17' }),
          },
        },
      ],
      meta: { query: '', total: 1, took_ms: 1, source: 'search' },
    })
    const res = await dreamsListRoute.handler(req('/dreams', { agent: 'main' }), h.ctx, {})
    const body = await res.json() as { dreams: Array<Record<string, unknown>>; total: number }
    expect(res.status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.dreams).toHaveLength(1)
    expect(h.queryCalls[0].filters).toEqual({ tier: 'dream', agent: 'main' })
    expect(h.queryCalls[0].q).toBe('*')
    expect(h.queryCalls[0].strategy).toBe('full_text_only')
  })

  it('passes phase as part of q-string when provided', async () => {
    const h = makeCtx()
    await dreamsListRoute.handler(req('/dreams', { agent: 'main', phase: 'light' }), h.ctx, {})
    expect(h.queryCalls[0].q).toContain('light')
    expect(h.queryCalls[0].filters).toEqual({ tier: 'dream', agent: 'main' })
    expect(h.queryCalls[0].strategy).toBe('full_text_only')
  })

  it('filters results by phase post-query when provided', async () => {
    const h = makeCtx()
    h.queryImpl({
      results: [
        {
          id: 'dream:light',
          table: 'bakin_memory',
          score: 0.9,
          fields: {
            meta: JSON.stringify({ artifactType: 'phase_doc', phase: 'light', date: '2026-04-17' }),
          },
        },
        {
          id: 'dream:rem',
          table: 'bakin_memory',
          score: 0.8,
          fields: {
            meta: JSON.stringify({ artifactType: 'phase_doc', phase: 'rem', date: '2026-04-17' }),
          },
        },
      ],
      meta: { query: '', total: 2, took_ms: 1, source: 'search' },
    })
    const res = await dreamsListRoute.handler(
      req('/dreams', { agent: 'main', phase: 'light' }),
      h.ctx,
      {} as any,
    )
    const body = await res.json() as { dreams: Array<Record<string, unknown>> }
    expect(body.dreams).toHaveLength(1)
    expect(body.dreams[0].id).toBe('dream:light')
  })

  it('filters results by date post-query when provided', async () => {
    const h = makeCtx()
    h.queryImpl({
      results: [
        {
          id: 'dream:a',
          table: 'bakin_memory',
          score: 0.9,
          fields: { meta: JSON.stringify({ artifactType: 'phase_doc', phase: 'light', date: '2026-04-17' }) },
        },
        {
          id: 'dream:b',
          table: 'bakin_memory',
          score: 0.8,
          fields: { meta: JSON.stringify({ artifactType: 'phase_doc', phase: 'light', date: '2026-04-16' }) },
        },
      ],
      meta: { query: '', total: 2, took_ms: 1, source: 'search' },
    })
    const res = await dreamsListRoute.handler(
      req('/dreams', { agent: 'main', date: '2026-04-17' }),
      h.ctx,
      {} as any,
    )
    const body = await res.json() as { dreams: Array<Record<string, unknown>> }
    expect(body.dreams).toHaveLength(1)
    expect(body.dreams[0].id).toBe('dream:a')
  })

  it('clamps excessive limits to the 100 default', async () => {
    const h = makeCtx()
    await dreamsListRoute.handler(req('/dreams', { agent: 'main', limit: '99999' }), h.ctx, {})
    expect(h.queryCalls[0].limit).toBe(100)
  })
})

// ─── dreamDetailRoute ────────────────────────────────────────────────────

describe('dreamDetailRoute — shape', () => {
  it('is a GET /dreams/:agent/:artifactType route', () => {
    expect(dreamDetailRoute.method).toBe('GET')
    expect(dreamDetailRoute.path).toBe('/dreams/:agent/:artifactType')
  })
})

describe('dreamDetailRoute — handler', () => {
  it('returns 400 when agent or artifactType is missing', async () => {
    const { ctx } = makeCtx()
    const res = await dreamDetailRoute.handler(
      req('/dreams/main/phase_doc', { agent: 'main' }),
      ctx,
      {} as any,
    )
    expect(res.status).toBe(400)
  })

  it('finds the matching row for a phase_doc (phase + date)', async () => {
    const h = makeCtx()
    h.queryImpl({
      results: [
        {
          id: 'dream:wrong',
          table: 'bakin_memory',
          score: 0.8,
          fields: {
            meta: JSON.stringify({ artifactType: 'phase_doc', phase: 'rem', date: '2026-04-17' }),
            title: 'other',
          },
        },
        {
          id: 'dream:right',
          table: 'bakin_memory',
          score: 0.9,
          fields: {
            meta: JSON.stringify({ artifactType: 'phase_doc', phase: 'light', date: '2026-04-17' }),
            title: 'hit',
          },
        },
      ],
      meta: { query: '', total: 2, took_ms: 1, source: 'search' },
    })
    const res = await dreamDetailRoute.handler(
      req('/dreams/main/phase_doc', {
        agent: 'main',
        artifactType: 'phase_doc',
        phase: 'light',
        date: '2026-04-17',
      }),
      h.ctx,
      {} as any,
    )
    const body = await res.json() as Record<string, unknown>
    expect(res.status).toBe(200)
    expect(body.id).toBe('dream:right')
    expect(body.title).toBe('hit')
  })

  it('finds a no-key artifact (short_term_recall) by artifactType alone', async () => {
    const h = makeCtx()
    h.queryImpl({
      results: [
        {
          id: 'dream:str',
          table: 'bakin_memory',
          score: 0.9,
          fields: {
            meta: JSON.stringify({ artifactType: 'short_term_recall', phase: null, date: null }),
            title: 'Dream · short-term recall',
          },
        },
      ],
      meta: { query: '', total: 1, took_ms: 1, source: 'search' },
    })
    const res = await dreamDetailRoute.handler(
      req('/dreams/main/short_term_recall', {
        agent: 'main',
        artifactType: 'short_term_recall',
      }),
      h.ctx,
      {} as any,
    )
    const body = await res.json() as Record<string, unknown>
    expect(res.status).toBe(200)
    expect(body.id).toBe('dream:str')
  })

  it('returns 404 when no meta entry matches', async () => {
    const h = makeCtx()
    h.queryImpl({
      results: [
        {
          id: 'dream:nope',
          table: 'bakin_memory',
          score: 0.5,
          fields: {
            meta: JSON.stringify({ artifactType: 'phase_doc', phase: 'rem', date: '2026-01-01' }),
          },
        },
      ],
      meta: { query: '', total: 1, took_ms: 1, source: 'search' },
    })
    const res = await dreamDetailRoute.handler(
      req('/dreams/main/phase_doc', {
        agent: 'main',
        artifactType: 'phase_doc',
        phase: 'light',
        date: '2026-04-17',
      }),
      h.ctx,
      {} as any,
    )
    expect(res.status).toBe(404)
  })

  it('tolerates results whose meta is not valid JSON', async () => {
    const h = makeCtx()
    h.queryImpl({
      results: [
        { id: 'dream:bad', table: 'bakin_memory', score: 0.3, fields: { meta: '{not json' } },
      ],
      meta: { query: '', total: 1, took_ms: 1, source: 'search' },
    })
    const res = await dreamDetailRoute.handler(
      req('/dreams/main/phase_doc', {
        agent: 'main',
        artifactType: 'phase_doc',
        phase: 'light',
        date: '2026-04-17',
      }),
      h.ctx,
      {} as any,
    )
    expect(res.status).toBe(404)
  })
})
