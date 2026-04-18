/**
 * Tests for MemoryIndexer.indexTier('session') and watcher routing for
 * OpenClaw session rosters.
 *
 * Source of truth:
 *   - Preferred: gateway RPC `sessions.list` (rich, live metadata).
 *   - Fallback: `agents/<id>/sessions/sessions.json` map, loaded via the
 *     openclaw-adapter, used when the gateway throws.
 *
 * Additional behaviors covered here:
 *   - 30-day backfill window (skip sessions with updatedAt < cutoff).
 *   - Orphan removal (rows disappear when sessionKey vanishes from the roster).
 *   - Watcher routing for `sessions.json` changes.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-indexer-sessions-${Date.now()}`)

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, audit: join(testDir, 'audit.jsonl') }),
}))
vi.mock('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, audit: join(testDir, 'audit.jsonl') }),
}))
vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('../../../src/core/watcher', () => ({ watchFiles: vi.fn() }))
vi.mock('../../../packages/core/src/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, '.openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, '.openclaw', ...parts),
}))
vi.mock('../../../src/core/main-agent', () => ({ tryGetMainAgentId: () => null }))

const {
  mockListAgentIds,
  mockReadSessionStore,
  mockMatchSessionStorePath,
  mockGatewayCall,
} = vi.hoisted(() => ({
  mockListAgentIds: vi.fn<() => string[]>(),
  mockReadSessionStore: vi.fn<(agent: string) => unknown>(),
  mockMatchSessionStorePath: vi.fn<(path: string) => { agent: string } | null>(),
  mockGatewayCall: vi.fn<(method: string, params: unknown) => Promise<unknown>>(),
}))

vi.mock('../../../plugins/memory/lib/openclaw-adapter', () => ({
  listAgentIds: mockListAgentIds,
  readSessionStore: mockReadSessionStore,
  sessionStorePath: (agent: string) => `/fake/${agent}/sessions.json`,
  matchSessionStorePath: mockMatchSessionStorePath,
  // adjacent tiers — stubbed so fallthrough matchers don't blow up.
  readDurableFile: vi.fn(() => null),
  durableFilePath: vi.fn(() => ''),
  matchDurablePath: vi.fn(() => null),
  CANONICAL_DURABLE_FILES: [] as const,
  listDailyNotes: vi.fn(() => []),
  readDailyNote: vi.fn(() => null),
  dailyNotePath: vi.fn(() => ''),
  dailyNoteMtime: vi.fn(() => null),
  dailyNoteSize: vi.fn(() => 0),
  matchDailyNotePath: vi.fn(() => null),
  // turn tier — stubbed; indexer tests for turn live in indexer-turns.test.ts.
  listSessionJsonlFiles: vi.fn(() => []),
  sessionJsonlPath: vi.fn(() => ''),
  sessionJsonlStat: vi.fn(() => null),
  matchSessionJsonlPath: vi.fn(() => null),
}))

vi.mock('../../../plugins/memory/lib/openclaw-gateway', () => ({
  gatewayCall: mockGatewayCall,
}))

import { MemoryIndexer } from '../../../plugins/memory/lib/indexer'
import { clearAllOffsets } from '../../../plugins/memory/lib/offsets'
import type { PluginContext } from '../../../src/lib/plugin-types'

interface IndexedDoc { key: string; doc: Record<string, unknown> }

function makeCtx(): { ctx: PluginContext; indexed: IndexedDoc[]; removed: string[] } {
  const indexed: IndexedDoc[] = []
  const removed: string[] = []
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
      index: vi.fn(async (key: string, doc: Record<string, unknown>) => { indexed.push({ key, doc }) }),
      remove: vi.fn(async (key: string) => { removed.push(key) }),
      transform: vi.fn(async () => {}),
      query: vi.fn(async () => ({
        results: [],
        meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const },
      })),
    },
    hooks: {
      register: vi.fn(() => () => {}),
      has: vi.fn(() => false),
      invoke: vi.fn(async () => undefined),
    },
  } as unknown as PluginContext
  return { ctx, indexed, removed }
}

function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: 'session-a',
    updatedAt: Date.now(),
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    contextTokens: 100,
    model: 'claude-opus-4-6',
    modelProvider: 'anthropic',
    abortedLastRun: false,
    origin: null,
    ...overrides,
  }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  clearAllOffsets()
  mockListAgentIds.mockReset()
  mockReadSessionStore.mockReset()
  mockMatchSessionStorePath.mockReset()
  mockGatewayCall.mockReset()
  mockMatchSessionStorePath.mockReturnValue(null)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('MemoryIndexer.indexTier("session") — gateway path', () => {
  it('indexes one row per session when gatewayCall succeeds', async () => {
    mockListAgentIds.mockReturnValue(['chef'])
    mockGatewayCall.mockResolvedValue({
      sessions: {
        'agent:chef:main': session({ sessionId: 'a' }),
        'agent:chef:openai:xyz': session({ sessionId: 'b' }),
      },
    })

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('session')

    expect(indexed).toHaveLength(2)
    const tiers = new Set(indexed.map((d) => d.doc.tier))
    expect(tiers).toEqual(new Set(['session']))
    const titles = new Set(indexed.map((d) => d.doc.title))
    expect(titles).toEqual(new Set(['agent:chef:main', 'agent:chef:openai:xyz']))
    expect(mockReadSessionStore).not.toHaveBeenCalled()
  })

  it('accepts the gateway returning a bare map (no "sessions" wrapper)', async () => {
    mockListAgentIds.mockReturnValue(['chef'])
    mockGatewayCall.mockResolvedValue({
      'agent:chef:main': session({ sessionId: 'a' }),
    })

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('session')

    expect(indexed).toHaveLength(1)
  })
})

describe('MemoryIndexer.indexTier("session") — FS fallback', () => {
  it('falls back to readSessionStore when gatewayCall throws', async () => {
    mockListAgentIds.mockReturnValue(['chef'])
    mockGatewayCall.mockRejectedValue(new Error('gateway unreachable'))
    mockReadSessionStore.mockReturnValue({
      'agent:chef:main': session({ sessionId: 'fs-a' }),
    })

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('session')

    expect(indexed).toHaveLength(1)
    expect(indexed[0].doc.title).toBe('agent:chef:main')
    expect(mockReadSessionStore).toHaveBeenCalledWith('chef')
  })

  it('is a no-op for an agent with neither gateway nor FS data', async () => {
    mockListAgentIds.mockReturnValue(['chef'])
    mockGatewayCall.mockRejectedValue(new Error('gateway unreachable'))
    mockReadSessionStore.mockReturnValue(null)

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('session')

    expect(indexed).toHaveLength(0)
  })
})

describe('MemoryIndexer.indexTier("session") — backfill window', () => {
  it('skips sessions older than the backfillDays cutoff', async () => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    mockListAgentIds.mockReturnValue(['chef'])
    mockGatewayCall.mockResolvedValue({
      'agent:chef:recent': session({ sessionId: 'r', updatedAt: now - 5 * day }),
      'agent:chef:old': session({ sessionId: 'o', updatedAt: now - 60 * day }),
    })

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, { backfillDays: 30 })
    await idx.indexTier('session')

    expect(indexed).toHaveLength(1)
    expect(indexed[0].doc.title).toBe('agent:chef:recent')
  })
})

describe('MemoryIndexer.indexTier("session") — orphan removal', () => {
  it('removes rows for sessions that disappear from the roster between runs', async () => {
    mockListAgentIds.mockReturnValue(['chef'])
    mockGatewayCall
      .mockResolvedValueOnce({
        'agent:chef:a': session({ sessionId: 'sa' }),
        'agent:chef:b': session({ sessionId: 'sb' }),
      })
      .mockResolvedValueOnce({
        'agent:chef:a': session({ sessionId: 'sa' }),
      })

    const { ctx, indexed, removed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('session')
    expect(indexed).toHaveLength(2)
    const bId = indexed.find((d) => d.doc.title === 'agent:chef:b')!.key

    await idx.indexTier('session')
    expect(removed).toContain(bId)
  })
})

describe('MemoryIndexer.handleWatcherEvent — sessions.json', () => {
  it('routes a sessions.json change to indexTier("session") for that agent', async () => {
    mockListAgentIds.mockReturnValue(['chef'])
    mockGatewayCall.mockResolvedValue({
      'agent:chef:main': session({ sessionId: 'a' }),
    })
    mockMatchSessionStorePath.mockImplementation((p) =>
      p === '/fake/sessions.json' ? { agent: 'chef' } : null,
    )

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent('/fake/sessions.json', 'change')
    expect(indexed).toHaveLength(1)
    expect(indexed[0].doc.tier).toBe('session')
  })
})
