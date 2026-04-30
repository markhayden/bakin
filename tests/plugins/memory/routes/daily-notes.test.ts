/**
 * Tests for plugins/memory/lib/routes/daily-notes.ts.
 *
 *   GET  /daily-notes?agent=<id>                → { files: [{ name, date }] }
 *   GET  /daily-notes/:agent/:filename          → { agent, file, content }
 *   POST /daily-notes/compare-search            → { search: [...], runtime: [...] }
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-daily-notes-route-${Date.now()}`)

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

const {
  mockListDailyNotes,
  mockReadDailyNote,
  mockMemorySearch,
} = (() => ({
  mockListDailyNotes: mock<(agent: string) => string[]>(),
  mockReadDailyNote: mock<(agent: string, filename: string) => string | null>(),
  mockMemorySearch: mock<(q: string, opts?: unknown) => Promise<unknown>>(),
}))()

import {
  dailyNotesListRoute,
  dailyNotesDetailRoute,
  dailyNotesCompareSearchRoute,
} from '../../../../plugins/memory/lib/routes/daily-notes'
import type { PluginContext, SearchQueryParams } from '@bakin/core/plugin-types'

interface Recorder { queries: SearchQueryParams[] }

function makeCtx(searchResults: Record<string, unknown>[] = []): { ctx: PluginContext; recorder: Recorder } {
  const recorder: Recorder = { queries: [] }
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
        listTiers: mock(async () => [{ id: 'daily-tier', label: 'Daily notes', metadata: { sourceKind: 'daily_note' } }]),
        listEntries: mock(async (_tierId: string, opts?: { agentId?: string }) =>
          mockListDailyNotes(opts?.agentId ?? '').map((name) => ({
            id: name,
            tierId: 'daily-tier',
            agentId: opts?.agentId,
            path: `/fake/${opts?.agentId ?? 'agent'}/memory/${name}`,
            content: '',
          })),
        ),
        getEntry: mock(async (_tierId: string, id: string, opts?: { agentId?: string }) => {
          const content = mockReadDailyNote(opts?.agentId ?? '', id)
          return content === null || content === undefined
            ? null
            : { id, tierId: 'daily-tier', agentId: opts?.agentId, path: `/fake/${id}`, content }
        }),
        search: mock(async (query: string, opts?: { agentId?: string; limit?: number }) => {
          const result = await mockMemorySearch(query, { agent: opts?.agentId, limit: opts?.limit })
          return result as { results: unknown[] }
        }),
      },
    },
    search: {
      registerContentType: mock(),
      registerFileBackedContentType: mock(),
      index: mock(async () => {}),
      remove: mock(async () => {}),
      transform: mock(async () => {}),
      query: mock(async (params: SearchQueryParams) => {
        recorder.queries.push(params)
        return {
          results: searchResults.map((fields, i) => ({
            id: `daily_note:${i}`,
            table: 'bakin_memory',
            score: 1,
            fields,
          })),
          meta: { query: params.q, total: searchResults.length, took_ms: 1, source: 'fallback' as const },
        }
      }),
    },
    hooks: {
      register: mock(() => () => {}),
      has: mock(() => false),
      invoke: mock(async () => undefined),
    },
  } as unknown as PluginContext
  return { ctx, recorder }
}

function makeReq(path: string, qs: Record<string, string> = {}, init?: RequestInit): Request {
  const url = new URL(`http://localhost${path}`)
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v)
  return new Request(url, { method: 'GET', ...init })
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mockListDailyNotes.mockReset()
  mockReadDailyNote.mockReset()
  mockMemorySearch.mockReset()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('dailyNotesListRoute', () => {
  it('is a GET /daily-notes route', () => {
    expect(dailyNotesListRoute.method).toBe('GET')
    expect(dailyNotesListRoute.path).toBe('/daily-notes')
  })

  it('returns 400 when agent is missing', async () => {
    const res = await dailyNotesListRoute.handler(makeReq('/daily-notes'), makeCtx().ctx, {})
    expect(res.status).toBe(400)
  })

  it('returns files sorted by date desc', async () => {
    mockListDailyNotes.mockReturnValue([
      '2026-04-18.md',
      '2026-04-17.md',
      '2026-04-16.md',
    ])
    const res = await dailyNotesListRoute.handler(
      makeReq('/daily-notes', { agent: 'main' }),
      makeCtx().ctx,
      {} as any,
    )
    const body = await res.json() as { files: { name: string; date: string }[] }
    expect(res.status).toBe(200)
    expect(body.files.map((f) => f.date)).toEqual(['2026-04-18', '2026-04-17', '2026-04-16'])
  })

  it('filters out non-date-prefixed filenames', async () => {
    mockListDailyNotes.mockReturnValue(['2026-04-18.md', 'random.md', '2026-04-17.md'])
    const res = await dailyNotesListRoute.handler(
      makeReq('/daily-notes', { agent: 'main' }),
      makeCtx().ctx,
      {} as any,
    )
    const body = await res.json() as { files: { name: string }[] }
    expect(body.files.map((f) => f.name)).toEqual(['2026-04-18.md', '2026-04-17.md'])
  })
})

describe('dailyNotesDetailRoute', () => {
  it('is a GET /daily-notes/:agent/:filename route', () => {
    expect(dailyNotesDetailRoute.method).toBe('GET')
    expect(dailyNotesDetailRoute.path).toBe('/daily-notes/:agent/:filename')
  })

  it('returns 400 when agent or filename missing', async () => {
    const res = await dailyNotesDetailRoute.handler(
      makeReq('/daily-notes//'),
      makeCtx().ctx,
      {} as any,
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when adapter returns null', async () => {
    mockReadDailyNote.mockReturnValue(null)
    const res = await dailyNotesDetailRoute.handler(
      makeReq('/daily-notes/main/2026-04-18.md', { agent: 'main', filename: '2026-04-18.md' }),
      makeCtx().ctx,
      {} as any,
    )
    expect(res.status).toBe(404)
  })

  it('returns content when file exists', async () => {
    mockReadDailyNote.mockReturnValue('note body')
    const res = await dailyNotesDetailRoute.handler(
      makeReq('/daily-notes/main/2026-04-18.md', { agent: 'main', filename: '2026-04-18.md' }),
      makeCtx().ctx,
      {} as any,
    )
    const body = await res.json() as { agent: string; file: string; content: string }
    expect(res.status).toBe(200)
    expect(body.content).toBe('note body')
  })
})

describe('dailyNotesCompareSearchRoute', () => {
  it('is a POST /daily-notes/compare-search route', () => {
    expect(dailyNotesCompareSearchRoute.method).toBe('POST')
    expect(dailyNotesCompareSearchRoute.path).toBe('/daily-notes/compare-search')
  })

  it('returns 400 when body has no query', async () => {
    const req = new Request('http://localhost/daily-notes/compare-search', {
      method: 'POST',
      body: JSON.stringify({ agent: 'main' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await dailyNotesCompareSearchRoute.handler(req, makeCtx().ctx, {})
    expect(res.status).toBe(400)
  })

  it('returns { search, runtime } arrays', async () => {
    mockMemorySearch.mockResolvedValue({
      results: [{ path: '2026-04-18.md', score: 0.9, snippet: 'hello' }],
    })
    const req = new Request('http://localhost/daily-notes/compare-search', {
      method: 'POST',
      body: JSON.stringify({ query: 'hello', agent: 'main' }),
      headers: { 'content-type': 'application/json' },
    })
    const { ctx } = makeCtx([
      { id: 'x', tier: 'daily_note', agent: 'main', title: '2026-04-17.md', snippet: 'hello world' },
    ])
    const res = await dailyNotesCompareSearchRoute.handler(req, ctx, {} as any)
    const body = await res.json() as { search: unknown[]; runtime: unknown[] }
    expect(res.status).toBe(200)
    expect(body.search).toHaveLength(1)
    expect(body.runtime).toHaveLength(1)
  })

  it('search query is scoped to tier=daily_note (+ agent when provided)', async () => {
    mockMemorySearch.mockResolvedValue({ results: [] })
    const req = new Request('http://localhost/daily-notes/compare-search', {
      method: 'POST',
      body: JSON.stringify({ query: 'hello', agent: 'main' }),
      headers: { 'content-type': 'application/json' },
    })
    const { ctx, recorder } = makeCtx()
    await dailyNotesCompareSearchRoute.handler(req, ctx, {} as any)
    expect(recorder.queries).toHaveLength(1)
    expect(recorder.queries[0].filters?.tier).toBe('daily_note')
    expect(recorder.queries[0].filters?.agent).toBe('main')
  })

  it('returns runtime as empty array with a status=no_index flag when runtime returns zero results', async () => {
    mockMemorySearch.mockResolvedValue({ results: [] })
    const req = new Request('http://localhost/daily-notes/compare-search', {
      method: 'POST',
      body: JSON.stringify({ query: 'nothing', agent: 'main' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await dailyNotesCompareSearchRoute.handler(req, makeCtx().ctx, {})
    const body = await res.json() as { runtime: unknown[]; runtimeStatus?: string }
    expect(body.runtime).toEqual([])
    expect(body.runtimeStatus).toBe('no_index_or_no_match')
  })

  it('when runtime search throws, runtimeStatus=error and search still returns', async () => {
    mockMemorySearch.mockRejectedValue(new Error('runtime timeout'))
    const req = new Request('http://localhost/daily-notes/compare-search', {
      method: 'POST',
      body: JSON.stringify({ query: 'hello', agent: 'main' }),
      headers: { 'content-type': 'application/json' },
    })
    const { ctx } = makeCtx([
      { id: 'x', tier: 'daily_note', agent: 'main', title: 'ok', snippet: 'y' },
    ])
    const res = await dailyNotesCompareSearchRoute.handler(req, ctx, {} as any)
    const body = await res.json() as { search: unknown[]; runtime: unknown[]; runtimeStatus?: string; runtimeError?: string }
    expect(res.status).toBe(200)
    expect(body.search).toHaveLength(1)
    expect(body.runtime).toEqual([])
    expect(body.runtimeStatus).toBe('error')
    expect(body.runtimeError).toContain('timeout')
  })
})
