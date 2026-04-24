/**
 * Tests for MemoryIndexer.indexTier('durable') + handleWatcherEvent routing
 * for OpenClaw workspace canonical bootstrap files.
 *
 * The indexer's input for this tier is (a) listAgentIds() from the
 * openclaw-adapter, (b) CANONICAL_DURABLE_FILES, and (c) readDurableFile
 * + the file's mtime. All three are mocked here — no real filesystem reads
 * under ~/.openclaw/.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-indexer-durable-${Date.now()}`)

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

// Mock the openclaw-adapter.
const {
  mockListAgentIds,
  mockReadDurableFile,
  mockDurableFilePath,
  mockMatchDurablePath,
  mockCanonicalFiles,
} = (() => ({
  mockListAgentIds: mock<() => string[]>(),
  mockReadDurableFile: mock<(agent: string, basename: string) => string | null>(),
  mockDurableFilePath: mock<(agent: string, basename: string) => string>(),
  mockMatchDurablePath: mock<(path: string) => { agent: string; basename: string } | null>(),
  mockCanonicalFiles: ['SOUL.md', 'MEMORY.md'] as const,
}))()

mock.module('../../../plugins/memory/lib/openclaw-adapter', () => ({
  listAgentIds: mockListAgentIds,
  readDurableFile: mockReadDurableFile,
  durableFilePath: mockDurableFilePath,
  matchDurablePath: mockMatchDurablePath,
  CANONICAL_DURABLE_FILES: mockCanonicalFiles,
  DURABLE_KIND_BY_BASENAME: { 'SOUL.md': 'soul', 'MEMORY.md': 'memory' },
  durableKindForBasename: (basename: string) =>
    ({ 'SOUL.md': 'soul', 'MEMORY.md': 'memory' } as Record<string, string>)[basename],
  // Skills (tier=durable, kind=skill) — stubbed so the durable indexer pass
  // doesn't try to walk a real skills/ directory during this test.
  listAgentSkills: mock(() => []),
  readAgentSkill: mock(() => null),
  skillFilePath: mock(() => ''),
  skillFileMtime: mock(() => null),
  matchSkillPath: mock(() => null),
  // daily-note tier (C5) — stubbed so handleWatcherEvent's fallthrough match
  // doesn't blow up in this tier's isolated tests.
  listDailyNotes: mock(() => []),
  readDailyNote: mock(() => null),
  dailyNotePath: mock(() => ''),
  dailyNoteMtime: mock(() => null),
  dailyNoteSize: mock(() => 0),
  matchDailyNotePath: mock(() => null),
  // session + turn tiers (C6) — same rationale.
  readSessionStore: mock(() => null),
  sessionStorePath: mock(() => ''),
  matchSessionStorePath: mock(() => null),
  listSessionJsonlFiles: mock(() => []),
  sessionJsonlPath: mock(() => ''),
  sessionJsonlStat: mock(() => null),
  matchSessionJsonlPath: mock(() => null),
  // checkpoint tier (C7) — same rationale.
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
}))

mock.module('../../../plugins/memory/lib/openclaw-gateway', () => ({
  gatewayCall: mock(() => Promise.reject(new Error('gateway unused'))),
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
      remove: mock(async (key: string) => {
        removed.push(key)
      }),
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

function writeFixture(agent: string, basename: string, body: string, mtimeMs?: number): string {
  const agentDir = join(testDir, 'workspaces', agent)
  mkdirSync(agentDir, { recursive: true })
  const file = join(agentDir, basename)
  writeFileSync(file, body)
  if (mtimeMs !== undefined) {
    const sec = mtimeMs / 1000
    utimesSync(file, sec, sec)
  }
  return file
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  clearAllOffsets()
  mockListAgentIds.mockReset()
  mockReadDurableFile.mockReset()
  mockDurableFilePath.mockReset()
  mockMatchDurablePath.mockReset()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('MemoryIndexer.indexTier("durable")', () => {
  it('is a no-op when no agents exist', async () => {
    mockListAgentIds.mockReturnValue([])
    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('durable')
    expect(indexed).toHaveLength(0)
  })

  it('iterates each agent × each canonical file that exists', async () => {
    mockListAgentIds.mockReturnValue(['main', 'scout'])
    const mainFile = writeFixture('main', 'SOUL.md', '# hello\nbody')
    const scoutFile = writeFixture('scout', 'MEMORY.md', '# notes\nbody')
    mockReadDurableFile.mockImplementation((agent, basename) => {
      if (agent === 'main' && basename === 'SOUL.md') return '# hello\nbody'
      if (agent === 'scout' && basename === 'MEMORY.md') return '# notes\nbody'
      return null
    })
    mockDurableFilePath.mockImplementation((agent, basename) => {
      if (agent === 'main' && basename === 'SOUL.md') return mainFile
      if (agent === 'scout' && basename === 'MEMORY.md') return scoutFile
      return ''
    })

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('durable')

    // 1 chunk per file × 2 files = 2 rows.
    expect(indexed).toHaveLength(2)
    const agents = indexed.map((d) => d.doc.agent).sort()
    expect(agents).toEqual(['main', 'scout'])
  })

  it('produces multiple rows per file when it has H1 boundaries', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    const file = writeFixture('main', 'SOUL.md', '# A\nbodyA\n# B\nbodyB\n# C\nbodyC\n')
    mockReadDurableFile.mockImplementation((a, b) =>
      a === 'main' && b === 'SOUL.md' ? '# A\nbodyA\n# B\nbodyB\n# C\nbodyC\n' : null,
    )
    mockDurableFilePath.mockReturnValue(file)

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('durable')

    expect(indexed).toHaveLength(3)
    expect(indexed.map((d) => d.doc.title)).toEqual(['A', 'B', 'C'])
    for (const d of indexed) expect(d.doc.tier).toBe('durable')
  })

  it('is idempotent — re-indexing the same file produces the same row ids', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    const file = writeFixture('main', 'SOUL.md', '# hello\nbody')
    mockReadDurableFile.mockImplementation((a, b) =>
      a === 'main' && b === 'SOUL.md' ? '# hello\nbody' : null,
    )
    mockDurableFilePath.mockReturnValue(file)

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('durable')
    await idx.indexTier('durable')

    // Both passes emit the same key — downstream Antfly upsert dedupes.
    const uniq = new Set(indexed.map((d) => d.key))
    expect(uniq.size).toBe(1)
    expect(indexed).toHaveLength(2)
  })

  it('skips agent/file combinations the adapter reports as missing', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    mockReadDurableFile.mockReturnValue(null) // nothing present
    mockDurableFilePath.mockReturnValue('')

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('durable')
    expect(indexed).toHaveLength(0)
  })
})

describe('MemoryIndexer.handleWatcherEvent routing (durable)', () => {
  it('routes a canonical workspace/*.md add event into the durable indexer', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    const file = writeFixture('main', 'SOUL.md', '# hello\nbody')
    mockReadDurableFile.mockReturnValue('# hello\nbody')
    mockDurableFilePath.mockReturnValue(file)
    mockMatchDurablePath.mockImplementation((p) =>
      p === file ? { agent: 'main', basename: 'SOUL.md' } : null,
    )

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent(file, 'change')
    expect(indexed).toHaveLength(1)
    expect(indexed[0].doc.tier).toBe('durable')
    expect(indexed[0].doc.agent).toBe('main')
  })

  it('ignores non-canonical markdown files in a workspace', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    const file = writeFixture('main', 'RANDOM.md', 'noise')
    mockReadDurableFile.mockReturnValue(null)
    mockDurableFilePath.mockReturnValue(file)
    mockMatchDurablePath.mockReturnValue(null)

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent(file, 'change')
    expect(indexed).toHaveLength(0)
  })

  it('removes all chunks of a durable file on unlink', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    const file = writeFixture('main', 'SOUL.md', '# A\nbodyA\n# B\nbodyB\n')
    mockReadDurableFile.mockReturnValue('# A\nbodyA\n# B\nbodyB\n')
    mockDurableFilePath.mockReturnValue(file)
    mockMatchDurablePath.mockImplementation((p) =>
      p === file ? { agent: 'main', basename: 'SOUL.md' } : null,
    )

    const { ctx, indexed, removed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent(file, 'change')
    expect(indexed).toHaveLength(2)

    await idx.handleWatcherEvent(file, 'unlink')
    // Both chunk keys removed.
    expect(new Set(removed)).toEqual(new Set(indexed.map((d) => d.key)))
  })
})

describe('MemoryIndexer.backfill(["durable"])', () => {
  it('falls through to indexTier("durable") when the tier is requested', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    const file = writeFixture('main', 'SOUL.md', '# hello\nbody')
    mockReadDurableFile.mockImplementation((agent, basename) =>
      agent === 'main' && basename === 'SOUL.md' ? '# hello\nbody' : null,
    )
    mockDurableFilePath.mockReturnValue(file)

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.backfill(['durable'])
    expect(indexed).toHaveLength(1)
    expect(indexed[0].doc.tier).toBe('durable')
  })
})
