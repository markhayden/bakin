/**
 * End-to-end search ↔ watcher integration test.
 *
 * Validates the FULL pipeline for file-backed core plugins:
 *
 *   plugin.activate(ctx)
 *     → ctx.search.registerFileBackedContentType(def)
 *     → search-registry.buildSearchAPI registers sync/unlink hooks
 *     → chokidar fires add / unlink
 *     → hooks invoke def.onSync / def.onUnlink (or default mapper flow)
 *     → search adapter index/remove calls
 *
 * Chokidar is mocked so we can fire `add` / `unlink` deterministically.
 * SearchAdapter is mocked so we can capture the resulting index/remove calls.
 * Everything else (search-registry, watcher hook plumbing, plugin code)
 * is the real production code path.
 */
import { describe, it, expect, beforeEach, afterEach, mock, type Mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { FSWatcher } from 'chokidar'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import { createMockBakinTaskStore } from '@bakin/core/tasks/testing'
import { clearSearchAdapter, createSearchAdapterHarness, installSearchAdapter } from '../helpers/search-adapter'

const testDir = join(tmpdir(), `bakin-int-search-watcher-${process.pid}-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    workflows: join(testDir, 'workflows'),
    assets: join(testDir, 'assets'),
  }),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    workflows: join(testDir, 'workflows'),
    assets: join(testDir, 'assets'),
  }),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../src/core/sse', () => ({
  broadcast: mock(),
  broadcastAuditEvent: mock(),
}))

mock.module('../../src/core/audit', () => ({
  appendAudit: mock(),
}))

mock.module('@/core/task-store', () => ({}))

const indexCalls: Array<{ table: string; key: string; doc: Record<string, unknown> }> = []
const removeCalls: Array<{ table: string; key: string }> = []
let searchHarness: ReturnType<typeof createSearchAdapterHarness>

mock.module('chokidar', () => ({
  watch: mock().mockReturnValue({
    on: mock().mockReturnThis(),
    close: mock().mockResolvedValue(undefined),
  }),
}))

import { start, stop } from '../../src/core/watcher'
import { buildSearchAPI, resetSearchRegistry } from '../../src/core/search-registry'
import { BakinEventBus } from '../../src/lib/events/event-bus'
import { MarkdownStorageAdapter } from '../../src/lib/storage/markdown-adapter'
import type { PluginContext, BakinPlugin } from '@bakin/core/plugin-types'

import workflowsPlugin from '../../plugins/workflows'
import assetsPlugin from '../../plugins/assets'
import { createConversationTurnService } from '../../src/core/conversation-turns'

interface ChokidarHandlers {
  add: (path: string) => void
  unlink: (path: string) => void
}

async function getChokidarHandlers(): Promise<ChokidarHandlers> {
  const chokidar = await import('chokidar')
  const mockWatcher = vi.mocked(chokidar.watch).mock.results[0].value as FSWatcher
  const onCalls = vi.mocked(mockWatcher.on).mock.calls
  const findHandler = (event: string): ((path: string) => void) => {
    const call = onCalls.find((c: unknown[]) => c[0] === event)
    if (!call) throw new Error(`no ${event} handler registered`)
    return call[1] as (path: string) => void
  }
  return { add: findHandler('add'), unlink: findHandler('unlink') }
}

function makeCtx(plugin: BakinPlugin): PluginContext {
  const storage = new MarkdownStorageAdapter(testDir)
  const events = new BakinEventBus(() => {})
  const search = buildSearchAPI(plugin.id)

  return {
    storage,
    events,
    pluginId: plugin.id,
    runtime: createMockRuntimeAdapter(),
    tasks: createMockBakinTaskStore() as unknown as PluginContext['tasks'],
    conversations: {
      createTurnService: (config) => createConversationTurnService(config as unknown as Parameters<typeof createConversationTurnService>[0]) as unknown as ReturnType<PluginContext['conversations']['createTurnService']>,
    },
    assets: {
      createAsset: mock(async () => ({ assetId: 'test-asset', version: 1 })),
      getAsset: mock(async () => null),
      addVersion: mock(async () => ({ assetId: 'test-asset', version: 2 })),
      addExport: mock(async () => ({ name: 'export', file: 'exports/export.jpg' })),
      resolveVersionFile: mock(async () => null),
      listAssets: mock(async () => []),
      getAssetVersions: mock(async () => null),
      upsertFromSource: mock(async () => ({ assetId: 'test-asset', version: 1, changed: true })),
      resolveStoreFile: mock(async () => null),
    },
    registerNav: mock(),
    registerSlot: mock(),
    registerExecTool: mock(),
    registerSkill: mock(),
    registerWorkflow: mock(),
    registerNodeType: mock(() => ''),
    registerNotificationChannel: mock(() => ''),
    registerHealthCheck: mock(() => ''),
    registerHealthRepairAction: mock(() => ''),
    watchFiles: mock(),
    getSettings: (() => ({})) as PluginContext['getSettings'],
    updateSettings: mock(),
    activity: { log: mock(), audit: mock() },
    log: { debug: mock(), info: mock(), warn: mock(), error: mock() },
    search,
    hooks: {
      register: mock(() => () => {}),
      call: mock(async (_name, data) => data),
      callAll: mock(async () => undefined),
      has: mock(() => false),
      invoke: mock(async () => undefined),
    },
  }
}

async function flushHooks(): Promise<void> {
  // Hooks are fire-and-forget chains kicked off via `.catch(...)` from
  // chokidar handlers. Awaiting a microtask drain lets the chain settle.
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
}

describe('integration: search ↔ watcher sync', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(join(testDir, 'workflows', 'definitions'), { recursive: true })
    mkdirSync(join(testDir, 'workflows', 'instances'), { recursive: true })
    mkdirSync(join(testDir, 'assets', 'images', 'task-1'), { recursive: true })
    indexCalls.length = 0
    removeCalls.length = 0
    resetSearchRegistry()
    searchHarness = createSearchAdapterHarness()
    searchHarness.calls.documentsIndex.mockImplementation(async (table, key, doc) => {
      indexCalls.push({ table, key, doc })
    })
    searchHarness.calls.documentsRemove.mockImplementation(async (table, key) => {
      removeCalls.push({ table, key })
    })
    installSearchAdapter(searchHarness.adapter)
    mock.clearAllMocks()
  })

  afterEach(async () => {
    await stop()
    clearSearchAdapter()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('workflows plugin: definition YAML add/delete flows through search', async () => {
    await workflowsPlugin.activate(makeCtx(workflowsPlugin))
    const eventBus = new BakinEventBus(() => {})
    start({ contentDir: testDir, eventBus, onInboxFile: mock() })
    const handlers = await getChokidarHandlers()

    const defFile = join(testDir, 'workflows', 'definitions', 'sample.yaml')
    writeFileSync(defFile, 'name: Sample\nsteps:\n  - id: one\n    type: agent\n    label: First\n    agent: writer\n    prompt: do it\n')
    handlers.add(defFile)
    await flushHooks()

    const defIndex = indexCalls.find(c => c.table === 'bakin_workflows' && c.key === 'def:sample')
    expect(defIndex).toBeDefined()
    expect(defIndex!.doc.type).toBe('definition')

    handlers.unlink(defFile)
    await flushHooks()

    expect(removeCalls).toContainEqual({ table: 'bakin_workflows', key: 'def:sample' })
  })

  it('workflows plugin: instance JSON add/delete flows through search', async () => {
    await workflowsPlugin.activate(makeCtx(workflowsPlugin))
    const eventBus = new BakinEventBus(() => {})
    start({ contentDir: testDir, eventBus, onInboxFile: mock() })
    const handlers = await getChokidarHandlers()

    const instFile = join(testDir, 'workflows', 'instances', 'task-99.json')
    const instData = {
      taskId: 'task-99',
      workflowId: 'sample',
      status: 'running',
      currentStepIndex: 0,
      stepStates: {},
      updatedAt: '2026-04-12T00:00:00.000Z',
    }
    writeFileSync(instFile, JSON.stringify(instData))
    handlers.add(instFile)
    await flushHooks()

    const instIndex = indexCalls.find(c => c.table === 'bakin_workflows' && c.key === 'inst:task-99')
    expect(instIndex).toBeDefined()
    expect(instIndex!.doc.type).toBe('instance')

    handlers.unlink(instFile)
    await flushHooks()

    expect(removeCalls).toContainEqual({ table: 'bakin_workflows', key: 'inst:task-99' })
  })

  it('assets plugin: manifest delete removes from index, version-file delete does not', async () => {
    await assetsPlugin.activate(makeCtx(assetsPlugin))
    const eventBus = new BakinEventBus(() => {})
    start({ contentDir: testDir, eventBus, onInboxFile: mock() })
    const handlers = await getChokidarHandlers()

    const assetId = '20260412-photo-a1b2c3d4'
    const dir = join(testDir, 'assets', 'store', '2026-04', assetId)
    const versionFile = join(dir, 'v1.png')
    const manifestFile = join(dir, 'manifest.json')
    mkdirSync(dir, { recursive: true })
    writeFileSync(versionFile, 'fake png bytes')
    writeFileSync(manifestFile, JSON.stringify({
      assetId, type: 'images', source: { kind: 'generated', path: null },
      agent: 'tester', taskId: 'task-1', created: '2026-04-12T00:00:00.000Z', updated: '2026-04-12T00:00:00.000Z',
      currentVersion: 1, description: 'integration photo', tags: ['x'],
      versions: [{
        version: 1, file: 'v1.png', thumb: null, mimeType: 'image/png', size: 14,
        width: null, height: null, created: '2026-04-12T00:00:00.000Z', description: 'integration photo', tags: ['x'],
        op: 'generate', parentVersion: null, tool: null, prompt: null, promptHash: null, generation: null,
      }],
      exports: [],
    }))

    // Version-file delete: must NOT remove from search (it rides with the manifest)
    handlers.unlink(versionFile)
    await flushHooks()
    expect(removeCalls.find(c => c.table === 'bakin_assets')).toBeUndefined()

    // Manifest delete: removes the asset row keyed by assetId
    handlers.unlink(manifestFile)
    await flushHooks()
    expect(removeCalls).toContainEqual({
      table: 'bakin_assets',
      key: assetId,
    })
  })

  it('assets plugin: .trash/ deletes are ignored', async () => {
    await assetsPlugin.activate(makeCtx(assetsPlugin))
    const eventBus = new BakinEventBus(() => {})
    start({ contentDir: testDir, eventBus, onInboxFile: mock() })
    const handlers = await getChokidarHandlers()

    mkdirSync(join(testDir, 'assets', '.trash'), { recursive: true })
    const trashFile = join(testDir, 'assets', '.trash', 'gone__deleted-1.png')
    writeFileSync(trashFile, 'bytes')

    handlers.unlink(trashFile)
    await flushHooks()

    expect(removeCalls.find(c => c.table === 'bakin_assets')).toBeUndefined()
  })
})
