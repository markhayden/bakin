/**
 * Tests for MemoryIndexer.indexTier('daily_note') + handleWatcherEvent
 * routing for OpenClaw daily notes under workspace/memory/*.md.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-indexer-daily-note-${Date.now()}`)

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
  mockListDailyNotes,
  mockReadDailyNote,
  mockDailyNotePath,
  mockMatchDailyNotePath,
} = (() => ({
  mockListAgentIds: mock<() => string[]>(),
  mockListDailyNotes: mock<(agent: string) => string[]>(),
  mockReadDailyNote: mock<(agent: string, filename: string) => string | null>(),
  mockDailyNotePath: mock<(agent: string, filename: string) => string>(),
  mockMatchDailyNotePath: mock<(path: string) => { agent: string; filename: string } | null>(),
}))()

import { MemoryIndexer } from '../../../plugins/memory/lib/indexer'
import { clearAllOffsets } from '../../../plugins/memory/lib/offsets'
import { rowId as dailyNoteRowId } from '../../../plugins/memory/lib/tier-parsers/daily-note-parser'
import type { PluginContext } from '@bakin/core/plugin-types'

interface IndexedDoc { key: string; doc: Record<string, unknown> }

function makeCtx(existingRows: Array<{ key: string; updatedAt: number }> = []): { ctx: PluginContext; indexed: IndexedDoc[]; removed: string[] } {
  const indexed: IndexedDoc[] = []
  const removed: string[] = []
  const maintenanceScan = mock(async function* () {
    for (const row of existingRows) {
      yield { key: row.key, document: { updated_at: row.updatedAt } }
    }
  })
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
        listTiers: mock(async () => [{ id: 'daily-tier', label: 'Daily', metadata: { sourceKind: 'daily_note' } }]),
        listEntries: mock(async (_tierId: string, opts?: { agentId?: string }) =>
          mockListDailyNotes(opts?.agentId ?? '').map((name) => ({
            id: name,
            tierId: 'daily-tier',
            agentId: opts?.agentId,
            path: mockDailyNotePath(opts?.agentId ?? '', name),
            content: '',
          })),
        ),
        getEntry: mock(async (_tierId: string, id: string, opts?: { agentId?: string }) => {
          const agent = opts?.agentId ?? ''
          const content = mockReadDailyNote(agent, id)
          return content === null
            ? null
            : {
                id,
                tierId: 'daily-tier',
                agentId: agent,
                path: mockDailyNotePath(agent, id),
                content,
                metadata: { sourceKind: 'daily_note', filename: id, mtimeMs: 12345, sizeBytes: Buffer.byteLength(content, 'utf-8') },
              }
        }),
        resolvePath: mock(async (path: string) => {
          const match = mockMatchDailyNotePath(path)
          return match
            ? {
                tierId: 'daily-tier',
                id: match.filename,
                agentId: match.agent,
                path,
                metadata: { sourceKind: 'daily_note', filename: match.filename },
              }
            : null
        }),
      },
    },
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
      maintenance: {
        available: mock(async () => existingRows.length > 0),
        scan: maintenanceScan,
        batchRemove: mock(async () => 0),
        resetContentType: mock(async () => {}),
      },
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

  it('is idempotent — re-indexing the same file does not rewrite unchanged rows', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    mockListDailyNotes.mockReturnValue(['2026-04-18.md'])
    mockReadDailyNote.mockReturnValue('body')
    mockDailyNotePath.mockReturnValue(join(testDir, 'x.md'))

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('daily_note')
    await idx.indexTier('daily_note')

    expect(indexed).toHaveLength(1)
    expect(indexed[0].key).toBe(dailyNoteRowId('main', '2026-04-18.md'))
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

  it('skips rows whose indexed updated_at is already current', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    mockListDailyNotes.mockReturnValue(['2026-04-18.md'])
    mockReadDailyNote.mockReturnValue('body')
    mockDailyNotePath.mockReturnValue(join(testDir, 'x.md'))

    const key = dailyNoteRowId('main', '2026-04-18.md')
    const { ctx, indexed } = makeCtx([{ key, updatedAt: Number.MAX_SAFE_INTEGER }])
    const idx = new MemoryIndexer(ctx, {})
    await idx.backfill(['daily_note'])

    expect(ctx.search.maintenance!.scan).toHaveBeenCalledWith({ fields: ['updated_at'] })
    expect(indexed).toHaveLength(0)
  })
})
