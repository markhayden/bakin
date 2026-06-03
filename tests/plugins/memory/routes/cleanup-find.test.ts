/**
 * Tests for plugins/memory/lib/routes/cleanup.ts — POST /cleanup/find.
 *
 * The route queries each memory tier for the term, EXACT-substring-filters the
 * returned content (so semantic ranking can't yield false matches), and groups
 * the true occurrences by agent with actionable/informational tier labels.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-cleanup-find-${Date.now()}`)

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

import { cleanupFindRoute } from '../../../../plugins/memory/lib/routes/cleanup'
import type { PluginContext, SearchQueryParams } from '@bakin/core/plugin-types'

type Row = { id: string; fields: Record<string, unknown> }
type SeedFn = (params: SearchQueryParams) => Row[]

function makeCtx(seed: SeedFn): { ctx: PluginContext; calls: SearchQueryParams[] } {
  const calls: SearchQueryParams[] = []
  const ctx = {
    pluginId: 'memory',
    search: {
      registerContentType: mock(),
      registerFileBackedContentType: mock(),
      index: mock(async () => {}),
      remove: mock(async () => {}),
      query: mock(async (params: SearchQueryParams) => {
        calls.push(params)
        const rows = seed(params)
        return {
          results: rows.map((r) => ({ id: r.id, table: 'bakin_memory', score: 1, fields: r.fields })),
          meta: { query: params.q, total: rows.length, took_ms: 1, source: 'fallback' as const },
        }
      }),
    },
  } as unknown as PluginContext
  return { ctx, calls }
}

function tierOf(p: SearchQueryParams): string | undefined {
  const v = p.filters?.tier
  return typeof v === 'string' ? v : undefined
}

function makeReq(body: unknown): Request {
  return new Request('http://localhost/cleanup/find', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('cleanupFindRoute — shape', () => {
  it('is a POST /cleanup/find route', () => {
    expect(cleanupFindRoute.method).toBe('POST')
    expect(cleanupFindRoute.path).toBe('/cleanup/find')
  })
})

describe('cleanupFindRoute — exact matching', () => {
  it('keeps only rows whose content actually contains the term (drops semantic-only hits)', async () => {
    const { ctx } = makeCtx((p) =>
      tierOf(p) === 'durable'
        ? [
            { id: 'durable:hit', fields: { tier: 'durable', agent: 'pixel', source_path: '/ws/pixel/AGENTS.md', content: 'use the beacon mcp' } },
            { id: 'durable:miss', fields: { tier: 'durable', agent: 'pixel', source_path: '/ws/pixel/SOUL.md', content: 'a faithful bakin soul' } },
          ]
        : [],
    )
    const res = await cleanupFindRoute.handler(makeReq({ term: 'beacon' }), ctx, {})
    const body = await res.json() as { totalHits: number; groups: Array<{ agent: string; hits: Array<{ rowId: string }> }> }
    expect(res.status).toBe(200)
    expect(body.totalHits).toBe(1)
    expect(body.groups[0].hits[0].rowId).toBe('durable:hit')
  })
})

describe('cleanupFindRoute — grouping + labeling', () => {
  it('groups by agent and labels tiers actionable vs informational', async () => {
    const { ctx } = makeCtx((p) => {
      if (tierOf(p) === 'durable') return [{ id: 'durable:1', fields: { tier: 'durable', agent: 'pixel', source_path: '/ws/pixel/AGENTS.md', content: 'beacon here' } }]
      if (tierOf(p) === 'turn') return [{ id: 'turn:1', fields: { tier: 'turn', agent: 'penelope', source_path: '/ws/penelope/sessions/x.jsonl', content: 'mentioned beacon once' } }]
      return []
    })
    const res = await cleanupFindRoute.handler(makeReq({ term: 'beacon' }), ctx, {})
    const body = await res.json() as {
      totalHits: number
      actionableHits: number
      groups: Array<{ agent: string; hits: Array<{ tier: string; label: string }> }>
    }
    expect(body.totalHits).toBe(2)
    expect(body.actionableHits).toBe(1)
    const pixel = body.groups.find((g) => g.agent === 'pixel')!
    expect(pixel.hits[0].label).toBe('actionable')
    const penelope = body.groups.find((g) => g.agent === 'penelope')!
    expect(penelope.hits[0].label).toBe('informational')
  })
})

describe('cleanupFindRoute — agent filter', () => {
  it('passes the agent filter through to every tier query', async () => {
    const { ctx, calls } = makeCtx(() => [])
    await cleanupFindRoute.handler(makeReq({ term: 'beacon', agent: 'pixel' }), ctx, {})
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect(c.filters?.agent).toBe('pixel')
  })
})

describe('cleanupFindRoute — validation', () => {
  it('400s on an empty term', async () => {
    const { ctx } = makeCtx(() => [])
    const res = await cleanupFindRoute.handler(makeReq({ term: '' }), ctx, {})
    expect(res.status).toBe(400)
  })
  it('400s on invalid JSON', async () => {
    const { ctx } = makeCtx(() => [])
    const res = await cleanupFindRoute.handler(makeReq('{not json'), ctx, {})
    expect(res.status).toBe(400)
  })
})
