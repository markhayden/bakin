/**
 * Tests for MemoryIndexer.indexTier('turn') and watcher routing for
 * per-session JSONL transcripts.
 *
 * Behaviors covered:
 *   - Each session JSONL → one row per non-skipped line.
 *   - `*.reset.*.jsonl` files are skipped (historical backups).
 *   - Files over `skipSessionOverBytes` trigger head-only chunking (first
 *     2000 lines indexed; oversize flag surfaced to meta). Full tail chunking
 *     is a follow-up — documented as a known gap in the knowledge doc.
 *   - Persisted offsets so a second call on an unchanged file re-emits zero rows.
 *   - Watcher `file.change` on a session JSONL routes into the turn indexer.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-indexer-turns-${Date.now()}`)

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
mock.module('../../../packages/core/src/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, '.openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, '.openclaw', ...parts),
}))
mock.module('../../../src/core/main-agent', () => ({ tryGetMainAgentId: () => null }))

interface JsonlFile {
  agent: string
  sessionId: string
  sessionKey: string
  path: string
  size: number
  mtimeMs: number
  isReset: boolean
}

const {
  mockListAgentIds,
  mockListSessionJsonlFiles,
  mockSessionJsonlPath,
  mockSessionJsonlStat,
  mockMatchSessionJsonlPath,
  mockGatewayCall,
} = (() => ({
  mockListAgentIds: mock<() => string[]>(),
  mockListSessionJsonlFiles: mock<(agent: string) => JsonlFile[]>(),
  mockSessionJsonlPath: mock<(agent: string, sessionId: string) => string>(),
  mockSessionJsonlStat: mock<(path: string) => { size: number; mtimeMs: number } | null>(),
  mockMatchSessionJsonlPath: mock<(path: string) => { agent: string; sessionId: string; isReset: boolean } | null>(),
  mockGatewayCall: mock<(method: string, params: unknown) => Promise<unknown>>(),
}))()

mock.module('../../../plugins/memory/lib/openclaw-adapter', () => ({
  listAgentIds: mockListAgentIds,
  listSessionJsonlFiles: mockListSessionJsonlFiles,
  sessionJsonlPath: mockSessionJsonlPath,
  sessionJsonlStat: mockSessionJsonlStat,
  matchSessionJsonlPath: mockMatchSessionJsonlPath,
  // adjacent tiers stubbed.
  readSessionStore: mock(() => null),
  matchSessionStorePath: mock(() => null),
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
  // checkpoint tier — stubbed so handleWatcherEvent fallthrough doesn't blow up.
  listCheckpointJsonlFiles: mock(() => []),
  readCheckpoint: mock(() => null),
  checkpointJsonlPath: mock(() => ''),
  checkpointJsonlStat: mock(() => null),
  matchCheckpointJsonlPath: mock(() => null),
  // dream tier — stubbed.
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

function writeJsonl(path: string, lines: unknown[]): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, lines.map((o) => JSON.stringify(o)).join('\n') + '\n')
}

function userMessage(id: string, text: string): unknown {
  return {
    type: 'message', id, parentId: null,
    timestamp: '2026-04-12T04:56:30.082Z',
    message: { role: 'user', content: [{ type: 'text', text }] },
  }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  clearAllOffsets()
  mockListAgentIds.mockReset()
  mockListSessionJsonlFiles.mockReset()
  mockSessionJsonlPath.mockReset()
  mockSessionJsonlStat.mockReset()
  mockMatchSessionJsonlPath.mockReset()
  mockGatewayCall.mockReset()
  mockGatewayCall.mockRejectedValue(new Error('gateway unused in these tests'))
  mockMatchSessionJsonlPath.mockReturnValue(null)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('MemoryIndexer.indexTier("turn") — basic streaming', () => {
  it('indexes one row per non-skipped line in each session JSONL', async () => {
    const path = join(testDir, 'sess-a.jsonl')
    writeJsonl(path, [
      { type: 'session', version: 3, id: 'sess-a', timestamp: '2026-04-12T04:56:30.074Z' },
      { type: 'model_change', id: 'm1', parentId: null, timestamp: '...' },
      userMessage('u1', 'hello'),
      userMessage('u2', 'world'),
    ])

    mockListAgentIds.mockReturnValue(['chef'])
    mockListSessionJsonlFiles.mockReturnValue([
      { agent: 'chef', sessionId: 'sess-a', sessionKey: 'agent:chef:main', path, size: 10_000, mtimeMs: Date.now(), isReset: false },
    ])

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('turn')

    expect(indexed).toHaveLength(2)
    const contents = indexed.map((d) => d.doc.content)
    expect(contents).toEqual(['hello', 'world'])
  })

  it('skips *.reset.*.jsonl files entirely', async () => {
    const path = join(testDir, 'sess-a.reset.2026-04-12.jsonl')
    writeJsonl(path, [userMessage('u1', 'should not index')])

    mockListAgentIds.mockReturnValue(['chef'])
    mockListSessionJsonlFiles.mockReturnValue([
      { agent: 'chef', sessionId: 'sess-a', sessionKey: 'agent:chef:main', path, size: 200, mtimeMs: Date.now(), isReset: true },
    ])

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('turn')

    expect(indexed).toHaveLength(0)
  })
})

describe('MemoryIndexer.indexTier("turn") — oversize handling', () => {
  it('head-chunks when file size exceeds skipSessionOverBytes', async () => {
    const path = join(testDir, 'big.jsonl')
    const lines: unknown[] = [
      { type: 'session', version: 3, id: 'big', timestamp: '2026-04-12T04:56:30.074Z' },
    ]
    // 2500 user messages ensures the head-chunk cap (2000) is exceeded.
    for (let i = 0; i < 2500; i += 1) lines.push(userMessage(`u${i}`, `msg-${i}`))
    writeJsonl(path, lines)

    mockListAgentIds.mockReturnValue(['chef'])
    mockListSessionJsonlFiles.mockReturnValue([
      { agent: 'chef', sessionId: 'big', sessionKey: 'agent:chef:main', path, size: 100_000_000, mtimeMs: Date.now(), isReset: false },
    ])

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, { skipSessionOverBytes: 10_000_000 })
    await idx.indexTier('turn')

    expect(indexed.length).toBeLessThanOrEqual(2000)
    expect(indexed.length).toBeGreaterThan(0)
  })
})

describe('MemoryIndexer.indexTier("turn") — incremental offsets', () => {
  it('re-emits zero rows for an unchanged file on a second call', async () => {
    const path = join(testDir, 'sess-b.jsonl')
    writeJsonl(path, [
      { type: 'session', version: 3, id: 'sess-b', timestamp: '2026-04-12T04:56:30.074Z' },
      userMessage('u1', 'hi'),
    ])

    mockListAgentIds.mockReturnValue(['chef'])
    mockListSessionJsonlFiles.mockReturnValue([
      { agent: 'chef', sessionId: 'sess-b', sessionKey: 'agent:chef:main', path, size: 500, mtimeMs: Date.now(), isReset: false },
    ])

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('turn')
    const firstCount = indexed.length
    expect(firstCount).toBeGreaterThan(0)

    await idx.indexTier('turn')
    expect(indexed.length).toBe(firstCount)
  })

  it('picks up appended lines between calls', async () => {
    const path = join(testDir, 'sess-c.jsonl')
    writeJsonl(path, [
      { type: 'session', version: 3, id: 'sess-c', timestamp: '2026-04-12T04:56:30.074Z' },
      userMessage('u1', 'first'),
    ])

    mockListAgentIds.mockReturnValue(['chef'])
    mockListSessionJsonlFiles.mockReturnValue([
      { agent: 'chef', sessionId: 'sess-c', sessionKey: 'agent:chef:main', path, size: 500, mtimeMs: Date.now(), isReset: false },
    ])

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('turn')
    const firstCount = indexed.length

    appendFileSync(path, JSON.stringify(userMessage('u2', 'second')) + '\n')
    await idx.indexTier('turn')

    expect(indexed.length).toBe(firstCount + 1)
    expect(indexed[indexed.length - 1].doc.content).toBe('second')
  })
})

describe('MemoryIndexer.handleWatcherEvent — session JSONL', () => {
  it('routes a session JSONL change event into the turn indexer', async () => {
    const path = join(testDir, 'sess-d.jsonl')
    writeJsonl(path, [
      { type: 'session', version: 3, id: 'sess-d', timestamp: '2026-04-12T04:56:30.074Z' },
      userMessage('u1', 'watcher'),
    ])

    mockSessionJsonlPath.mockReturnValue(path)
    mockSessionJsonlStat.mockReturnValue({ size: 500, mtimeMs: Date.now() })
    mockMatchSessionJsonlPath.mockImplementation((p) =>
      p === path ? { agent: 'chef', sessionId: 'sess-d', isReset: false } : null,
    )

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent(path, 'change')

    expect(indexed).toHaveLength(1)
    expect(indexed[0].doc.content).toBe('watcher')
  })

  it('ignores watcher events for *.reset.*.jsonl files', async () => {
    const path = join(testDir, 'sess-e.reset.jsonl')
    writeJsonl(path, [userMessage('u1', 'should not')])

    mockMatchSessionJsonlPath.mockImplementation((p) =>
      p === path ? { agent: 'chef', sessionId: 'sess-e', isReset: true } : null,
    )

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent(path, 'change')

    expect(indexed).toHaveLength(0)
  })
})
