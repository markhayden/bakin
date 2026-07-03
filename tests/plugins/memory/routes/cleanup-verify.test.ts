/**
 * Tests for plugins/memory/lib/routes/cleanup.ts — POST /cleanup/verify.
 *
 * Re-runs the find per agent and reports remaining actionable occurrences so the
 * operator can confirm a dispatched cleanup actually took (term is gone).
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-cleanup-verify-${Date.now()}`)

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

import { cleanupVerifyRoute } from '../../../../plugins/memory/lib/routes/cleanup'
import type { PluginContext, SearchQueryParams } from '@bakin/core/plugin-types'

type Row = { id: string; fields: Record<string, unknown> }
type SeedFn = (agent: string | undefined, tier: string | undefined) => Row[]

function makeCtx(seed: SeedFn): PluginContext {
  return {
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
  } as unknown as PluginContext
}

function makeReq(body: unknown): Request {
  return new Request('http://localhost/cleanup/verify', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('cleanupVerifyRoute — shape', () => {
  it('is a POST /cleanup/verify route', () => {
    expect(cleanupVerifyRoute.method).toBe('POST')
    expect(cleanupVerifyRoute.path).toBe('/cleanup/verify')
  })
})

describe('cleanupVerifyRoute — remaining', () => {
  it('reports remaining actionable hits as not-clean', async () => {
    const ctx = makeCtx((agent, tier) =>
      agent === 'pixel' && tier === 'durable'
        ? [{ id: 'durable:pixel', fields: { tier: 'durable', agent: 'pixel', source_path: '/ws/pixel/AGENTS.md', content: 'still says beacon' } }]
        : [],
    )
    const res = await cleanupVerifyRoute.handler(makeReq({ term: 'beacon', agents: ['pixel'] }), ctx, {})
    expect(res.status).toBe(200)
    const body = await res.json() as { results: Array<{ agent: string; actionableRemaining: number; clean: boolean }> }
    const pixel = body.results.find((r) => r.agent === 'pixel')!
    expect(pixel.actionableRemaining).toBe(1)
    expect(pixel.clean).toBe(false)
  })

  it('reports clean when no actionable hits remain', async () => {
    const ctx = makeCtx(() => []) // simulate post-edit: term gone
    const res = await cleanupVerifyRoute.handler(makeReq({ term: 'beacon', agents: ['pixel'] }), ctx, {})
    const body = await res.json() as { results: Array<{ agent: string; actionableRemaining: number; clean: boolean }> }
    const pixel = body.results.find((r) => r.agent === 'pixel')!
    expect(pixel.actionableRemaining).toBe(0)
    expect(pixel.clean).toBe(true)
  })
})

describe('cleanupVerifyRoute — validation', () => {
  it('400s on empty term', async () => {
    const res = await cleanupVerifyRoute.handler(makeReq({ term: '', agents: ['pixel'] }), makeCtx(() => []), {})
    expect(res.status).toBe(400)
  })
  it('400s on empty agents', async () => {
    const res = await cleanupVerifyRoute.handler(makeReq({ term: 'beacon', agents: [] }), makeCtx(() => []), {})
    expect(res.status).toBe(400)
  })
})
