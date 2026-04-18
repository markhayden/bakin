/**
 * Tests for MemoryIndexer.indexTier('dream') and watcher routing for dream
 * artifacts (phase docs + `.dreams/` signal files).
 *
 * The adapter exposes:
 *   - listPhaseDocs(agent)          → { phase, filename, path, mtimeMs }[]
 *   - listDreamSignalFiles(agent)   → { relPath, path, mtimeMs }[]   (flat)
 *   - matchPhaseDocPath(path)       → { agent, phase, filename }
 *   - matchDreamSignalPath(path)    → { agent, relPath }
 *
 * The indexer walks both lists on backfill; the watcher routes individual
 * file events to indexPhaseDoc / indexDreamSignal or their remove twins.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-indexer-dream-${Date.now()}`)

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

interface PhaseDocFile {
  agent: string
  phase: string
  filename: string
  path: string
  mtimeMs: number
}

interface DreamSignalFile {
  agent: string
  relPath: string
  path: string
  mtimeMs: number
}

const {
  mockListAgentIds,
  mockListPhaseDocs,
  mockListDreamSignalFiles,
  mockReadPhaseDoc,
  mockReadDreamSignal,
  mockMatchPhaseDocPath,
  mockMatchDreamSignalPath,
} = vi.hoisted(() => ({
  mockListAgentIds: vi.fn<() => string[]>(),
  mockListPhaseDocs: vi.fn<(agent: string) => Array<{
    agent: string; phase: string; filename: string; path: string; mtimeMs: number
  }>>(),
  mockListDreamSignalFiles: vi.fn<(agent: string) => Array<{
    agent: string; relPath: string; path: string; mtimeMs: number
  }>>(),
  mockReadPhaseDoc: vi.fn<(agent: string, phase: string, filename: string) => string | null>(),
  mockReadDreamSignal: vi.fn<(agent: string, relPath: string) => string | null>(),
  mockMatchPhaseDocPath: vi.fn<(path: string) => {
    agent: string; phase: string; filename: string
  } | null>(),
  mockMatchDreamSignalPath: vi.fn<(path: string) => {
    agent: string; relPath: string
  } | null>(),
}))

vi.mock('../../../plugins/memory/lib/openclaw-adapter', () => ({
  listAgentIds: mockListAgentIds,
  // Dream helpers — the new surface this commit adds.
  listPhaseDocs: mockListPhaseDocs,
  listDreamSignalFiles: mockListDreamSignalFiles,
  readPhaseDoc: mockReadPhaseDoc,
  readDreamSignal: mockReadDreamSignal,
  matchPhaseDocPath: mockMatchPhaseDocPath,
  matchDreamSignalPath: mockMatchDreamSignalPath,
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
  listCheckpointJsonlFiles: vi.fn(() => []),
  readCheckpoint: vi.fn(() => null),
  checkpointJsonlPath: vi.fn(() => ''),
  checkpointJsonlStat: vi.fn(() => null),
  matchCheckpointJsonlPath: vi.fn(() => null),
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

function phaseDoc(
  agent: string, phase: string, date: string,
): PhaseDocFile {
  return {
    agent, phase,
    filename: `${date}.md`,
    path: `/fake/${agent}/memory/dreaming/${phase}/${date}.md`,
    mtimeMs: 1_700_000_000_000,
  }
}

function signal(agent: string, relPath: string): DreamSignalFile {
  return {
    agent, relPath,
    path: `/fake/${agent}/memory/.dreams/${relPath}`,
    mtimeMs: 1_700_000_000_000,
  }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mockListAgentIds.mockReset()
  mockListPhaseDocs.mockReset()
  mockListDreamSignalFiles.mockReset()
  mockReadPhaseDoc.mockReset()
  mockReadDreamSignal.mockReset()
  mockMatchPhaseDocPath.mockReset()
  mockMatchDreamSignalPath.mockReset()
  mockMatchPhaseDocPath.mockReturnValue(null)
  mockMatchDreamSignalPath.mockReturnValue(null)
  mockListPhaseDocs.mockReturnValue([])
  mockListDreamSignalFiles.mockReturnValue([])
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('MemoryIndexer.indexTier("dream") — backfill', () => {
  it('walks phase docs + signal files across every agent', async () => {
    mockListAgentIds.mockReturnValue(['main', 'pixel'])
    mockListPhaseDocs.mockImplementation((agent) => {
      if (agent === 'main') return [phaseDoc('main', 'light', '2026-04-17')]
      if (agent === 'pixel') return [phaseDoc('pixel', 'rem', '2026-04-16')]
      return []
    })
    mockListDreamSignalFiles.mockImplementation((agent) => {
      if (agent === 'main') return [signal('main', 'short-term-recall.json')]
      return []
    })
    mockReadPhaseDoc.mockReturnValue('## Notes')
    mockReadDreamSignal.mockReturnValue(JSON.stringify({ recalls: [] }))

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('dream')

    expect(indexed).toHaveLength(3)
    expect(new Set(indexed.map((d) => d.doc.tier))).toEqual(new Set(['dream']))
    const agents = new Set(indexed.map((d) => d.doc.agent))
    expect(agents).toEqual(new Set(['main', 'pixel']))
  })

  it('indexes an empty short-term-recall.json as a dormant row', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    mockListDreamSignalFiles.mockReturnValue([signal('main', 'short-term-recall.json')])
    mockReadDreamSignal.mockReturnValue('')

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('dream')

    expect(indexed).toHaveLength(1)
    const meta = JSON.parse(indexed[0].doc.meta as string) as Record<string, unknown>
    expect(meta.artifactType).toBe('short_term_recall')
    expect(indexed[0].doc.content).toBe('')
  })

  it('skips files the adapter returns as unreadable (null body)', async () => {
    mockListAgentIds.mockReturnValue(['main'])
    mockListPhaseDocs.mockReturnValue([phaseDoc('main', 'light', '2026-04-17')])
    mockListDreamSignalFiles.mockReturnValue([signal('main', 'short-term-recall.json')])
    mockReadPhaseDoc.mockReturnValue(null)
    mockReadDreamSignal.mockReturnValue(null)

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.indexTier('dream')
    expect(indexed).toHaveLength(0)
  })
})

describe('MemoryIndexer.handleWatcherEvent — dream files', () => {
  it('routes add/change on a phase doc path to a single-file index', async () => {
    const p = '/fake/main/memory/dreaming/light/2026-04-17.md'
    mockMatchPhaseDocPath.mockImplementation((x) =>
      x === p ? { agent: 'main', phase: 'light', filename: '2026-04-17.md' } : null,
    )
    mockReadPhaseDoc.mockReturnValue('# Impressions')

    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent(p, 'change')

    expect(indexed).toHaveLength(1)
    expect(indexed[0].doc.tier).toBe('dream')
    expect(indexed[0].key).toMatch(/^dream:[a-f0-9]{16}$/)
  })

  it('routes unlink on a phase doc path to remove', async () => {
    const p = '/fake/main/memory/dreaming/light/2026-04-17.md'
    mockMatchPhaseDocPath.mockImplementation((x) =>
      x === p ? { agent: 'main', phase: 'light', filename: '2026-04-17.md' } : null,
    )
    const { ctx, removed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent(p, 'unlink')
    expect(removed).toHaveLength(1)
    expect(removed[0]).toMatch(/^dream:[a-f0-9]{16}$/)
  })

  it('routes add/change on a signal file to a single-file index', async () => {
    const p = '/fake/main/memory/.dreams/phase-signals.json'
    mockMatchDreamSignalPath.mockImplementation((x) =>
      x === p ? { agent: 'main', relPath: 'phase-signals.json' } : null,
    )
    mockReadDreamSignal.mockReturnValue('{}')
    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent(p, 'change')
    expect(indexed).toHaveLength(1)
    const meta = JSON.parse(indexed[0].doc.meta as string) as Record<string, unknown>
    expect(meta.artifactType).toBe('phase_signals')
  })

  it('routes unlink on a signal file to remove', async () => {
    const p = '/fake/main/memory/.dreams/phase-signals.json'
    mockMatchDreamSignalPath.mockImplementation((x) =>
      x === p ? { agent: 'main', relPath: 'phase-signals.json' } : null,
    )
    const { ctx, removed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent(p, 'unlink')
    expect(removed).toHaveLength(1)
  })

  it('ignores unrelated paths', async () => {
    const { ctx, indexed, removed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.handleWatcherEvent('/fake/unrelated.txt', 'change')
    expect(indexed).toHaveLength(0)
    expect(removed).toHaveLength(0)
  })
})
