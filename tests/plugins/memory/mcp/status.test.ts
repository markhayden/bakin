/**
 * Tests for plugins/memory/mcp/status.ts.
 *
 * Mirrors the /status REST route's shape but returns inside the exec-tool
 * envelope. Per-tier failures degrade to zero.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-mcp-status-${Date.now()}`)

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

import { createMemoryStatusTool } from '../../../../plugins/memory/mcp/status'
import { setOffset, clearAllOffsets } from '../../../../plugins/memory/lib/offsets'
import type { PluginContext, SearchResponse } from '@bakin/core/plugin-types'

function makeCtx(perTierTotal: Record<string, number>): PluginContext {
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
        const total = perTierTotal[tier] ?? 0
        return {
          results: [],
          meta: { query: p.q, total, took_ms: 0, source: 'search' },
        } satisfies SearchResponse
      }),
    },
    hooks: { register: mock(() => () => {}), has: mock(() => false), invoke: mock(async () => undefined) },
  } as unknown as PluginContext
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  clearAllOffsets()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('memory_status', () => {
  it('has the expected name with no params', () => {
    const tool = createMemoryStatusTool(makeCtx({}))
    expect(tool.name).toBe('bakin_exec_memory_status')
    expect(Object.keys(tool.parameters)).toHaveLength(0)
  })

  it('returns per-tier counts and totalRows', async () => {
    const ctx = makeCtx({
      session: 3, turn: 30, checkpoint: 1, daily_note: 7, dream: 2, durable: 4, audit: 10,
    })
    const tool = createMemoryStatusTool(ctx)
    const res = await tool.handler({}, 'system')
    expect(res.ok).toBe(true)
    expect(res.totalRows).toBe(57)
    const counts = res.countsByTier as Record<string, number>
    expect(counts.session).toBe(3)
    expect(counts.turn).toBe(30)
    expect(counts.audit).toBe(10)
    const calls = (ctx.search.query as ReturnType<typeof mock>).mock.calls as Array<[Record<string, unknown>]>
    for (const [call] of calls) {
      expect(call.q).toBe('*')
      expect(call.strategy).toBe('full_text_only')
    }
  })

  it('counts offsetsTracked from the persisted offsets file', async () => {
    setOffset('/tmp/a.jsonl', 10)
    setOffset('/tmp/b.jsonl', 20)
    const res = await createMemoryStatusTool(makeCtx({})).handler({}, 'system')
    expect(res.offsetsTracked).toBe(2)
  })

  it('degrades to 0 when a tier query throws', async () => {
    const ctx = makeCtx({ audit: 10 })
    const q = ctx.search.query as ReturnType<typeof mock>
    q.mockImplementation(async (p: { filters?: Record<string, string>; q: string }) => {
      if (p.filters?.tier === 'turn') throw new Error('boom')
      const tier = p.filters?.tier ?? ''
      const total = tier === 'audit' ? 10 : 0
      return { results: [], meta: { query: p.q, total, took_ms: 0, source: 'search' } } satisfies SearchResponse
    })
    const res = await createMemoryStatusTool(ctx).handler({}, 'system')
    expect(res.ok).toBe(true)
    const counts = res.countsByTier as Record<string, number>
    expect(counts.turn).toBe(0)
    expect(counts.audit).toBe(10)
  })
})
