/**
 * Tests for plugins/memory/mcp/list-agents.ts.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-mcp-listagents-${Date.now()}`)

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

import { createMemoryListAgentsTool } from '../../../../plugins/memory/mcp/list-agents'
import type { PluginContext, SearchResponse } from '../../../../src/lib/plugin-types'

function makeCtx(perTierAgg: Record<string, Array<{ value: string; count: number }>>): PluginContext {
  return {
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
        const tier = (p.filters as Record<string, string>)?.tier ?? ''
        const agg = perTierAgg[tier] ?? []
        return {
          results: [],
          aggregations: { agent: agg },
          meta: { query: p.q, total: agg.reduce((s, a) => s + a.count, 0), took_ms: 0, source: 'search' },
        } satisfies SearchResponse
      }),
    },
    hooks: { register: mock(() => () => {}), has: mock(() => false), invoke: mock(async () => undefined) },
  } as unknown as PluginContext
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('memory_list_agents', () => {
  it('has the expected name with no params', () => {
    const tool = createMemoryListAgentsTool(makeCtx({}))
    expect(tool.name).toBe('bakin_exec_memory_list_agents')
    expect(Object.keys(tool.parameters)).toHaveLength(0)
  })

  it('aggregates across tiers and sorts by total desc', async () => {
    const tool = createMemoryListAgentsTool(
      makeCtx({
        session: [{ value: 'scout', count: 10 }, { value: 'basil', count: 3 }],
        turn: [{ value: 'scout', count: 100 }, { value: 'basil', count: 5 }],
        audit: [{ value: 'basil', count: 50 }],
        daily_note: [], checkpoint: [], durable: [], dream: [],
      }),
    )
    const res = await tool.handler({}, 'system')
    expect(res.ok).toBe(true)
    const agents = res.agents as Array<{ agent: string; total: number; byTier: Record<string, number> }>
    expect(agents.map((a) => a.agent)).toEqual(['scout', 'basil'])
    expect(agents[0].total).toBe(110)
    expect(agents[0].byTier.session).toBe(10)
    expect(agents[0].byTier.turn).toBe(100)
    expect(agents[1].total).toBe(58)
    expect(agents[1].byTier.audit).toBe(50)
  })

  it('tolerates a failing tier — that tier just contributes zero', async () => {
    const ctx = makeCtx({ session: [{ value: 'scout', count: 1 }] })
    const q = ctx.search.query as ReturnType<typeof mock>
    let calls = 0
    q.mockImplementation(async (p: { filters?: Record<string, string>; q: string }) => {
      calls++
      const tier = p.filters?.tier
      if (tier === 'turn') throw new Error('boom')
      const agg = tier === 'session' ? [{ value: 'scout', count: 1 }] : []
      return {
        results: [],
        aggregations: { agent: agg },
        meta: { query: p.q, total: agg.length, took_ms: 0, source: 'search' },
      } satisfies SearchResponse
    })
    const tool = createMemoryListAgentsTool(ctx)
    const res = await tool.handler({}, 'system')
    expect(res.ok).toBe(true)
    const agents = res.agents as Array<{ agent: string; byTier: Record<string, number> }>
    expect(agents[0].byTier.turn).toBe(0)
    expect(agents[0].byTier.session).toBe(1)
    expect(calls).toBeGreaterThan(0)
  })
})
