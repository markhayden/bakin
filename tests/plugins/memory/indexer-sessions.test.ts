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
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-indexer-sessions-${Date.now()}`)

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
mock.module('../../../packages/core/src/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, '.openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, '.openclaw', ...parts),
}))
mock.module('../../../src/core/main-agent', () => ({ tryGetMainAgentId: () => null }))

const {
  mockListAgentIds,
  mockReadSessionStore,
  mockMatchSessionStorePath,
  mockGatewayCall,
} = (() => ({
  mockListAgentIds: mock<() => string[]>(),
  mockReadSessionStore: mock<(agent: string) => unknown>(),
  mockMatchSessionStorePath: mock<(path: string) => { agent: string } | null>(),
  mockGatewayCall: mock<(method: string, params: unknown) => Promise<unknown>>(),
}))()

mock.module('../../../plugins/memory/lib/openclaw-adapter', () => ({
  listAgentIds: mockListAgentIds,
  readSessionStore: mockReadSessionStore,
  sessionStorePath: (agent: string) => `/fake/${agent}/sessions.json`,
  matchSessionStorePath: mockMatchSessionStorePath,
  // adjacent tiers — stubbed so fallthrough matchers don't blow up.
  readDurableFile: mock(() => null),
  durableFilePath: mock(() => ''),
  matchDurablePath: mock(() => null),
  CANONICAL_DURABLE_FILES: [] as const,
  listDailyNotes: mock(() => []),
  readDailyNote: mock(() => null),
  dailyNotePath: mock(() => ''),
  dailyNoteMtime: mock(() => null),
  dailyNoteSize: mock(() => 0),
  matchDailyNotePath: mock(() => null),
  // turn tier — stubbed; indexer tests for turn live in indexer-turns.test.ts.
  listSessionJsonlFiles: mock(() => []),
  sessionJsonlPath: mock(() => ''),
  sessionJsonlStat: mock(() => null),
  matchSessionJsonlPath: mock(() => null),
  // checkpoint tier (C7) — stubbed so handleWatcherEvent fallthrough doesn't blow up.
  listCheckpointJsonlFiles: mock(() => []),
  readCheckpoint: mock(() => null),
  checkpointJsonlPath: mock(() => ''),
  checkpointJsonlStat: mock(() => null),
  matchCheckpointJsonlPath: mock(() => null),
  // dream tier (C8) — stubs so handleWatcherEvent fallthrough doesn't blow up.
  listPhaseDocs: mock(() => []),
  listDreamSignalFiles: mock(() => []),
  readPhaseDoc: mock(() => null),
  readDreamSignal: mock(() => null),
  matchPhaseDocPath: mock(() => null),
  matchDreamSignalPath: mock(() => null),
  // skills (tier=durable, kind=skill) — stubs so handleWatcherEvent fallthrough doesn't blow up.
  DURABLE_KIND_BY_BASENAME: {} as Record<string, string>,
  durableKindForBasename: mock(() => undefined),
  listAgentSkills: mock(() => []),
  readAgentSkill: mock(() => null),
  skillFilePath: mock(() => ''),
  skillFileMtime: mock(() => null),
  matchSkillPath: mock(() => null),
}))

mock.module('../../../plugins/memory/lib/openclaw-gateway', () => ({
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
      index: mock(async (key: string, doc: Record<string, unknown>) => { indexed.push({ key, doc }) }),
      remove: mock(async (key: string) => { removed.push(key) }),
      transform: mock(async () => {}),
      query: mock(async () => ({
        results: [],
        meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const },
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
  mockGatewayCall.mockReset()
  mockMatchSessionStorePath.mockReturnValue(null)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('MemoryIndexer.indexTier("session") — gateway path', () => {
  it('indexes one row per session when gatewayCall succeeds', async () => {
    mockListAgentIds.mockReturnValue(['basil'])
    mockGatewayCall.mockResolvedValue({
      sessions: {
        'agent:basil:main': session({ sessionId: 'a' }),
        'agent:basil:openai:xyz': session({ sessionId: 'b' }),
      },
    })

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('session')

    expect(indexed).toHaveLength(2)
    const tiers = new Set(indexed.map((d) => d.doc.tier))
    expect(tiers).toEqual(new Set(['session']))
    const titles = new Set(indexed.map((d) => d.doc.title))
    expect(titles).toEqual(new Set(['agent:basil:main', 'agent:basil:openai:xyz']))
    expect(mockReadSessionStore).not.toHaveBeenCalled()
  })

  it('accepts the gateway returning a bare map (no "sessions" wrapper)', async () => {
    mockListAgentIds.mockReturnValue(['basil'])
    mockGatewayCall.mockResolvedValue({
      'agent:basil:main': session({ sessionId: 'a' }),
    })

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('session')

    expect(indexed).toHaveLength(1)
  })
})

describe('MemoryIndexer.indexTier("session") — FS fallback', () => {
  it('falls back to readSessionStore when gatewayCall throws', async () => {
    mockListAgentIds.mockReturnValue(['basil'])
    mockGatewayCall.mockRejectedValue(new Error('gateway unreachable'))
    mockReadSessionStore.mockReturnValue({
      'agent:basil:main': session({ sessionId: 'fs-a' }),
    })

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('session')

    expect(indexed).toHaveLength(1)
    expect(indexed[0].doc.title).toBe('agent:basil:main')
    expect(mockReadSessionStore).toHaveBeenCalledWith('basil')
  })

  it('is a no-op for an agent with neither gateway nor FS data', async () => {
    mockListAgentIds.mockReturnValue(['basil'])
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
    mockListAgentIds.mockReturnValue(['basil'])
    mockGatewayCall.mockResolvedValue({
      'agent:basil:recent': session({ sessionId: 'r', updatedAt: now - 5 * day }),
      'agent:basil:old': session({ sessionId: 'o', updatedAt: now - 60 * day }),
    })

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, { backfillDays: 30 })
    await idx.indexTier('session')

    expect(indexed).toHaveLength(1)
    expect(indexed[0].doc.title).toBe('agent:basil:recent')
  })
})

describe('MemoryIndexer.indexTier("session") — orphan removal', () => {
  it('removes rows for sessions that disappear from the roster between runs', async () => {
    mockListAgentIds.mockReturnValue(['basil'])
    mockGatewayCall
      .mockResolvedValueOnce({
        'agent:basil:a': session({ sessionId: 'sa' }),
        'agent:basil:b': session({ sessionId: 'sb' }),
      })
      .mockResolvedValueOnce({
        'agent:basil:a': session({ sessionId: 'sa' }),
      })

    const { ctx, indexed, removed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('session')
    expect(indexed).toHaveLength(2)
    const bId = indexed.find((d) => d.doc.title === 'agent:basil:b')!.key

    await idx.indexTier('session')
    expect(removed).toContain(bId)
  })
})

describe('MemoryIndexer.handleWatcherEvent — sessions.json', () => {
  it('routes a sessions.json change to indexTier("session") for that agent', async () => {
    mockListAgentIds.mockReturnValue(['basil'])
    mockGatewayCall.mockResolvedValue({
      'agent:basil:main': session({ sessionId: 'a' }),
    })
    mockMatchSessionStorePath.mockImplementation((p) =>
      p === '/fake/sessions.json' ? { agent: 'basil' } : null,
    )

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent('/fake/sessions.json', 'change')
    expect(indexed).toHaveLength(1)
    expect(indexed[0].doc.tier).toBe('session')
  })
})
