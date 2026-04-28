/**
 * Tests for plugins/memory/mcp/get-turn.ts.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-mcp-getturn-${Date.now()}`)

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

import { createMemoryGetTurnTool } from '../../../../plugins/memory/mcp/get-turn'
import type { PluginContext, SearchResponse, SearchResult } from '../../../../src/lib/plugin-types'

function makeCtx(results: SearchResult[] = []): PluginContext {
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
      query: mock(async (p) => ({
        results,
        meta: { query: p.q, total: results.length, took_ms: 0, source: 'search' },
      } satisfies SearchResponse)),
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
