/**
 * Tests for MemoryIndexer.indexTier('audit') + handleWatcherEvent routing
 * for the Bakin audit.jsonl file.
 *
 * Uses real temp files + the real offsets module. Mocks only ctx.search and
 * content-dir so the indexer writes offsets under the temp dir, never
 * ~/.bakin/.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, appendFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-indexer-audit-${Date.now()}`)

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
// Defensive: prevent matchDurablePath (called in handleWatcherEvent routing)
// from touching the real ~/.openclaw/ home during audit-tier tests.
vi.mock('../../../packages/core/src/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, '.openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, '.openclaw', ...parts),
}))
vi.mock('../../../src/core/main-agent', () => ({
  tryGetMainAgentId: () => null,
}))

import { MemoryIndexer } from '../../../plugins/memory/lib/indexer'
import { clearAllOffsets, getOffset } from '../../../plugins/memory/lib/offsets'
import type { PluginContext } from '../../../src/lib/plugin-types'

interface IndexedDoc {
  key: string
  doc: Record<string, unknown>
}

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
      remove: vi.fn(async (key: string) => {
        removed.push(key)
      }),
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

function auditEntry(event: string, agent: string, ts: string, data: Record<string, unknown> = {}) {
  return JSON.stringify({ ts, event, agent, data })
}

function auditPath(): string {
  return join(testDir, 'audit.jsonl')
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  clearAllOffsets()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('MemoryIndexer.indexTier("audit")', () => {
  it('is a no-op when audit.jsonl does not exist', async () => {
    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, { backfillDays: 30 })
    await idx.indexTier('audit')
    expect(indexed).toHaveLength(0)
  })

  it('indexes every line in a fresh audit.jsonl', async () => {
    const { ctx, indexed } = makeCtx()
    writeFileSync(
      auditPath(),
      [
        auditEntry('task.created', 'patch', '2026-04-18T12:00:00.000Z', { id: '1' }),
        auditEntry('task.completed', 'scout', '2026-04-18T12:00:01.000Z', { id: '2' }),
        auditEntry('task.blocked', 'basil', '2026-04-18T12:00:02.000Z', { id: '3' }),
      ].join('\n') + '\n',
    )
    const idx = new MemoryIndexer(ctx, { backfillDays: 30 })
    await idx.indexTier('audit')
    expect(indexed).toHaveLength(3)
    expect(indexed[0].doc.tier).toBe('audit')
    expect(indexed[0].doc.agent).toBe('patch')
    expect(indexed[0].doc.title).toBe('task.created')
  })

  it('writes the file offset after indexing so a replay skips seen lines', async () => {
    const { ctx } = makeCtx()
    const content =
      auditEntry('a', 'patch', '2026-04-18T12:00:00.000Z') +
      '\n' +
      auditEntry('b', 'scout', '2026-04-18T12:00:01.000Z') +
      '\n'
    writeFileSync(auditPath(), content)
    const idx = new MemoryIndexer(ctx, { backfillDays: 30 })
    await idx.indexTier('audit')
    expect(getOffset(auditPath())).toBe(Buffer.byteLength(content, 'utf-8'))
  })

  it('is idempotent — re-indexing the same file produces no new index calls', async () => {
    const { ctx, indexed } = makeCtx()
    writeFileSync(
      auditPath(),
      auditEntry('x', 'patch', '2026-04-18T12:00:00.000Z') + '\n',
    )
    const idx = new MemoryIndexer(ctx, { backfillDays: 30 })
    await idx.indexTier('audit')
    await idx.indexTier('audit')
    expect(indexed).toHaveLength(1)
  })

  it('skips malformed lines without aborting the rest', async () => {
    const { ctx, indexed } = makeCtx()
    writeFileSync(
      auditPath(),
      [
        auditEntry('ok', 'patch', '2026-04-18T12:00:00.000Z'),
        '{ this is garbage',
        '',
        auditEntry('also-ok', 'scout', '2026-04-18T12:00:02.000Z'),
      ].join('\n') + '\n',
    )
    const idx = new MemoryIndexer(ctx, { backfillDays: 30 })
    await idx.indexTier('audit')
    const titles = indexed.map((d) => d.doc.title)
    expect(titles).toEqual(['ok', 'also-ok'])
  })

  it('handles file truncation by restarting from offset 0', async () => {
    const { ctx, indexed } = makeCtx()
    // Start with three long entries, index them.
    writeFileSync(
      auditPath(),
      [
        auditEntry('initial-1', 'patch', '2026-04-18T12:00:00.000Z', { padding: 'x'.repeat(200) }),
        auditEntry('initial-2', 'patch', '2026-04-18T12:00:01.000Z', { padding: 'x'.repeat(200) }),
        auditEntry('initial-3', 'patch', '2026-04-18T12:00:02.000Z', { padding: 'x'.repeat(200) }),
      ].join('\n') + '\n',
    )
    const idx = new MemoryIndexer(ctx, { backfillDays: 30 })
    await idx.indexTier('audit')
    expect(indexed).toHaveLength(3)

    // Truncate the file to a single short line — stats.size < previous offset.
    writeFileSync(
      auditPath(),
      auditEntry('restarted', 'scout', '2026-04-18T12:01:00.000Z') + '\n',
    )
    await idx.indexTier('audit')
    expect(indexed).toHaveLength(4)
    expect(indexed[3].doc.title).toBe('restarted')
  })
})

describe('MemoryIndexer.handleWatcherEvent routing', () => {
  it('routes audit.jsonl change events into the audit indexer', async () => {
    const { ctx, indexed } = makeCtx()
    writeFileSync(
      auditPath(),
      auditEntry('first', 'patch', '2026-04-18T12:00:00.000Z') + '\n',
    )
    const idx = new MemoryIndexer(ctx, { backfillDays: 30 })
    await idx.handleWatcherEvent(auditPath(), 'add')
    expect(indexed).toHaveLength(1)

    appendFileSync(
      auditPath(),
      auditEntry('second', 'scout', '2026-04-18T12:00:01.000Z') + '\n',
    )
    await idx.handleWatcherEvent(auditPath(), 'change')
    expect(indexed).toHaveLength(2)
    expect(indexed[1].doc.title).toBe('second')
  })

  it('only indexes the newly appended lines, not the full file', async () => {
    const { ctx, indexed } = makeCtx()
    writeFileSync(
      auditPath(),
      [
        auditEntry('a', 'patch', '2026-04-18T12:00:00.000Z'),
        auditEntry('b', 'patch', '2026-04-18T12:00:01.000Z'),
        auditEntry('c', 'patch', '2026-04-18T12:00:02.000Z'),
      ].join('\n') + '\n',
    )
    const idx = new MemoryIndexer(ctx, { backfillDays: 30 })
    await idx.handleWatcherEvent(auditPath(), 'change')
    expect(indexed).toHaveLength(3)

    appendFileSync(
      auditPath(),
      [
        auditEntry('d', 'patch', '2026-04-18T12:00:03.000Z'),
        auditEntry('e', 'patch', '2026-04-18T12:00:04.000Z'),
      ].join('\n') + '\n',
    )
    await idx.handleWatcherEvent(auditPath(), 'change')
    // Only the two new lines land as new index calls.
    expect(indexed).toHaveLength(5)
    expect(indexed.slice(3).map((d) => d.doc.title)).toEqual(['d', 'e'])
  })

  it('ignores watcher events for paths outside the audit log in C3 scope', async () => {
    const { ctx, indexed } = makeCtx()
    const idx = new MemoryIndexer(ctx, { backfillDays: 30 })
    await idx.handleWatcherEvent(join(testDir, 'something-else.jsonl'), 'change')
    expect(indexed).toHaveLength(0)
  })

  it('creates the offsets file under ~/.bakin/plugin-settings/memory/', async () => {
    const { ctx } = makeCtx()
    writeFileSync(
      auditPath(),
      auditEntry('x', 'patch', '2026-04-18T12:00:00.000Z') + '\n',
    )
    const idx = new MemoryIndexer(ctx, { backfillDays: 30 })
    await idx.handleWatcherEvent(auditPath(), 'change')
    expect(existsSync(join(testDir, 'plugin-settings', 'memory', 'offsets.json'))).toBe(true)
  })
})

describe('MemoryIndexer.backfill("audit")', () => {
  it('falls into the audit indexer when the tier is requested', async () => {
    const { ctx, indexed } = makeCtx()
    writeFileSync(
      auditPath(),
      auditEntry('bootstrap', 'patch', '2026-04-18T12:00:00.000Z') + '\n',
    )
    const idx = new MemoryIndexer(ctx, { backfillDays: 30 })
    await idx.backfill(['audit'])
    expect(indexed).toHaveLength(1)
    expect(indexed[0].doc.title).toBe('bootstrap')
  })
})
