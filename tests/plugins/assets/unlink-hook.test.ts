/**
 * Assets plugin — file-backed unlink hook test.
 *
 * Closes issue #73: filesystem-level deletions must remove docs from the
 * adapter-backed bakin_assets index. The plugin migrated to
 * registerFileBackedContentType with `onUnlink` escape hatch.
 *
 * Under filename-as-identity, search keys are filenames (not paths), and
 * the on-disk location is a pure function of the filename
 * (`assets/store/{YYYY-MM}/{filename}`). Retype/relink are metadata-only
 * sidecar edits — the binary never moves — so an unlink on the binary
 * means the asset is truly gone and the search doc must be removed. No
 * "filename still exists elsewhere" guard is needed.
 *
 * Cases under test:
 *   1. Binary delete       → ctx.search.remove(filename) called
 *   2. Sidecar-only delete → not called (binary may still exist)
 *   3. .trash/ delete      → not called (trash events are noise)
 *   4. Variant delete      → not called (variants ride with their primary)
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type {
  PluginContext,
  FileBackedContentTypeDefinition,
} from '@bakin/core/plugin-types'
import { BakinEventBus } from '../../../src/lib/events/event-bus'
import { MarkdownStorageAdapter } from '../../../src/lib/storage/markdown-adapter'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import { createMockBakinTaskStore } from '@bakin/core/tasks/testing'

const testDir = join(tmpdir(), `bakin-test-assets-unlink-${Date.now()}`)
const assetsDir = join(testDir, 'assets')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../../src/core/audit', () => ({
  appendAudit: mock(),
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
    runtime: createMockRuntimeAdapter(),
    tasks: createMockBakinTaskStore() as unknown as PluginContext['tasks'],
    assets: {
      getByFilename: mock(async () => null),
      list: mock(async () => []),
      exists: mock(async () => false),
      fileRef: mock(async (filename: string) => ({ kind: 'asset' as const, filename })),
    },
    registerNav: mock(),
    registerRoute: mock(),
    registerSlot: mock(),
    registerExecTool: mock(),
    registerSkill: mock(),
    registerWorkflow: mock(),
    registerNodeType: mock(() => ''),
    registerNotificationChannel: mock(() => ''),
    registerHealthCheck: mock(() => ''),
    watchFiles: mock(),
    getSettings: (() => ({})) as PluginContext['getSettings'],
    updateSettings: mock(),
    activity: { log: mock(), audit: mock() },
    search: {
      registerContentType: mock(),
      registerFileBackedContentType: mock((def: FileBackedContentTypeDefinition) => {
        capturedDef = def
      }),
      index: mock(async () => {}),
      remove: mock(async (key: string) => { removeCalls.push(key) }),
      transform: mock(async () => {}),
      query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const } })),
    },
    hooks: {
      register: mock(() => () => {}),
      call: mock(async (_name, data) => data),
      callAll: mock(async () => undefined),
      has: mock(() => false),
      invoke: mock(async () => undefined),
    },
  }

  return {
    ctx,
    get capturedDef() { return capturedDef },
    removeCalls,
  } as CapturedCtx
}

/** Seed a canonical asset under assets/store/{YYYY-MM}/ and return its relative path. */
function seedAsset(filename: string, content = 'bytes'): string {
  const ym = `${filename.slice(0, 4)}-${filename.slice(4, 6)}`
  const monthDir = join(assetsDir, 'store', ym)
  mkdirSync(monthDir, { recursive: true })
  writeFileSync(join(monthDir, filename), content)
  return `assets/store/${ym}/${filename}`
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
    const filename = '20260404-photo-a1b2c3d4.png'
    const rel = seedAsset(filename, 'fake png bytes')

    await assetsPlugin.activate(captured.ctx)
    const onUnlink = captured.capturedDef!.onUnlink!

    await onUnlink(rel)

    expect(captured.removeCalls).toEqual([filename])
  })

  it('variant unlink: never calls ctx.search.remove', async () => {
    const captured = makeCtx()
    const filename = '20260404-photo-a1b2c3d4.png'
    const thumb = '20260404-photo-a1b2c3d4.thumb.jpg'
    seedAsset(filename, 'fake png bytes')
    const thumbRel = seedAsset(thumb, 'thumb bytes')

    await assetsPlugin.activate(captured.ctx)
    const onUnlink = captured.capturedDef!.onUnlink!

    await onUnlink(thumbRel)

    expect(captured.removeCalls).toEqual([])
  })

  it('sidecar-only delete: does NOT call ctx.search.remove', async () => {
    const captured = makeCtx()
    const filename = '20260404-photo-a1b2c3d4.png'
    const rel = seedAsset(filename, 'fake png bytes')

    await assetsPlugin.activate(captured.ctx)
    const onUnlink = captured.capturedDef!.onUnlink!

    await onUnlink(`${rel}.meta.json`)

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
