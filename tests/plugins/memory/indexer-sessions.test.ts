/**
 * Tests for MemoryIndexer.indexTier('session') and watcher routing for
 * OpenClaw session rosters.
 *
 * Source of truth: runtime memory `session_store` entries.
 *
 * Additional behaviors covered here:
 *   - 30-day backfill window (skip sessions with updatedAt < cutoff).
 *   - Orphan removal (rows disappear when sessionKey vanishes from the roster).
 *   - Watcher routing for `sessions.json` changes.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-indexer-sessions-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, audit: join(testDir, 'audit.jsonl') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, audit: join(testDir, 'audit.jsonl') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/watcher', () => ({ watchFiles: mock() }))
mock.module('../../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => join(testDir, '.openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, '.openclaw', ...parts),
}))
mock.module('../../../packages/adapter-openclaw/src/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => null,
  getMainAgentName: () => 'Main',
}))

const {
  mockListAgentIds,
  mockReadSessionStore,
  mockMatchSessionStorePath,
  mockRuntimeSessionList,
} = (() => ({
  mockListAgentIds: mock<() => string[]>(),
  mockReadSessionStore: mock<(agent: string) => unknown>(),
  mockMatchSessionStorePath: mock<(path: string) => { agent: string } | null>(),
  mockRuntimeSessionList: mock<(method: string, params: unknown) => Promise<unknown>>(),
}))()

import { MemoryIndexer } from '../../../plugins/memory/lib/indexer'
import { clearAllOffsets } from '../../../plugins/memory/lib/offsets'
import type { PluginContext } from '@bakin/core/plugin-types'

interface IndexedDoc { key: string; doc: Record<string, unknown> }

function makeCtx(): { ctx: PluginContext; indexed: IndexedDoc[]; removed: string[] } {
  const indexed: IndexedDoc[] = []
  const removed: string[] = []
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
    runtime: {
      agents: {
        list: mock(async () => mockListAgentIds().map((id) => ({ id, name: id }))),
      },
      memory: {
        listTiers: mock(async () => [{ id: 'sessions-tier', label: 'Sessions', metadata: { sourceKind: 'session_store' } }]),
        getEntry: mock(async (_tierId: string, id: string, opts?: { agentId?: string }) => {
          if (id !== 'sessions.json' || !opts?.agentId) return null
          let value: unknown
          try {
            value = await mockRuntimeSessionList('sessions.list', { agentId: opts.agentId })
          } catch {
            value = mockReadSessionStore(opts.agentId)
          }
          if (value === null || value === undefined) return null
          return {
            id,
            tierId: 'sessions-tier',
            agentId: opts.agentId,
            path: `/fake/${opts.agentId}/sessions.json`,
            content: JSON.stringify(value),
          }
        }),
        resolvePath: mock(async (path: string) => {
          const match = mockMatchSessionStorePath(path)
          return match
            ? {
                tierId: 'sessions-tier',
                id: 'sessions.json',
                agentId: match.agent,
                path,
                metadata: { sourceKind: 'session_store' },
              }
            : null
        }),
      },
    },
    search: {
      registerContentType: mock(),
      registerFileBackedContentType: mock(),
      index: mock(async (key: string, doc: Record<string, unknown>) => { indexed.push({ key, doc }) }),
      remove: mock(async (key: string) => { removed.push(key) }),
      transform: mock(async () => {}),
      query: mock(async () => ({
        results: [],
        meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' as const },
      })),
    },
    hooks: {
      register: mock(() => () => {}),
      has: mock(() => false),
      invoke: mock(async () => undefined),
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
  mockRuntimeSessionList.mockReset()
  mockMatchSessionStorePath.mockReturnValue(null)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('MemoryIndexer.indexTier("session") — runtime memory path', () => {
  it('indexes one row per session when runtime memory returns sessions', async () => {
    mockListAgentIds.mockReturnValue(['chef'])
    mockRuntimeSessionList.mockResolvedValue({
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

  it('accepts a bare session map (no "sessions" wrapper)', async () => {
    mockListAgentIds.mockReturnValue(['chef'])
    mockRuntimeSessionList.mockResolvedValue({
      'agent:chef:main': session({ sessionId: 'a' }),
    })

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('session')

    expect(indexed).toHaveLength(1)
  })
})

describe('MemoryIndexer.indexTier("session") — FS fallback', () => {
  it('falls back to readSessionStore when runtime memory throws', async () => {
    mockListAgentIds.mockReturnValue(['chef'])
    mockRuntimeSessionList.mockRejectedValue(new Error('runtime unavailable'))
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

  it('is a no-op for an agent with neither runtime nor FS data', async () => {
    mockListAgentIds.mockReturnValue(['chef'])
    mockRuntimeSessionList.mockRejectedValue(new Error('runtime unavailable'))
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
    mockRuntimeSessionList.mockResolvedValue({
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
    mockRuntimeSessionList
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
    mockRuntimeSessionList.mockResolvedValue({
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
