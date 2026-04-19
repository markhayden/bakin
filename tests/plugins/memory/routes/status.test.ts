/**
 * Tests for plugins/memory/lib/routes/status.ts.
 *
 * GET /status returns indexer health at a glance:
 *   - countsByTier: one query per tier, using meta.total from Antfly
 *   - offsetsTracked: number of files with a persisted byte-offset
 *   - lastUpdated: ms timestamp the route captured the snapshot
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-status-${Date.now()}`)

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

import { statusRoute } from '../../../../plugins/memory/lib/routes/status'
import { setOffset, clearAllOffsets } from '../../../../plugins/memory/lib/offsets'
import type { PluginContext, SearchResponse } from '../../../../src/lib/plugin-types'

function makeCtx(
  perTierTotals: Partial<Record<string, number>>,
): {
  ctx: PluginContext
  queryCalls: Array<Parameters<PluginContext['search']['query']>[0]>
} {
  const queryCalls: Array<Parameters<PluginContext['search']['query']>[0]> = []
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
        const tier = p.filters?.tier
        const total = (typeof tier === 'string' && perTierTotals[tier]) || 0
        const resp: SearchResponse = {
          results: [],
          meta: { query: '', total, took_ms: 0, source: 'antfly' },
        }
        return resp
      }),
    },
    hooks: {
      register: vi.fn(() => () => {}),
      has: vi.fn(() => false),
      invoke: vi.fn(async () => undefined),
    },
  } as unknown as PluginContext
  return { ctx, queryCalls }
}

function req(path: string): Request {
  return new Request(`http://localhost${path}`, { method: 'GET' })
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  clearAllOffsets()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('statusRoute — shape', () => {
  it('is a GET /status route', () => {
    expect(statusRoute.method).toBe('GET')
    expect(statusRoute.path).toBe('/status')
  })
})

describe('statusRoute — handler', () => {
  it('returns counts for all 7 tiers from Antfly queries', async () => {
    const { ctx, queryCalls } = makeCtx({
      audit: 10,
      durable: 4,
      daily_note: 7,
      session: 3,
      turn: 200,
      checkpoint: 1,
      dream: 5,
    })
    const res = await statusRoute.handler(req('/status'), ctx)
    const body = await res.json() as {
      countsByTier: Record<string, number>
      offsetsTracked: number
      totalRows: number
      lastUpdated: number
    }
    expect(res.status).toBe(200)
    expect(body.countsByTier).toEqual({
      audit: 10,
      durable: 4,
      daily_note: 7,
      session: 3,
      turn: 200,
      checkpoint: 1,
      dream: 5,
    })
    expect(body.totalRows).toBe(230)
    expect(queryCalls.map((c) => c.filters?.tier).sort()).toEqual([
      'audit', 'checkpoint', 'daily_note', 'dream', 'durable', 'session', 'turn',
    ])
    for (const c of queryCalls) {
      expect(c.limit).toBe(0)
    }
  })

  it('reports the number of files with a persisted byte offset', async () => {
    setOffset('/tmp/a.jsonl', 1234)
    setOffset('/tmp/b.jsonl', 5678)
    const { ctx } = makeCtx({})
    const res = await statusRoute.handler(req('/status'), ctx)
    const body = await res.json() as { offsetsTracked: number }
    expect(body.offsetsTracked).toBe(2)
  })

  it('sets lastUpdated to a fresh ms timestamp', async () => {
    const before = Date.now()
    const { ctx } = makeCtx({})
    const res = await statusRoute.handler(req('/status'), ctx)
    const body = await res.json() as { lastUpdated: number }
    const after = Date.now()
    expect(body.lastUpdated).toBeGreaterThanOrEqual(before)
    expect(body.lastUpdated).toBeLessThanOrEqual(after)
  })

  it('tolerates a query that throws — returns 0 for that tier', async () => {
    let failed = false
    const { ctx } = makeCtx({ audit: 10 })
    const originalQuery = ctx.search.query
    ctx.search.query = vi.fn(async (p) => {
      if (p.filters?.tier === 'turn' && !failed) {
        failed = true
        throw new Error('boom')
      }
      return originalQuery(p)
    })
    const res = await statusRoute.handler(req('/status'), ctx)
    const body = await res.json() as { countsByTier: Record<string, number> }
    expect(body.countsByTier.turn).toBe(0)
    expect(body.countsByTier.audit).toBe(10)
  })
})
