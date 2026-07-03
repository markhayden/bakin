/**
 * Tests for MemoryIndexer.enumerateAll() — the side-effect-free, restartable
 * row enumerator that the blue/green migrator will use as its backfill
 * source (search rebuild plan, task A5).
 *
 * Proves, over a fixture corpus covering audit + durable + daily-note +
 * session + turn tiers:
 *   (a) enumerateAll yields exactly the {key, doc} set the live indexing
 *       path writes via ctx.search.index — same keys, same docs.
 *   (b) calling enumerateAll twice yields identical results (restartable;
 *       each call re-reads sources from byte 0).
 *   (c) enumerateAll never touches persisted state: no offsets.json, no
 *       indexed-cache.json, and zero search-adapter calls.
 *
 * Fixture setup mirrors the per-tier indexer tests (indexer-audit,
 * indexer-turns, indexer-durable, indexer-daily-note, indexer-sessions).
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-indexer-enumerate-${Date.now()}`)

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

import { MemoryIndexer } from '../../../plugins/memory/lib/indexer'
import { clearAllOffsets, getOffsetsFilePath } from '../../../plugins/memory/lib/offsets'
import { getIndexedCacheFilePath } from '../../../plugins/memory/lib/indexed-cache'
import type { PluginContext } from '@bakin/core/plugin-types'

interface IndexedDoc { key: string; doc: Record<string, unknown> }

// Deterministic fixture timestamps — recent enough that no retention window
// or backfill cutoff could ever apply even if defaults change.
const FIXTURE_ISO = '2026-07-01T12:00:00.000Z'
const FIXTURE_MS = Date.parse(FIXTURE_ISO)

const AGENT = 'chef'
const SESSION_ID = 'sess-1'
const SOUL_CONTENT = '# Soul\nsoul body\n'
const DAILY_NOTE_FILE = '2026-06-30.md'
const DAILY_NOTE_CONTENT = 'Cooked three plans, burned one.\n'

function auditEntry(event: string, agent: string, data: Record<string, unknown> = {}): string {
  return JSON.stringify({ ts: FIXTURE_ISO, event, agent, data })
}

function turnLine(id: string, text: string): string {
  return JSON.stringify({
    type: 'message',
    id,
    parentId: null,
    timestamp: FIXTURE_ISO,
    message: { role: 'user', content: [{ type: 'text', text }] },
  })
}

function jsonlPath(): string {
  return join(testDir, `${SESSION_ID}.jsonl`)
}

function writeFixtureCorpus(): void {
  // Audit tier — Bakin-owned audit.jsonl.
  writeFileSync(
    join(testDir, 'audit.jsonl'),
    [
      auditEntry('task.created', AGENT, { id: '1' }),
      auditEntry('task.completed', AGENT, { id: '2' }),
    ].join('\n') + '\n',
  )
  // Turn tier — one session JSONL with a header line + two user messages.
  writeFileSync(
    jsonlPath(),
    [
      JSON.stringify({ type: 'session', version: 3, id: SESSION_ID, timestamp: FIXTURE_ISO }),
      turnLine('u1', 'hello'),
      turnLine('u2', 'world'),
    ].join('\n') + '\n',
  )
}

/**
 * Mock ctx wiring durable + daily-note + session-store + session-jsonl tiers
 * through ctx.runtime.memory, plus a recording ctx.search. Durable and
 * daily-note content is served from constants; session JSONL reads go
 * through the real temp file so byte offsets are exercised for real.
 */
