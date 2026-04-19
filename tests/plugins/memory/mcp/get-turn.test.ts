/**
 * Tests for plugins/memory/mcp/get-turn.ts.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-mcp-getturn-${Date.now()}`)

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

import { createMemoryGetTurnTool } from '../../../../plugins/memory/mcp/get-turn'
import type { PluginContext, SearchResponse, SearchResult } from '../../../../src/lib/plugin-types'

function makeCtx(results: SearchResult[] = []): PluginContext {
  return {
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
      query: vi.fn(async (p) => ({
        results,
        meta: { query: p.q, total: results.length, took_ms: 0, source: 'antfly' },
      } satisfies SearchResponse)),
    },
    hooks: { register: vi.fn(() => () => {}), has: vi.fn(() => false), invoke: vi.fn(async () => undefined) },
  } as unknown as PluginContext
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function turn(id: string): SearchResult {
  return {
    id,
    table: 'bakin_memory',
    score: 0.4,
    fields: {
      tier: 'turn',
      agent: 'scout',
      title: 'msg',
      content: 'full content of the turn',
      updated_at: 1,
      meta: JSON.stringify({ sessionId: 'sid', eventId: id.replace(/^turn:/, '') }),
    },
  }
}

describe('memory_get_turn', () => {
  it('has the expected name and param', () => {
    const tool = createMemoryGetTurnTool(makeCtx())
    expect(tool.name).toBe('bakin_exec_memory_get_turn')
    expect(tool.parameters.turnId).toBeDefined()
  })

  it('rejects missing turnId', async () => {
    const res = await createMemoryGetTurnTool(makeCtx()).handler({}, 'scout')
    expect(res.ok).toBe(false)
  })

  it('rejects turnId without the turn: prefix', async () => {
    const res = await createMemoryGetTurnTool(makeCtx()).handler({ turnId: 'session:foo' }, 'scout')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/turn:/)
  })

  it('returns the matched turn with parsed meta', async () => {
    const tool = createMemoryGetTurnTool(makeCtx([turn('turn:abc'), turn('turn:def')]))
    const res = await tool.handler({ turnId: 'turn:def' }, 'scout')
    expect(res.ok).toBe(true)
    const t = res.turn as { id: string; content: string; meta: { eventId: string } }
    expect(t.id).toBe('turn:def')
    expect(t.content).toBe('full content of the turn')
    expect(t.meta.eventId).toBe('def')
  })

  it('returns not-found when the id is missing', async () => {
    const res = await createMemoryGetTurnTool(makeCtx([])).handler({ turnId: 'turn:missing' }, 'scout')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/not found/i)
  })
})
