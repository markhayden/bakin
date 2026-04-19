/**
 * Tests for plugins/memory/mcp/get-session.ts.
 *
 * Two Antfly queries: one for the session row (tier=session), one for turns
 * (tier=turn). Matching is done by parsing each row's `meta` — we can't rely
 * on ids alone because a sessionKey can exist across agents.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-mcp-getsession-${Date.now()}`)

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

import { createMemoryGetSessionTool } from '../../../../plugins/memory/mcp/get-session'
import type { PluginContext, SearchResponse, SearchResult } from '../../../../src/lib/plugin-types'

function makeCtx(perTier: Record<string, SearchResult[]>): { ctx: PluginContext; calls: Array<Parameters<PluginContext['search']['query']>[0]> } {
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
        const tier = String((p.filters as Record<string, string> | undefined)?.tier ?? '')
        const results = perTier[tier] ?? []
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

function sessionRow(sessionKey: string, agent = 'scout'): SearchResult {
  return {
    id: `session:${sessionKey}`,
    table: 'bakin_memory',
    score: 0.9,
    fields: {
      tier: 'session',
      agent,
      title: sessionKey,
      updated_at: 100,
      meta: JSON.stringify({ sessionKey, sessionId: 'sid' }),
    },
  }
}

function turnRow(sessionKey: string, eventId: string, agent = 'scout'): SearchResult {
  return {
    id: `turn:${eventId}`,
    table: 'bakin_memory',
    score: 0.5,
    fields: {
      tier: 'turn',
      agent,
      title: eventId,
      snippet: `snippet ${eventId}`,
      updated_at: 200,
      meta: JSON.stringify({ sessionKey, sessionId: 'sid', eventId }),
    },
  }
}

describe('memory_get_session — identity', () => {
  it('is named bakin_exec_memory_get_session', () => {
    const { ctx } = makeCtx({})
    expect(createMemoryGetSessionTool(ctx).name).toBe('bakin_exec_memory_get_session')
  })
})

describe('memory_get_session — handler', () => {
  it('requires sessionKey', async () => {
    const { ctx } = makeCtx({})
    const res = await createMemoryGetSessionTool(ctx).handler({}, 'scout')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/sessionKey required/)
  })

  it('returns session + recent turns by matching meta.sessionKey', async () => {
    const { ctx } = makeCtx({
      session: [sessionRow('sk1'), sessionRow('sk2')],
      turn: [turnRow('sk1', 'e1'), turnRow('sk2', 'e2'), turnRow('sk1', 'e3')],
    })
    const res = await createMemoryGetSessionTool(ctx).handler({ sessionKey: 'sk1' }, 'scout')
    expect(res.ok).toBe(true)
    const session = res.session as { id: string; meta: { sessionKey: string } }
    expect(session.id).toBe('session:sk1')
    expect(session.meta.sessionKey).toBe('sk1')
    const turns = res.turns as Array<{ id: string; meta: { eventId: string } }>
    expect(turns.map((t) => t.meta.eventId).sort()).toEqual(['e1', 'e3'])
  })

  it('returns not found when no session matches', async () => {
    const { ctx } = makeCtx({ session: [sessionRow('different')] })
    const res = await createMemoryGetSessionTool(ctx).handler({ sessionKey: 'sk-missing' }, 'scout')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/not found/i)
  })

  it('passes agent filter down on both queries', async () => {
    const { ctx, calls } = makeCtx({ session: [sessionRow('sk1', 'basil')] })
    await createMemoryGetSessionTool(ctx).handler({ sessionKey: 'sk1', agent: 'basil' }, 'basil')
    expect(calls.every((c) => (c.filters as Record<string, string>).agent === 'basil')).toBe(true)
  })
})
