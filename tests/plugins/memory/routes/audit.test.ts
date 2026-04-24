/**
 * Tests for plugins/memory/lib/routes/audit.ts — GET /audit.
 *
 * The route is a thin wrapper over ctx.search.query, scoped to tier=audit,
 * translating URL query params into facet filters.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-audit-route-${Date.now()}`)

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

import { auditRoute } from '../../../../plugins/memory/lib/routes/audit'
import type { PluginContext, SearchQueryParams } from '../../../../src/lib/plugin-types'

interface QueryRecorder {
  calls: SearchQueryParams[]
}

function makeCtx(seeded: Record<string, unknown>[] = []): {
  ctx: PluginContext
  recorder: QueryRecorder
} {
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
        return {
          results: seeded.map((fields, i) => ({
            id: `audit:${i}`,
            table: 'bakin_memory',
            score: 1,
            fields,
          })),
          meta: {
            query: params.q,
            total: seeded.length,
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
  const url = new URL('http://localhost/audit')
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v)
  return new Request(url, { method: 'GET' })
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('auditRoute — shape', () => {
  it('is a GET /audit route', () => {
    expect(auditRoute.method).toBe('GET')
    expect(auditRoute.path).toBe('/audit')
  })
})

describe('auditRoute — handler', () => {
  it('returns { entries, total } shape with tier=audit scope enforced', async () => {
    const { ctx, recorder } = makeCtx([
      {
        id: 'audit:0',
        tier: 'audit',
        agent: 'patch',
        title: 'task.created',
        snippet: 'task.created by patch',
        updated_at: 1,
      },
    ])
    const res = await auditRoute.handler(makeReq(), ctx)
    const body = await res.json() as { entries: unknown[]; total: number }
    expect(res.status).toBe(200)
    expect(body.total).toBe(1)
    expect(Array.isArray(body.entries)).toBe(true)
    expect(body.entries).toHaveLength(1)

    expect(recorder.calls).toHaveLength(1)
    const call = recorder.calls[0]
    expect(call.filters?.tier).toBe('audit')
  })

  it('passes agent filter when ?agent= is set', async () => {
    const { ctx, recorder } = makeCtx()
    await auditRoute.handler(makeReq({ agent: 'explorer' }), ctx)
    const call = recorder.calls[0]
    expect(call.filters?.agent).toBe('explorer')
  })

  it('does NOT send an agent filter when the query param is absent', async () => {
    const { ctx, recorder } = makeCtx()
    await auditRoute.handler(makeReq(), ctx)
    const call = recorder.calls[0]
    expect(call.filters?.agent).toBeUndefined()
  })

  it('passes event filter via q field when ?event= is set', async () => {
    const { ctx, recorder } = makeCtx()
    await auditRoute.handler(makeReq({ event: 'task.created' }), ctx)
    const call = recorder.calls[0]
    // Event narrows results — either via q text or via facet.
    // Accept either "event" filter or event text embedded in q.
    const filterHit = call.filters?.eventType === 'task.created' || call.filters?.title === 'task.created'
    const qHit = typeof call.q === 'string' && call.q.includes('task.created')
    expect(filterHit || qHit).toBe(true)
  })

  it('respects ?limit= (capped at 500)', async () => {
    const { ctx, recorder } = makeCtx()
    await auditRoute.handler(makeReq({ limit: '25' }), ctx)
    expect(recorder.calls[0].limit).toBe(25)

    await auditRoute.handler(makeReq({ limit: '99999' }), ctx)
    expect(recorder.calls[1].limit ?? 0).toBeLessThanOrEqual(500)
  })

  it('defaults limit when ?limit= is not set', async () => {
    const { ctx, recorder } = makeCtx()
    await auditRoute.handler(makeReq(), ctx)
    expect(typeof recorder.calls[0].limit).toBe('number')
    expect(recorder.calls[0].limit).toBeGreaterThan(0)
  })

  it('returns 400 on invalid limit', async () => {
    const { ctx } = makeCtx()
    const res = await auditRoute.handler(makeReq({ limit: 'not-a-number' }), ctx)
    expect(res.status).toBe(400)
  })

  it('passes ?q= free-text query through to search', async () => {
    const { ctx, recorder } = makeCtx()
    await auditRoute.handler(makeReq({ q: 'taskboard' }), ctx)
    expect(recorder.calls[0].q).toContain('taskboard')
  })
})