function makeCtx(): { ctx: PluginContext; indexed: IndexedDoc[]; removed: string[]; adapterCalls: { queries: number } } {
  const indexed: IndexedDoc[] = []
  const removed: string[] = []
  const adapterCalls = { queries: 0 }
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
        list: mock(async () => [{ id: AGENT, name: AGENT }]),
      },
      memory: {
        listTiers: mock(async () => [
          { id: 'durable-tier', label: 'Durable', metadata: { sourceKind: 'durable' } },
          { id: 'daily-tier', label: 'Daily notes', metadata: { sourceKind: 'daily_note' } },
          { id: 'sessions-tier', label: 'Sessions', metadata: { sourceKind: 'session_store' } },
          { id: 'turn-tier', label: 'Turns', metadata: { sourceKind: 'session_jsonl' } },
        ]),
        listEntries: mock(async (tierId: string, opts?: { agentId?: string }) => {
          if (opts?.agentId !== AGENT) return []
          if (tierId === 'daily-tier') {
            return [{
              id: DAILY_NOTE_FILE,
              tierId,
              agentId: AGENT,
              path: join(testDir, 'workspaces', AGENT, 'memory', DAILY_NOTE_FILE),
              content: '',
              metadata: { sourceKind: 'daily_note', filename: DAILY_NOTE_FILE, mtimeMs: FIXTURE_MS },
            }]
          }
          if (tierId === 'turn-tier') {
            return [{
              id: SESSION_ID,
              tierId,
              agentId: AGENT,
              path: jsonlPath(),
              content: '',
              metadata: {
                sourceKind: 'session_jsonl',
                sessionId: SESSION_ID,
                isReset: false,
                sizeBytes: statSync(jsonlPath()).size,
                mtimeMs: FIXTURE_MS,
              },
            }]
          }
          return []
        }),
        getEntry: mock(async (tierId: string, id: string, opts?: { agentId?: string }) => {
          if (opts?.agentId !== AGENT) return null
          if (tierId === 'durable-tier') {
            if (id !== 'SOUL.md') return null
            return {
              id,
              tierId,
              agentId: AGENT,
              path: join(testDir, 'workspaces', AGENT, id),
              content: SOUL_CONTENT,
              metadata: { sourceKind: 'durable', basename: id, mtimeMs: FIXTURE_MS },
            }
          }
          if (tierId === 'daily-tier') {
            if (id !== DAILY_NOTE_FILE) return null
            return {
              id,
              tierId,
              agentId: AGENT,
              path: join(testDir, 'workspaces', AGENT, 'memory', id),
              content: DAILY_NOTE_CONTENT,
              metadata: { sourceKind: 'daily_note', filename: id, mtimeMs: FIXTURE_MS },
            }
          }
          if (tierId === 'sessions-tier') {
            if (id !== 'sessions.json') return null
            return {
              id,
              tierId,
              agentId: AGENT,
              path: `/fake/${AGENT}/sessions.json`,
              content: JSON.stringify({
                sessions: {
                  [`agent:${AGENT}:main`]: {
                    sessionId: SESSION_ID,
                    updatedAt: FIXTURE_MS,
                    inputTokens: 10,
                    outputTokens: 5,
                    totalTokens: 15,
                    contextTokens: 100,
                    model: 'claude-opus-4-6',
                    modelProvider: 'anthropic',
                    abortedLastRun: false,
                    origin: null,
                  },
                },
              }),
            }
          }
          return null
        }),
        statEntry: mock(async (tierId: string, id: string, opts?: { agentId?: string }) => {
          if (tierId !== 'turn-tier' || id !== SESSION_ID || opts?.agentId !== AGENT) return null
          const stat = statSync(jsonlPath())
          return { size: stat.size, mtimeMs: stat.mtimeMs }
        }),
        readEntryRange: mock(async (tierId: string, id: string, opts?: { agentId?: string; offset?: number; length?: number }) => {
          if (tierId !== 'turn-tier' || id !== SESSION_ID || opts?.agentId !== AGENT) return null
          const raw = readFileSync(jsonlPath())
          const start = opts?.offset ?? 0
          const end = opts?.length === undefined ? raw.length : Math.min(raw.length, start + opts.length)
          return { content: raw.subarray(start, end).toString('utf-8'), size: raw.length }
        }),
        resolvePath: mock(async () => null),
      },
    },
    search: {
      registerContentType: mock(),
      registerFileBackedContentType: mock(),
      index: mock(async (key: string, doc: Record<string, unknown>) => { indexed.push({ key, doc }) }),
      remove: mock(async (key: string) => { removed.push(key) }),
      transform: mock(async () => {}),
      query: mock(async () => {
        adapterCalls.queries += 1
        return {
          results: [],
          meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const },
        }
      }),
    },
    hooks: {
      register: mock(() => () => {}),
      has: mock(() => false),
      invoke: mock(async () => undefined),
    },
  } as unknown as PluginContext
  return { ctx, indexed, removed, adapterCalls }
}

