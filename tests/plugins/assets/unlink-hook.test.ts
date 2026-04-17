/**
 * Assets plugin — file-backed unlink hook test.
 *
 * Closes issue #73: filesystem-level deletions must remove docs from the
 * Antfly bakin_assets index. The plugin migrated to
 * registerFileBackedContentType with `onUnlink` escape hatch.
 *
 * Under filename-as-identity, search keys are filenames (not paths). The
 * unlink hook only removes the search doc when the filename is truly gone
 * from disk — i.e. when the resolver has no remaining entry for it. This
 * keeps retype/relink watcher events from wiping docs whose files just
 * moved.
 *
 * Cases under test:
 *   1. Binary delete       → ctx.search.remove(filename) called
 *   2. Sidecar-only delete → not called (binary may still exist)
 *   3. .trash/ delete      → not called (trash events are noise)
 *   4. Filename still exists elsewhere → not called (retype/relink case)
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type {
  PluginContext,
  FileBackedContentTypeDefinition,
} from '../../../src/lib/plugin-types'
import { BakinEventBus } from '../../../src/lib/events/event-bus'
import { MarkdownStorageAdapter } from '../../../src/lib/storage/markdown-adapter'

const testDir = join(tmpdir(), `bakin-test-assets-unlink-${Date.now()}`)
const assetsDir = join(testDir, 'assets')

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: vi.fn(),
  initBakinHome: vi.fn(),
  isUsingBakinHome: () => false,
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

import assetsPlugin from '../../../plugins/assets'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

interface CapturedCtx {
  ctx: PluginContext
  capturedDef: FileBackedContentTypeDefinition | null
  removeCalls: string[]
}

function makeCtx(): CapturedCtx {
  mkdirSync(assetsDir, { recursive: true })

  const removeCalls: string[] = []
  let capturedDef: FileBackedContentTypeDefinition | null = null

  const storage = new MarkdownStorageAdapter(testDir)
  const events = new BakinEventBus(() => {})

  const ctx: PluginContext = {
    storage,
    events,
    pluginId: 'assets',
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
      registerFileBackedContentType: vi.fn((def: FileBackedContentTypeDefinition) => {
        capturedDef = def
      }),
      index: vi.fn(async () => {}),
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
    get capturedDef() { return capturedDef },
    removeCalls,
  } as CapturedCtx
}

describe('assets plugin — file-backed unlink hook', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(assetsDir, { recursive: true })
  })

  it('registers an onUnlink handler with excludePatterns for trash', async () => {
    const captured = makeCtx()
    await assetsPlugin.activate(captured.ctx)
    expect(captured.capturedDef).not.toBeNull()
    expect(typeof captured.capturedDef!.onUnlink).toBe('function')
    expect(captured.capturedDef!.excludePatterns).toContain('assets/**/.trash/**')
  })

  it('binary delete: calls ctx.search.remove with the filename', async () => {
    const captured = makeCtx()
    // Seed the asset on disk so upsertAsset / removeAsset see real state
    const subdir = join(assetsDir, 'images', 'task-1')
    mkdirSync(subdir, { recursive: true })
    writeFileSync(join(subdir, 'photo.png'), 'fake png bytes')

    await assetsPlugin.activate(captured.ctx)
    const onUnlink = captured.capturedDef!.onUnlink!

    await onUnlink('assets/images/task-1/photo.png')

    expect(captured.removeCalls).toEqual(['photo.png'])
  })

  it('filename still exists elsewhere: skips ctx.search.remove', async () => {
    const captured = makeCtx()
    // Seed the same filename in two different task dirs (simulating the
    // window during a retype: old location still on disk, new location
    // already written).
    const oldDir = join(assetsDir, 'text', 'task-1')
    const newDir = join(assetsDir, 'research', 'task-1')
    mkdirSync(oldDir, { recursive: true })
    mkdirSync(newDir, { recursive: true })
    writeFileSync(join(oldDir, 'notes-abcdef12.md'), 'old')
    writeFileSync(join(newDir, 'notes-abcdef12.md'), 'new')

    await assetsPlugin.activate(captured.ctx)
    const onUnlink = captured.capturedDef!.onUnlink!

    // Unlink fires for the old location, but the filename still maps
    // (via the collision alternate or primary) to the new location.
    await onUnlink('assets/text/task-1/notes-abcdef12.md')

    expect(captured.removeCalls).toEqual([])
  })

  it('variant unlink: never calls ctx.search.remove', async () => {
    const captured = makeCtx()
    const subdir = join(assetsDir, 'images', 'task-1')
    mkdirSync(subdir, { recursive: true })
    writeFileSync(join(subdir, 'photo.png'), 'fake png bytes')
    writeFileSync(join(subdir, 'photo.thumb.jpg'), 'thumb bytes')

    await assetsPlugin.activate(captured.ctx)
    const onUnlink = captured.capturedDef!.onUnlink!

    await onUnlink('assets/images/task-1/photo.thumb.jpg')

    expect(captured.removeCalls).toEqual([])
  })

  it('sidecar-only delete: does NOT call ctx.search.remove', async () => {
    const captured = makeCtx()
    const subdir = join(assetsDir, 'images', 'task-1')
    mkdirSync(subdir, { recursive: true })
    writeFileSync(join(subdir, 'photo.png'), 'fake png bytes')

    await assetsPlugin.activate(captured.ctx)
    const onUnlink = captured.capturedDef!.onUnlink!

    await onUnlink('assets/images/task-1/photo.png.meta.json')

    expect(captured.removeCalls).toEqual([])
  })

  it('.trash/ delete: does NOT call ctx.search.remove', async () => {
    const captured = makeCtx()
    await assetsPlugin.activate(captured.ctx)
    const onUnlink = captured.capturedDef!.onUnlink!

    await onUnlink('assets/.trash/old-image__deleted-1234567890.png')

    expect(captured.removeCalls).toEqual([])
  })

  it('non-assets path: ignored entirely', async () => {
    const captured = makeCtx()
    await assetsPlugin.activate(captured.ctx)
    const onUnlink = captured.capturedDef!.onUnlink!

    await onUnlink('projects/something.md')

    expect(captured.removeCalls).toEqual([])
  })
})
