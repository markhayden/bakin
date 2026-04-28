/**
 * Tests for plugins/memory/lib/routes/recent.ts — GET /recent.
 *
 * The route fans out a match-all query per (tier, agent) pair, merges the
 * results, and sorts by `updated_at` desc. Turns are excluded by default —
 * the UI opts in via `?tier=turn`.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-recent-route-${Date.now()}`)

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

import { recentRoute } from '../../../../plugins/memory/lib/routes/recent'
import type { PluginContext, SearchQueryParams } from '../../../../src/lib/plugin-types'

interface QueryRecorder {
  calls: SearchQueryParams[]
}

type SeedFn = (params: SearchQueryParams) => Array<{ id: string; fields: Record<string, unknown> }>

function makeCtx(seed: SeedFn): { ctx: PluginContext; recorder: QueryRecorder } {
  const recorder: QueryRecorder = { calls: [] }
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
      query: mock(async (params: SearchQueryParams) => {
        recorder.calls.push(params)
        const rows = seed(params)
        return {
          results: rows.map((r) => ({
            id: r.id,
            table: 'bakin_memory',
            score: 1,
            fields: r.fields,
          })),
          meta: {
            query: params.q,
            total: rows.length,
            took_ms: 1,
            source: 'fallback' as const,
          },
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

function makeReq(qs: Record<string, string> = {}): Request {
  const url = new URL('http://localhost/recent')
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v)
  return new Request(url, { method: 'GET' })
}

function tierOf(params: SearchQueryParams): string | undefined {
  const v = params.filters?.tier
  return typeof v === 'string' ? v : undefined
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('recentRoute — shape', () => {
  it('is a GET /recent route', () => {
    expect(recentRoute.method).toBe('GET')
    expect(recentRoute.path).toBe('/recent')
  })
})

describe('recentRoute — default behavior', () => {
  it('excludes turn + audit tiers by default (noise suppression)', async () => {
    const { ctx, recorder } = makeCtx(() => [])
    await recentRoute.handler(makeReq(), ctx)
    const tiersQueried = recorder.calls.map(tierOf)
    expect(tiersQueried).not.toContain('turn')
    expect(tiersQueried).not.toContain('audit')
    // The 5 remaining tiers should be queried.
    expect(new Set(tiersQueried)).toEqual(
      new Set(['session', 'checkpoint', 'daily_note', 'dream', 'durable']),
    )
  })

  it('includes every tier when ?debug=1 is set', async () => {
    const { ctx, recorder } = makeCtx(() => [])
    await recentRoute.handler(makeReq({ debug: '1' }), ctx)
    const tiersQueried = new Set(recorder.calls.map(tierOf))
    expect(tiersQueried).toEqual(
      new Set(['session', 'turn', 'checkpoint', 'daily_note', 'dream', 'durable', 'audit']),
    )
  })

  it('explicit ?tier=turn overrides the default exclusion even when debug is off', async () => {
    const { ctx, recorder } = makeCtx(() => [])
    await recentRoute.handler(makeReq({ tier: 'turn' }), ctx)
    const tiersQueried = recorder.calls.map(tierOf)
    expect(tiersQueried).toEqual(['turn'])
  })

  it('uses full_text_only strategy and match-all q', async () => {
    const { ctx, recorder } = makeCtx(() => [])
    await recentRoute.handler(makeReq(), ctx)
    for (const call of recorder.calls) {
      expect(call.strategy).toBe('full_text_only')
      expect(call.q).toBe('*')
    }
  })

  it('returns SearchResponse-shaped body', async () => {
    const { ctx } = makeCtx((p) => {
      const tier = tierOf(p) ?? 'audit'
      return [{ id: `${tier}:0`, fields: { tier, updated_at: 1 } }]
    })
    const res = await recentRoute.handler(makeReq(), ctx)
    const body = await res.json() as {
      results: unknown[]
      aggregations: unknown
      meta: { source: string }
    }
    expect(res.status).toBe(200)
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.aggregations).toBeDefined()
    expect(body.meta.source).toBe('search')
  })
})

describe('recentRoute — sorting', () => {
  it('sorts merged results by updated_at desc', async () => {
    const { ctx } = makeCtx((p) => {
      const tier = tierOf(p) ?? 'session'
      // Each tier seeds a single row with a distinct updated_at so the
      // final ordering is deterministic regardless of tier iteration order.
      const tsByTier: Record<string, number> = {
        session: 500,
        checkpoint: 100,
        daily_note: 900,
        dream: 300,
        durable: 700,
      }
      const ts = tsByTier[tier] ?? 0
      return [{ id: `${tier}:row`, fields: { tier, updated_at: ts } }]
    })
    const res = await recentRoute.handler(makeReq(), ctx)
    const body = await res.json() as {
      results: Array<{ id: string; fields: { updated_at: number } }>
    }
    const ts = body.results.map((r) => r.fields.updated_at)
    expect(ts).toEqual([...ts].sort((a, b) => b - a))
    // Daily note is newest (900), checkpoint is oldest (100).
    expect(body.results[0].id).toBe('daily_note:row')
  })
})

describe('recentRoute — filters', () => {
  it('honors explicit tier filter (includes turns when asked)', async () => {
    const { ctx, recorder } = makeCtx(() => [])
    await recentRoute.handler(makeReq({ tier: 'turn,session' }), ctx)
    const tiers = new Set(recorder.calls.map(tierOf))
    expect(tiers).toEqual(new Set(['turn', 'session']))
  })

  it('ignores unknown tier values', async () => {
    const { ctx, recorder } = makeCtx(() => [])
    await recentRoute.handler(makeReq({ tier: 'turn,not_a_tier' }), ctx)
    const tiers = recorder.calls.map(tierOf)
    expect(tiers).toEqual(['turn'])
  })

  it('fans out per agent when multiple ?agent= values are supplied', async () => {
    const { ctx, recorder } = makeCtx(() => [])
    await recentRoute.handler(makeReq({ tier: 'session', agent: 'patch,explorer' }), ctx)
    // One tier × two agents = two queries, each with its own agent filter.
    expect(recorder.calls).toHaveLength(2)
    const agents = recorder.calls.map((c) => c.filters?.agent)
    expect(new Set(agents)).toEqual(new Set(['patch', 'explorer']))
  })

  it('omits agent filter when ?agent= is absent', async () => {
    const { ctx, recorder } = makeCtx(() => [])
    await recentRoute.handler(makeReq({ tier: 'session' }), ctx)
    expect(recorder.calls).toHaveLength(1)
    expect(recorder.calls[0].filters?.agent).toBeUndefined()
  })
})

describe('recentRoute — limit', () => {
  it('caps the overall result set at ?limit= (default 30)', async () => {
    const { ctx } = makeCtx((p) => {
      const tier = tierOf(p) ?? 'audit'
      return Array.from({ length: 20 }, (_, i) => ({
        id: `${tier}:${i}`,
        fields: { tier, updated_at: i },
      }))
    })
    const res = await recentRoute.handler(makeReq({ limit: '10' }), ctx)
    const body = await res.json() as { results: unknown[] }
    expect(body.results).toHaveLength(10)
  })

  it('returns 400 for invalid ?limit=', async () => {
    const { ctx } = makeCtx(() => [])
    const res = await recentRoute.handler(makeReq({ limit: 'nope' }), ctx)
    expect(res.status).toBe(400)
  })

  it('hard-caps ?limit= at 100', async () => {
    const { ctx } = makeCtx((p) => {
      const tier = tierOf(p) ?? 'audit'
      return Array.from({ length: 200 }, (_, i) => ({
        id: `${tier}:${i}`,
        fields: { tier, updated_at: i },
      }))
    })
    const res = await recentRoute.handler(makeReq({ limit: '500' }), ctx)
    const body = await res.json() as { results: unknown[] }
    expect(body.results.length).toBeLessThanOrEqual(100)
  })
})

describe('recentRoute — fan-out cap', () => {
  it('returns 400 when tier × agent × kind exceeds MAX_FANOUT', async () => {
    const { ctx, recorder } = makeCtx(() => [])
    // 7 tiers (debug=1) × 8 agents × 1 kind = 56 > 50 cap.
    const res = await recentRoute.handler(
      makeReq({
        debug: '1',
        agent: 'a,b,c,d,e,f,g,h',
      }),
      ctx,
    )
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/too many filter combinations/i)
    // Must reject before dispatching any queries.
    expect(recorder.calls).toHaveLength(0)
  })

  it('allows fan-out just under the cap', async () => {
    const { ctx, recorder } = makeCtx(() => [])
    // 7 tiers (debug=1) × 7 agents × 1 kind = 49, under 50.
    const res = await recentRoute.handler(
      makeReq({
        debug: '1',
        agent: 'a,b,c,d,e,f,g',
      }),
      ctx,
    )
    expect(res.status).toBe(200)
    expect(recorder.calls).toHaveLength(49)
  })
})

describe('recentRoute — resilience', () => {
  it('returns [] for a single tier failure without poisoning the rest', async () => {
    const { ctx } = makeCtx((p) => {
      if (tierOf(p) === 'session') {
        throw new Error('Antfly boom')
      }
      return [{ id: `${tierOf(p)}:ok`, fields: { tier: tierOf(p), updated_at: 1 } }]
    })
    const res = await recentRoute.handler(makeReq(), ctx)
    const body = await res.json() as { results: Array<{ id: string }> }
    expect(res.status).toBe(200)
    // 4 surviving tiers (excluded by default: turn + audit; failed: session).
    expect(body.results).toHaveLength(4)
    expect(body.results.find((r) => r.id.startsWith('session:'))).toBeUndefined()
  })
})