async function collect(gen: AsyncGenerator<IndexedDoc>): Promise<IndexedDoc[]> {
  const out: IndexedDoc[] = []
  for await (const item of gen) out.push(item)
  return out
}

function byKey(docs: IndexedDoc[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>()
  for (const { key, doc } of docs) map.set(key, doc)
  return map
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  clearAllOffsets()
  writeFixtureCorpus()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('MemoryIndexer.enumerateAll — parity with the live write path', () => {
  it('yields exactly the {key, doc} set the live indexing path writes', async () => {
    // Live path first — it advances offsets and persists state, which must
    // NOT affect the enumerator (it always reads from byte 0).
    const live = makeCtx()
    const liveIdx = new MemoryIndexer(live.ctx, {})
    await liveIdx.backfill(['audit', 'durable', 'daily_note', 'session', 'turn'])

    // Sanity: the corpus covers every requested tier.
    const liveTiers = new Set(live.indexed.map((d) => d.doc.tier))
    expect(liveTiers).toEqual(new Set(['audit', 'durable', 'daily_note', 'session', 'turn']))
    expect(live.indexed.length).toBeGreaterThanOrEqual(6) // 2 audit + 1 durable + 1 note + 1 session + 2 turns

    // Enumerate with a FRESH indexer over an identical ctx — no shared
    // in-memory state with the live run.
    const enumCtx = makeCtx()
    const enumIdx = new MemoryIndexer(enumCtx.ctx, {})
    const enumerated = await collect(enumIdx.enumerateAll())

    const liveMap = byKey(live.indexed)
    const enumMap = byKey(enumerated)
    expect(new Set(enumMap.keys())).toEqual(new Set(liveMap.keys()))
    for (const [key, doc] of liveMap) {
      expect(enumMap.get(key)).toEqual(doc)
    }
    // No duplicate keys from the enumerator either.
    expect(enumerated.length).toBe(live.indexed.length)
  })

  it('yields the full corpus even after the live path advanced offsets on the SAME instance', async () => {
    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.backfill(['audit', 'turn'])
    const liveCount = indexed.length
    expect(liveCount).toBeGreaterThan(0)

    // Offsets now point at EOF for audit.jsonl and the session JSONL; the
    // incremental live path would emit zero rows. The enumerator must not.
    const auditAndTurns = [
      ...await collect(idx.enumerateTier('audit')),
      ...await collect(idx.enumerateTier('turn')),
    ]
    expect(auditAndTurns.length).toBe(liveCount)
  })
})

describe('MemoryIndexer.enumerateAll — restartable', () => {
  it('yields identical results across two consecutive calls', async () => {
    const { ctx } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    const first = await collect(idx.enumerateAll())
    const second = await collect(idx.enumerateAll())
    expect(first.length).toBeGreaterThan(0)
    expect(second).toEqual(first)
  })
})

describe('MemoryIndexer.enumerateAll — side-effect free', () => {
  it('leaves offsets.json and indexed-cache.json untouched and never calls the search adapter', async () => {
    const { ctx, indexed, removed, adapterCalls } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})

    expect(existsSync(getOffsetsFilePath())).toBe(false)
    expect(existsSync(getIndexedCacheFilePath())).toBe(false)

    const enumerated = await collect(idx.enumerateAll())
    expect(enumerated.length).toBeGreaterThan(0)

    // Persisted incremental state: never created.
    expect(existsSync(getOffsetsFilePath())).toBe(false)
    expect(existsSync(getIndexedCacheFilePath())).toBe(false)
    // Search adapter: never touched (no index/remove, not even the count
    // query used by the indexed-cache validation).
    expect(indexed).toHaveLength(0)
    expect(removed).toHaveLength(0)
    expect(adapterCalls.queries).toBe(0)
  })

  it('does not clobber existing offsets written by the live path', async () => {
    const { ctx } = makeCtx()
    const idx = new MemoryIndexer(ctx, {})
    await idx.backfill(['audit', 'turn'])
    const offsetsBefore = readFileSync(getOffsetsFilePath(), 'utf-8')

    await collect(idx.enumerateAll())

    expect(readFileSync(getOffsetsFilePath(), 'utf-8')).toBe(offsetsBefore)
  })
})
