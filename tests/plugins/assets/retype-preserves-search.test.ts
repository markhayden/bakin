/**
 * Retype/relink preserve search index under filename-as-identity.
 *
 * The key invariant:
 *   retyping or relinking an asset MUST NOT leave the search index empty
 *   for that filename, even momentarily. The search doc key is the
 *   filename, which is stable across both operations — so the mutation
 *   is an upsert, not a remove-then-reindex.
 *
 * Watcher unlink events for the old path are tolerated by the onUnlink
 * hook: if the filename still exists in the resolver (at the new path),
 * the hook skips `search.remove`. Covered in unlink-hook.test.ts.
 *
 * This suite focuses on the retype/relink handlers themselves: they
 * should NOT call `search.remove(oldPath)` because the key didn't change.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { PluginContext, FileBackedContentTypeDefinition, APIRoute } from '../../../src/lib/plugin-types'
import { BakinEventBus } from '../../../src/lib/events/event-bus'
import { MarkdownStorageAdapter } from '../../../src/lib/storage/markdown-adapter'

const testDir = join(tmpdir(), `bakin-test-retype-preserves-${Date.now()}`)
const assetsDir = join(testDir, 'assets')

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ assets: join(testDir, 'assets') }),
  resetContentDir: vi.fn(),
  initBakinHome: vi.fn(),
  isUsingBakinHome: () => false,
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}))

vi.mock('../../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

vi.mock('../../../src/core/watcher', () => ({
  watchFiles: vi.fn(() => ({ close: vi.fn() })),
}))

import assetsPlugin from '../../../plugins/assets'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

interface HandlerMap {
  [method: string]: { [path: string]: APIRoute['handler'] }
}

interface Captured {
  ctx: PluginContext
  handlers: HandlerMap
  capturedDef: FileBackedContentTypeDefinition | null
  indexCalls: Array<{ key: string; doc: Record<string, unknown> }>
  removeCalls: string[]
}

function makeCtx(): Captured {
  mkdirSync(assetsDir, { recursive: true })

  const indexCalls: Array<{ key: string; doc: Record<string, unknown> }> = []
  const removeCalls: string[] = []
  let capturedDef: FileBackedContentTypeDefinition | null = null
  const handlers: HandlerMap = {}

  const storage = new MarkdownStorageAdapter(testDir)
  const events = new BakinEventBus(() => {})

  const ctx: PluginContext = {
    storage,
    events,
    pluginId: 'assets',
    registerNav: vi.fn(),
    registerRoute: vi.fn((def: APIRoute) => {
      handlers[def.method] ??= {}
      handlers[def.method][def.path] = def.handler
    }),
    registerSlot: vi.fn(),
    registerExecTool: vi.fn(),
    registerSkill: vi.fn(),
    watchFiles: vi.fn(),
    getSettings: (() => ({})) as PluginContext['getSettings'],
    updateSettings: vi.fn(),
    activity: { log: vi.fn(), audit: vi.fn() },
    search: {
      registerContentType: vi.fn(),
      registerFileBackedContentType: vi.fn((def: FileBackedContentTypeDefinition) => {
        capturedDef = def
      }),
      index: vi.fn(async (key: string, doc: Record<string, unknown>) => {
        indexCalls.push({ key, doc })
      }),
      remove: vi.fn(async (key: string) => { removeCalls.push(key) }),
      transform: vi.fn(async () => {}),
      query: vi.fn(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const } })),
    },
    hooks: {
      register: vi.fn(() => () => {}),
      has: vi.fn(() => false),
      invoke: vi.fn(async () => undefined),
    },
  }

  return {
    ctx,
    handlers,
    get capturedDef() { return capturedDef },
    indexCalls,
    removeCalls,
  } as Captured
}

function seedAsset(type: string, taskId: string, filename: string, contents = 'bytes'): string {
  const dir = join(assetsDir, type, taskId)
  mkdirSync(dir, { recursive: true })
  const full = join(dir, filename)
  writeFileSync(full, contents)
  const sidecar = {
    filename,
    taskId,
    agent: 'test',
    created: new Date().toISOString(),
    description: 'seed',
    tags: [],
    tool: 'vitest',
  }
  writeFileSync(full + '.meta.json', JSON.stringify(sidecar, null, 2))
  return `assets/${type}/${taskId}/${filename}`
}

describe('retype handler preserves search index', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(assetsDir, { recursive: true })
  })

  it('retype upserts under the filename key without removing first', async () => {
    const captured = makeCtx()
    seedAsset('text', 'task-1', 'notes-abcdef12.md', '# notes')

    await assetsPlugin.activate(captured.ctx)
    captured.indexCalls.length = 0
    captured.removeCalls.length = 0

    const handler = captured.handlers['PATCH']['/retype']
    const res = await handler(new Request('http://localhost/api/plugins/assets/retype', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets/text/task-1/notes-abcdef12.md', type: 'research' }),
    }), captured.ctx)

    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.newPath).toBe('assets/research/task-1/notes-abcdef12.md')

    // Give the best-effort reindex a tick to settle.
    await new Promise(r => setTimeout(r, 10))

    // The filename-keyed upsert must have fired, with updated asset_type.
    const reindexed = captured.indexCalls.find(c => c.key === 'notes-abcdef12.md')
    expect(reindexed, 'expected index upsert under filename key').toBeTruthy()
    expect(reindexed!.doc.asset_type).toBe('research')

    // CRITICAL: no remove call for old path or filename — the key is stable.
    expect(captured.removeCalls).toEqual([])
  })
})

describe('relink handler preserves search index', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(assetsDir, { recursive: true })
  })

  it('relink upserts under the filename key without removing first', async () => {
    const captured = makeCtx()
    seedAsset('images', 'task-1', 'hero-12345678.png', 'png-bytes')

    await assetsPlugin.activate(captured.ctx)
    captured.indexCalls.length = 0
    captured.removeCalls.length = 0

    const handler = captured.handlers['PATCH']['/link']
    const res = await handler(new Request('http://localhost/api/plugins/assets/link', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets/images/task-1/hero-12345678.png', taskId: 'task-2' }),
    }), captured.ctx)

    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.newPath).toBe('assets/images/task-2/hero-12345678.png')

    await new Promise(r => setTimeout(r, 50))

    const reindexed = captured.indexCalls.find(c => c.key === 'hero-12345678.png')
    expect(reindexed, 'expected index upsert under filename key').toBeTruthy()
    expect(reindexed!.doc.task_id).toBe('task-2')

    expect(captured.removeCalls).toEqual([])
  })
})
