/**
 * Tests for MemoryIndexer.indexTier('daily_note') + handleWatcherEvent
 * routing for OpenClaw daily notes under workspace/memory/*.md.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-indexer-daily-note-${Date.now()}`)

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
vi.mock('../../../src/core/main-agent', () => ({
  tryGetMainAgentId: () => null,
}))

const {
  mockListAgentIds,
  mockListDailyNotes,
  mockReadDailyNote,
  mockDailyNotePath,
  mockMatchDailyNotePath,
  mockMatchDurablePath,
} = vi.hoisted(() => ({
  mockListAgentIds: vi.fn<() => string[]>(),
  mockListDailyNotes: vi.fn<(agent: string) => string[]>(),
  mockReadDailyNote: vi.fn<(agent: string, filename: string) => string | null>(),
  mockDailyNotePath: vi.fn<(agent: string, filename: string) => string>(),
  mockMatchDailyNotePath: vi.fn<(path: string) => { agent: string; filename: string } | null>(),
  mockMatchDurablePath: vi.fn<(path: string) => { agent: string; basename: string } | null>(),
}))

vi.mock('../../../plugins/memory/lib/openclaw-adapter', () => ({
  listAgentIds: mockListAgentIds,
  listDailyNotes: mockListDailyNotes,
  readDailyNote: mockReadDailyNote,
  dailyNotePath: mockDailyNotePath,
  dailyNoteMtime: vi.fn(() => Date.now()),
  dailyNoteSize: vi.fn(() => 0),
  matchDailyNotePath: mockMatchDailyNotePath,
  // unrelated but imported by indexer — stub to avoid undefined-function errors
  matchDurablePath: mockMatchDurablePath,
  readDurableFile: vi.fn(() => null),
  durableFilePath: vi.fn(() => ''),
  CANONICAL_DURABLE_FILES: [] as const,
  // session / turn / checkpoint / dream tiers — stubs so handleWatcherEvent fallthrough doesn't blow up.
  readSessionStore: vi.fn(() => null),
  sessionStorePath: vi.fn(() => ''),
  matchSessionStorePath: vi.fn(() => null),
  listSessionJsonlFiles: vi.fn(() => []),
  sessionJsonlPath: vi.fn(() => ''),
  sessionJsonlStat: vi.fn(() => null),
  matchSessionJsonlPath: vi.fn(() => null),
  listCheckpointJsonlFiles: vi.fn(() => []),
  readCheckpoint: vi.fn(() => null),
  checkpointJsonlPath: vi.fn(() => ''),
  checkpointJsonlStat: vi.fn(() => null),
  matchCheckpointJsonlPath: vi.fn(() => null),
  listPhaseDocs: vi.fn(() => []),
  listDreamSignalFiles: vi.fn(() => []),
  readPhaseDoc: vi.fn(() => null),
  readDreamSignal: vi.fn(() => null),
  matchPhaseDocPath: vi.fn(() => null),
  matchDreamSignalPath: vi.fn(() => null),
  // skills (tier=durable, kind=skill) — stubs so handleWatcherEvent fallthrough doesn't blow up.
  DURABLE_KIND_BY_BASENAME: {} as Record<string, string>,
  durableKindForBasename: vi.fn(() => undefined),
  listAgentSkills: vi.fn(() => []),
  readAgentSkill: vi.fn(() => null),
  skillFilePath: vi.fn(() => ''),
  skillFileMtime: vi.fn(() => null),
  matchSkillPath: vi.fn(() => null),
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
      index: vi.fn(async (key: string, doc: Record<string, unknown>) => {
        indexed.push({ key, doc })
      }),
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
