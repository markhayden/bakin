/**
 * Tests for plugins/memory/lib/routes/cleanup.ts — POST /cleanup/dispatch.
 *
 * Dispatch re-finds each agent's occurrences server-side, composes a cleanup
 * task from the ACTIONABLE hits, and creates one task per agent via ctx.tasks.
 * It must NEVER touch ctx.runtime (Bakin writes no runtime memory) and must
 * audit each dispatch.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-cleanup-dispatch-${Date.now()}`)

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

import { cleanupDispatchRoute } from '../../../../plugins/memory/lib/routes/cleanup'
import type { PluginContext, SearchQueryParams, PluginTaskCreateInput } from '@bakin/core/plugin-types'

type Row = { id: string; fields: Record<string, unknown> }
// Seed keyed by (agent, tier) so each agent gets its own hits.
type SeedFn = (agent: string | undefined, tier: string | undefined) => Row[]

interface Captured {
  created: PluginTaskCreateInput[]
  audits: Array<{ event: string; agent: string; data?: Record<string, unknown> }>
}

function makeCtx(seed: SeedFn): { ctx: PluginContext; cap: Captured } {
  const cap: Captured = { created: [], audits: [] }
  let taskSeq = 0
  const ctx = {
    pluginId: 'memory',
    search: {
      query: mock(async (params: SearchQueryParams) => {
        const agent = typeof params.filters?.agent === 'string' ? params.filters.agent : undefined
        const tier = typeof params.filters?.tier === 'string' ? params.filters.tier : undefined
        const rows = seed(agent, tier)
        return {
          results: rows.map((r) => ({ id: r.id, table: 'bakin_memory', score: 1, fields: r.fields })),
          meta: { query: params.q, total: rows.length, took_ms: 1, source: 'unavailable' as const },
        }
      }),
    },
    tasks: {
      create: mock(async (input: PluginTaskCreateInput) => {
        cap.created.push(input)
        return { id: `task-${++taskSeq}`, title: input.title, checked: false, column: 'todo' }
      }),
    },
    activity: {
      log: mock(),
      audit: mock((event: string, agent: string, data?: Record<string, unknown>) => {
        cap.audits.push({ event, agent, data })
      }),
    },
    // Any access to runtime is a boundary violation — fail loudly.
    runtime: new Proxy({}, { get() { throw new Error('ctx.runtime accessed during cleanup dispatch') } }),
  } as unknown as PluginContext
  return { ctx, cap }
}

function makeReq(body: unknown): Request {
  return new Request('http://localhost/cleanup/dispatch', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

// Helper: an actionable (durable) hit row for a given agent.
function durableRow(agent: string): Row {
  return { id: `durable:${agent}`, fields: { tier: 'durable', agent, source_path: `/ws/${agent}/AGENTS.md`, content: 'use the beacon mcp' } }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('cleanupDispatchRoute — shape', () => {
  it('is a POST /cleanup/dispatch route', () => {
    expect(cleanupDispatchRoute.method).toBe('POST')
    expect(cleanupDispatchRoute.path).toBe('/cleanup/dispatch')
  })
})

describe('cleanupDispatchRoute — one task per agent', () => {
  it('creates a task per agent with that agent\'s findings, audits, and never touches runtime', async () => {
    const { ctx, cap } = makeCtx((agent, tier) =>
      tier === 'durable' && agent ? [durableRow(agent)] : [],
    )
    const res = await cleanupDispatchRoute.handler(
      makeReq({ term: 'beacon', action: 'replace', replacement: 'bakin', agents: ['pixel', 'penelope'] }),
      ctx,
      {},
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { dispatched: Array<{ agent: string; taskId: string }>; skipped: unknown[] }
    expect(body.dispatched).toHaveLength(2)
    expect(cap.created).toHaveLength(2)
    // Each task targets its agent and carries that agent's source path.
    const pixelTask = cap.created.find((t) => t.agent === 'pixel')!
    expect(pixelTask.description).toContain('/ws/pixel/AGENTS.md')
    expect(pixelTask.createdBy).toBe('memory')
    // Audited once per agent.
    expect(cap.audits.filter((a) => a.event === 'memory.cleanup_dispatched')).toHaveLength(2)
  })
})

describe('cleanupDispatchRoute — skips agents with no actionable hits', () => {
  it('does not create a task for an agent with only informational (turn) hits', async () => {
    const { ctx, cap } = makeCtx((agent, tier) => {
      if (agent === 'pixel' && tier === 'durable') return [durableRow('pixel')]
      if (agent === 'penelope' && tier === 'turn') return [{ id: 'turn:penelope', fields: { tier: 'turn', agent: 'penelope', source_path: '/ws/penelope/s.jsonl', content: 'beacon once' } }]
      return []
    })
    const res = await cleanupDispatchRoute.handler(
      makeReq({ term: 'beacon', action: 'remove', agents: ['pixel', 'penelope'] }),
      ctx,
      {},
    )
    const body = await res.json() as { dispatched: Array<{ agent: string }>; skipped: Array<{ agent: string }> }
    expect(cap.created).toHaveLength(1)
    expect(body.dispatched.map((d) => d.agent)).toEqual(['pixel'])
    expect(body.skipped.map((s) => s.agent)).toEqual(['penelope'])
  })
})

describe('cleanupDispatchRoute — partial failure', () => {
  it('records a failing agent in failed[] without aborting the others', async () => {
    let seq = 0
    const ctx = {
      pluginId: 'memory',
      search: {
        query: mock(async (params: SearchQueryParams) => {
          const agent = typeof params.filters?.agent === 'string' ? params.filters.agent : undefined
          const tier = typeof params.filters?.tier === 'string' ? params.filters.tier : undefined
          const rows = tier === 'durable' && agent ? [durableRow(agent)] : []
          return {
            results: rows.map((r) => ({ id: r.id, table: 'bakin_memory', score: 1, fields: r.fields })),
            meta: { query: params.q, total: rows.length, took_ms: 1, source: 'unavailable' as const },
          }
        }),
      },
      tasks: {
        create: mock(async (input: PluginTaskCreateInput) => {
          if (input.agent === 'penelope') throw new Error('task store boom')
          return { id: `task-${++seq}`, title: input.title, checked: false, column: 'todo' }
        }),
      },
      activity: { log: mock(), audit: mock() },
    } as unknown as PluginContext

    const res = await cleanupDispatchRoute.handler(
      makeReq({ term: 'beacon', action: 'remove', agents: ['pixel', 'penelope'] }),
      ctx,
      {},
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { dispatched: Array<{ agent: string }>; failed: Array<{ agent: string; reason: string }> }
    expect(body.dispatched.map((d) => d.agent)).toEqual(['pixel'])
    expect(body.failed.map((f) => f.agent)).toEqual(['penelope'])
    expect(body.failed[0].reason).toContain('boom')
  })
})

describe('cleanupDispatchRoute — validation', () => {
  it('400s when action=replace but no replacement', async () => {
    const { ctx } = makeCtx(() => [])
    const res = await cleanupDispatchRoute.handler(makeReq({ term: 'beacon', action: 'replace', agents: ['pixel'] }), ctx, {})
    expect(res.status).toBe(400)
  })
  it('400s on empty agents', async () => {
    const { ctx } = makeCtx(() => [])
    const res = await cleanupDispatchRoute.handler(makeReq({ term: 'beacon', action: 'remove', agents: [] }), ctx, {})
    expect(res.status).toBe(400)
  })
  it('400s on a bad action', async () => {
    const { ctx } = makeCtx(() => [])
    const res = await cleanupDispatchRoute.handler(makeReq({ term: 'beacon', action: 'nuke', agents: ['pixel'] }), ctx, {})
    expect(res.status).toBe(400)
  })
})
