/**
 * Tests for plugins/memory/mcp/search.ts.
 *
 * memory_search is the agent-facing surface to the unified bakin_memory
 * table. It must: validate the query, forward tier/agent/limit down to
 * ctx.search.query, parse meta JSON so the response is ergonomic, and
 * degrade gracefully when the underlying search throws.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-mcp-search-${Date.now()}`)

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

import { createMemorySearchTool } from '../../../../plugins/memory/mcp/search'
import type { PluginContext, SearchResponse } from '../../../../src/lib/plugin-types'

function makeCtx(results: SearchResponse['results'] = []): { ctx: PluginContext; calls: Array<Parameters<PluginContext['search']['query']>[0]> } {
  const calls: Array<Parameters<PluginContext['search']['query']>[0]> = []
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
        calls.push(p)
        return {
          results,
          meta: { query: p.q, total: results.length, took_ms: 0, source: 'antfly' },
        } satisfies SearchResponse
      }),
    },
    hooks: { register: vi.fn(() => () => {}), has: vi.fn(() => false), invoke: vi.fn(async () => undefined) },
  } as unknown as PluginContext
  return { ctx, calls }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('memory_search MCP tool — identity', () => {
  it('is named bakin_exec_memory_search with a query param', () => {
    const { ctx } = makeCtx()
    const tool = createMemorySearchTool(ctx)
    expect(tool.name).toBe('bakin_exec_memory_search')
    expect(tool.parameters.query).toBeDefined()
  })
})

describe('memory_search MCP tool — handler', () => {
  it('returns error when query is missing', async () => {
    const { ctx } = makeCtx()
    const tool = createMemorySearchTool(ctx)
    const res = await tool.handler({}, 'scout')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/query required/)
  })

  it('passes tier and agent filters through to ctx.search.query', async () => {
    const { ctx, calls } = makeCtx()
    const tool = createMemorySearchTool(ctx)
    await tool.handler({ query: 'needle', tier: 'session', agent: 'scout' }, 'scout')
    expect(calls).toHaveLength(1)
    expect(calls[0].filters).toEqual({ tier: 'session', agent: 'scout' })
    expect(calls[0].q).toBe('needle')
  })

  it('defaults limit to 20 and clamps above 100', async () => {
    const { ctx, calls } = makeCtx()
    const tool = createMemorySearchTool(ctx)
    await tool.handler({ query: 'x' }, 'scout')
    expect(calls[0].limit).toBe(20)
    await tool.handler({ query: 'x', limit: 500 }, 'scout')
    expect(calls[1].limit).toBe(100)
  })

  it('parses meta JSON and returns the spec-shaped result', async () => {
    const { ctx } = makeCtx([
      {
        id: 'session:abc',
        table: 'bakin_memory',
        score: 0.9,
        fields: {
          tier: 'session',
          agent: 'scout',
          title: 'A',
          snippet: 'snippet',
          source_backend: 'openclaw',
          source_path: '/p',
          updated_at: 1,
          meta: JSON.stringify({ sessionKey: 'sk' }),
        },
      },
    ])
    const tool = createMemorySearchTool(ctx)
    const res = await tool.handler({ query: 'x' }, 'scout')
    expect(res.ok).toBe(true)
    const rows = res.results as Array<Record<string, unknown>>
    expect(rows[0].id).toBe('session:abc')
    expect(rows[0].tier).toBe('session')
    expect(rows[0].agent).toBe('scout')
    expect(rows[0].score).toBe(0.9)
    expect((rows[0].sourceRef as { backend: string }).backend).toBe('openclaw')
    expect((rows[0].meta as { sessionKey: string }).sessionKey).toBe('sk')
  })

  it('degrades gracefully when ctx.search.query throws', async () => {
    const { ctx } = makeCtx()
    ;(ctx.search.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'))
    const tool = createMemorySearchTool(ctx)
    const res = await tool.handler({ query: 'x' }, 'scout')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('boom')
  })
})
