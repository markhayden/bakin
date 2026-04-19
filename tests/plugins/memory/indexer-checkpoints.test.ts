/**
 * Tests for MemoryIndexer.indexTier('checkpoint') and watcher routing for
 * OpenClaw compaction checkpoints.
 *
 * A checkpoint file is `<sessionId>.checkpoint.<checkpointId>.jsonl`, written
 * alongside the session transcript. Each file contains a single row: one
 * compaction event whose `summary` becomes the indexed content.
 *
 * Covered behaviors:
 *   - full-tier backfill across all agents
 *   - watcher add/change → index single file
 *   - watcher unlink → remove row + forget any per-file state
 *   - "first compaction wins" happens in the parser; here we just verify
 *     the indexer routes files to the parser and writes the resulting row.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-indexer-checkpoint-${Date.now()}`)

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

interface CheckpointJsonlFile {
  agent: string
  sessionId: string
  checkpointId: string
  filename: string
  path: string
  size: number
  mtimeMs: number
}

const {
  mockListAgentIds,
  mockListCheckpointJsonlFiles,
  mockReadCheckpoint,
  mockMatchCheckpointJsonlPath,
  mockCheckpointJsonlStat,
} = vi.hoisted(() => ({
  mockListAgentIds: vi.fn<() => string[]>(),
  mockListCheckpointJsonlFiles: vi.fn<(agent: string) => Array<{
    agent: string
    sessionId: string
    checkpointId: string
    filename: string
    path: string
    size: number
    mtimeMs: number
  }>>(),
  mockReadCheckpoint: vi.fn<(agent: string, filename: string) => string | null>(),
  mockMatchCheckpointJsonlPath: vi.fn<(path: string) => {
    agent: string
    sessionId: string
    checkpointId: string
    filename: string
  } | null>(),
  mockCheckpointJsonlStat: vi.fn<(path: string) => { size: number; mtimeMs: number } | null>(),
}))

vi.mock('../../../plugins/memory/lib/openclaw-adapter', () => ({
  listAgentIds: mockListAgentIds,
  // Checkpoint helpers — the new surface this commit adds.
  listCheckpointJsonlFiles: mockListCheckpointJsonlFiles,
  readCheckpoint: mockReadCheckpoint,
  matchCheckpointJsonlPath: mockMatchCheckpointJsonlPath,
  checkpointJsonlStat: mockCheckpointJsonlStat,
  // Other tiers — stubbed so fallthrough matchers don't blow up.
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
  readSessionStore: vi.fn(() => null),
  sessionStorePath: vi.fn(() => ''),
  matchSessionStorePath: vi.fn(() => null),
  listSessionJsonlFiles: vi.fn(() => []),
  sessionJsonlPath: vi.fn(() => ''),
  sessionJsonlStat: vi.fn(() => null),
  matchSessionJsonlPath: vi.fn(() => null),
  // dream tier (C8) — stubs so handleWatcherEvent fallthrough doesn't blow up.
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

vi.mock('../../../plugins/memory/lib/openclaw-gateway', () => ({
  gatewayCall: vi.fn(() => Promise.reject(new Error('gateway unused'))),
}))

import { MemoryIndexer } from '../../../plugins/memory/lib/indexer'
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

function cmpBody(summary = '## Decisions\nNone.\n## Progress\n- Did a thing.'): string {
  return (
    JSON.stringify({
      type: 'session', version: 3, id: 'sess-1', timestamp: '2026-04-15T23:19:17.284Z',
    }) +
    '\n' +
    JSON.stringify({
      type: 'compaction',
      id: 'cmp-1',
      timestamp: '2026-04-15T23:23:17.558Z',
      summary,
      tokensBefore: 74871,
      fromHook: true,
    }) +
    '\n'
  )
}

function fakeFile(
  agent: string,
  sessionId: string,
  checkpointId: string,
): CheckpointJsonlFile {
  const filename = `${sessionId}.checkpoint.${checkpointId}.jsonl`
  const path = `/fake/${agent}/sessions/${filename}`
  return {
    agent,
    sessionId,
    checkpointId,
    filename,
    path,
    size: 1234,
    mtimeMs: 1_700_000_000_000,
  }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mockListAgentIds.mockReset()
  mockListCheckpointJsonlFiles.mockReset()
  mockReadCheckpoint.mockReset()
  mockMatchCheckpointJsonlPath.mockReset()
  mockCheckpointJsonlStat.mockReset()
  mockMatchCheckpointJsonlPath.mockReturnValue(null)
  mockCheckpointJsonlStat.mockReturnValue({ size: 1234, mtimeMs: 1_700_000_000_000 })
  mockListCheckpointJsonlFiles.mockReturnValue([])
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('MemoryIndexer.indexTier("checkpoint") — backfill', () => {
  it('walks every agent × checkpoint file and writes one row each', async () => {
    mockListAgentIds.mockReturnValue(['main', 'pixel'])
    mockListCheckpointJsonlFiles.mockImplementation((agent) => {
      if (agent === 'main') return [fakeFile('main', 'sess-1', 'cp-a'), fakeFile('main', 'sess-2', 'cp-b')]
      if (agent === 'pixel') return [fakeFile('pixel', 'sess-x', 'cp-c')]
      return []
    })
    mockReadCheckpoint.mockImplementation((_a, _f) => cmpBody())

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('checkpoint')

    expect(indexed).toHaveLength(3)
    expect(new Set(indexed.map((d) => d.doc.tier))).toEqual(new Set(['checkpoint']))
    const agents = new Set(indexed.map((d) => d.doc.agent))
    expect(agents).toEqual(new Set(['main', 'pixel']))
  })

  it('skips files with no compaction event', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    mockListCheckpointJsonlFiles.mockReturnValue([fakeFile('main', 'sess-1', 'cp-a')])
    mockReadCheckpoint.mockReturnValue(
      JSON.stringify({ type: 'session', id: 'sess-1', timestamp: '2026-01-01T00:00:00Z' }) + '\n',
    )
    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('checkpoint')
    expect(indexed).toHaveLength(0)
  })

  it('skips files that adapter returns as unreadable (null body)', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    mockListCheckpointJsonlFiles.mockReturnValue([fakeFile('main', 'sess-1', 'cp-a')])
    mockReadCheckpoint.mockReturnValue(null)
    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('checkpoint')
    expect(indexed).toHaveLength(0)
  })
})

describe('MemoryIndexer.handleWatcherEvent — checkpoint files', () => {
  it('routes add/change to a single-file index with the expected row id', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    mockMatchCheckpointJsonlPath.mockImplementation((p) =>
      p === '/fake/main/sessions/sess-1.checkpoint.cp-a.jsonl'
        ? { agent: 'main', sessionId: 'sess-1', checkpointId: 'cp-a', filename: 'sess-1.checkpoint.cp-a.jsonl' }
        : null,
    )
    mockReadCheckpoint.mockReturnValue(cmpBody('hello'))

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent('/fake/main/sessions/sess-1.checkpoint.cp-a.jsonl', 'change')

    expect(indexed).toHaveLength(1)
    expect(indexed[0].doc.tier).toBe('checkpoint')
    expect(indexed[0].key).toMatch(/^checkpoint:[a-f0-9]{16}$/)
    expect(indexed[0].doc.content).toBe('hello')
  })

  it('routes unlink to remove + forgets the row id', async () => {
    mockMatchCheckpointJsonlPath.mockImplementation((p) =>
      p === '/fake/main/sessions/sess-1.checkpoint.cp-a.jsonl'
        ? { agent: 'main', sessionId: 'sess-1', checkpointId: 'cp-a', filename: 'sess-1.checkpoint.cp-a.jsonl' }
        : null,
    )

    const { ctx, removed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent('/fake/main/sessions/sess-1.checkpoint.cp-a.jsonl', 'unlink')

    expect(removed).toHaveLength(1)
    expect(removed[0]).toMatch(/^checkpoint:[a-f0-9]{16}$/)
  })

  it('ignores non-checkpoint paths (fallthrough to no-op)', async () => {
    mockMatchCheckpointJsonlPath.mockReturnValue(null)
    const { ctx, indexed, removed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent('/fake/random.jsonl', 'change')
    expect(indexed).toHaveLength(0)
    expect(removed).toHaveLength(0)
  })
})

// Keep statSync import referenced in case we later extend to real-file scenarios.
void statSync
// writeFileSync parked for the same reason.
void writeFileSync
