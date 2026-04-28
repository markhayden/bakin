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
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-indexer-checkpoint-${Date.now()}`)

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
} = (() => ({
  mockListAgentIds: mock<() => string[]>(),
  mockListCheckpointJsonlFiles: mock<(agent: string) => Array<{
    agent: string
    sessionId: string
    checkpointId: string
    filename: string
    path: string
    size: number
    mtimeMs: number
  }>>(),
  mockReadCheckpoint: mock<(agent: string, filename: string) => string | null>(),
  mockMatchCheckpointJsonlPath: mock<(path: string) => {
    agent: string
    sessionId: string
    checkpointId: string
    filename: string
  } | null>(),
  mockCheckpointJsonlStat: mock<(path: string) => { size: number; mtimeMs: number } | null>(),
}))()

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
        listTiers: mock(async () => [{ id: 'checkpoint-tier', label: 'Checkpoints', metadata: { sourceKind: 'checkpoint' } }]),
        listEntries: mock(async (_tierId: string, opts?: { agentId?: string }) =>
          mockListCheckpointJsonlFiles(opts?.agentId ?? '').map((file) => ({
            id: file.filename,
            tierId: 'checkpoint-tier',
            agentId: file.agent,
            path: file.path,
            content: '',
            metadata: {
              sourceKind: 'checkpoint',
              filename: file.filename,
              sessionId: file.sessionId,
              checkpointId: file.checkpointId,
              sizeBytes: file.size,
              mtimeMs: file.mtimeMs,
            },
          })),
        ),
        getEntry: mock(async (_tierId: string, id: string, opts?: { agentId?: string }) => {
          const body = mockReadCheckpoint(opts?.agentId ?? '', id)
          const stat = mockCheckpointJsonlStat(`/fake/${opts?.agentId ?? 'agent'}/sessions/${id}`)
          return body === null
            ? null
            : {
                id,
                tierId: 'checkpoint-tier',
                agentId: opts?.agentId,
                path: `/fake/${opts?.agentId ?? 'agent'}/sessions/${id}`,
                content: body,
                metadata: stat ? { mtimeMs: stat.mtimeMs, sizeBytes: stat.size } : {},
              }
        }),
        resolvePath: mock(async (path: string) => {
          const match = mockMatchCheckpointJsonlPath(path)
          return match
            ? {
                tierId: 'checkpoint-tier',
                id: match.filename,
                agentId: match.agent,
                path,
                metadata: {
                  sourceKind: 'checkpoint',
                  filename: match.filename,
                  sessionId: match.sessionId,
                  checkpointId: match.checkpointId,
                },
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
    mockReadCheckpoint.mockImplementation(() => cmpBody())

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
