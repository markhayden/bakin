/**
 * Tests for MemoryIndexer.indexTier('daily_note') + handleWatcherEvent
 * routing for OpenClaw daily notes under workspace/memory/*.md.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-indexer-daily-note-${Date.now()}`)

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
mock.module('../../../src/core/main-agent', () => ({
  tryGetMainAgentId: () => null,
}))

const {
  mockListAgentIds,
  mockListDailyNotes,
  mockReadDailyNote,
  mockDailyNotePath,
  mockMatchDailyNotePath,
  mockMatchDurablePath,
} = (() => ({
  mockListAgentIds: mock<() => string[]>(),
  mockListDailyNotes: mock<(agent: string) => string[]>(),
  mockReadDailyNote: mock<(agent: string, filename: string) => string | null>(),
  mockDailyNotePath: mock<(agent: string, filename: string) => string>(),
  mockMatchDailyNotePath: mock<(path: string) => { agent: string; filename: string } | null>(),
  mockMatchDurablePath: mock<(path: string) => { agent: string; basename: string } | null>(),
}))()

mock.module('../../../plugins/memory/lib/openclaw-adapter', () => ({
  listAgentIds: mockListAgentIds,
  listDailyNotes: mockListDailyNotes,
  readDailyNote: mockReadDailyNote,
  dailyNotePath: mockDailyNotePath,
  dailyNoteMtime: mock(() => Date.now()),
  dailyNoteSize: mock(() => 0),
  matchDailyNotePath: mockMatchDailyNotePath,
  // unrelated but imported by indexer — stub to avoid undefined-function errors
  matchDurablePath: mockMatchDurablePath,
  readDurableFile: mock(() => null),
  durableFilePath: mock(() => ''),
  CANONICAL_DURABLE_FILES: [] as const,
  // session / turn / checkpoint / dream tiers — stubs so handleWatcherEvent fallthrough doesn't blow up.
  readSessionStore: mock(() => null),
  sessionStorePath: mock(() => ''),
  matchSessionStorePath: mock(() => null),
  listSessionJsonlFiles: mock(() => []),
  sessionJsonlPath: mock(() => ''),
  sessionJsonlStat: mock(() => null),
  matchSessionJsonlPath: mock(() => null),
  listCheckpointJsonlFiles: mock(() => []),
  readCheckpoint: mock(() => null),
  checkpointJsonlPath: mock(() => ''),
  checkpointJsonlStat: mock(() => null),
  matchCheckpointJsonlPath: mock(() => null),
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
      index: mock(async (key: string, doc: Record<string, unknown>) => {
        indexed.push({ key, doc })
      }),
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

function writeFixture(agent: string, filename: string, body: string): string {
  const dir = join(testDir, 'workspaces', agent, 'memory')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, filename)
  writeFileSync(file, body)
  return file
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  clearAllOffsets()
  mockListAgentIds.mockReset()
  mockListDailyNotes.mockReset()
  mockReadDailyNote.mockReset()
  mockDailyNotePath.mockReset()
  mockMatchDailyNotePath.mockReset()
  mockMatchDurablePath.mockReset()
  mockMatchDurablePath.mockReturnValue(null)
  mockMatchDailyNotePath.mockReturnValue(null)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('MemoryIndexer.indexTier("daily_note")', () => {
  it('is a no-op when no agents exist', async () => {
    mockListAgentIds.mockReturnValue([])
    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('daily_note')
    expect(indexed).toHaveLength(0)
  })

  it('iterates each agent and indexes its daily notes', async () => {
    mockListAgentIds.mockReturnValue(['main', 'explorer'])
    mockListDailyNotes.mockImplementation((agent) =>
      agent === 'main' ? ['2026-04-18.md', '2026-04-17.md'] :
      agent === 'explorer' ? ['2026-04-18.md'] : [],
    )
    mockReadDailyNote.mockReturnValue('body')
    const mainFile = writeFixture('main', '2026-04-18.md', 'body')
    mockDailyNotePath.mockImplementation((agent, filename) =>
      join(testDir, 'workspaces', agent, 'memory', filename),
    )
    void mainFile

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('daily_note')

    expect(indexed).toHaveLength(3)
    const tiers = new Set(indexed.map((d) => d.doc.tier))
    expect(tiers).toEqual(new Set(['daily_note']))
  })

  it('skips non-date-prefixed files', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    mockListDailyNotes.mockReturnValue(['random.md', '2026-04-18.md'])
    mockReadDailyNote.mockReturnValue('body')
    mockDailyNotePath.mockReturnValue(join(testDir, 'f.md'))

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('daily_note')

    expect(indexed).toHaveLength(1)
    expect(indexed[0].doc.title).toBe('2026-04-18.md')
  })

  it('is idempotent — re-indexing the same file produces the same key', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    mockListDailyNotes.mockReturnValue(['2026-04-18.md'])
    mockReadDailyNote.mockReturnValue('body')
    mockDailyNotePath.mockReturnValue(join(testDir, 'x.md'))

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('daily_note')
    await idx.indexTier('daily_note')

    const uniq = new Set(indexed.map((d) => d.key))
    expect(uniq.size).toBe(1)
    expect(indexed).toHaveLength(2)
  })
})

describe('MemoryIndexer.handleWatcherEvent routing (daily_note)', () => {
  it('routes a daily-note change event into the daily-note indexer', async () => {
    const file = writeFixture('main', '2026-04-18.md', 'body')
    mockReadDailyNote.mockReturnValue('body')
    mockDailyNotePath.mockReturnValue(file)
    mockMatchDailyNotePath.mockImplementation((p) =>
      p === file ? { agent: 'main', filename: '2026-04-18.md' } : null,
    )

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent(file, 'change')

    expect(indexed).toHaveLength(1)
    expect(indexed[0].doc.tier).toBe('daily_note')
  })

  it('removes a daily-note row on unlink', async () => {
    const file = writeFixture('main', '2026-04-18.md', 'body')
    mockReadDailyNote.mockReturnValue('body')
    mockDailyNotePath.mockReturnValue(file)
    mockMatchDailyNotePath.mockImplementation((p) =>
      p === file ? { agent: 'main', filename: '2026-04-18.md' } : null,
    )

    const { ctx, indexed, removed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent(file, 'change')
    expect(indexed).toHaveLength(1)

    await idx.handleWatcherEvent(file, 'unlink')
    expect(removed).toEqual([indexed[0].key])
  })
})

describe('MemoryIndexer.backfill(["daily_note"])', () => {
  it('falls through to indexTier("daily_note")', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    mockListDailyNotes.mockReturnValue(['2026-04-18.md'])
    mockReadDailyNote.mockReturnValue('body')
    mockDailyNotePath.mockReturnValue(join(testDir, 'x.md'))

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.backfill(['daily_note'])
    expect(indexed).toHaveLength(1)
  })
})
