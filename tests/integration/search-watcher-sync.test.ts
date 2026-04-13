/**
 * End-to-end search ↔ watcher integration test.
 *
 * Validates the FULL pipeline for all three migrated plugins:
 *
 *   plugin.activate(ctx)
 *     → ctx.search.registerFileBackedContentType(def)
 *     → search-registry.buildSearchAPI registers sync/unlink hooks
 *     → chokidar fires add / unlink
 *     → hooks invoke def.onSync / def.onUnlink (or default mapper flow)
 *     → antfly.indexDocument / removeDocument
 *
 * Chokidar is mocked so we can fire `add` / `unlink` deterministically.
 * Antfly is mocked so we can capture the resulting index/remove calls.
 * Everything else (search-registry, watcher hook plumbing, plugin code)
 * is the real production code path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { FSWatcher } from 'chokidar'

const testDir = join(tmpdir(), `bakin-int-search-watcher-${process.pid}-${Date.now()}`)

vi.mock('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    projects: join(testDir, 'projects'),
    workflows: join(testDir, 'workflows'),
    assets: join(testDir, 'assets'),
  }),
  resetContentDir: vi.fn(),
  initBakinHome: vi.fn(),
  isUsingBakinHome: () => false,
}))

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../src/core/sse', () => ({
  broadcast: vi.fn(),
  broadcastAuditEvent: vi.fn(),
}))

vi.mock('../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

vi.mock('../../src/core/discord-gateway', () => ({
  startGateway: vi.fn(),
  stopGateway: vi.fn(),
  onGateInteraction: vi.fn(),
  isGatewayConnected: vi.fn(() => false),
}))

vi.mock('../../scripts/lib/post-discord', () => ({
  loadDiscordConfig: vi.fn(() => null),
}))

const indexCalls: Array<{ table: string; key: string; doc: Record<string, unknown> }> = []
const removeCalls: Array<{ table: string; key: string }> = []

vi.mock('../../src/core/antfly', () => ({
  enabled: () => true,
  indexDocument: vi.fn(async (table: string, key: string, doc: Record<string, unknown>) => {
    indexCalls.push({ table, key, doc })
  }),
  removeDocument: vi.fn(async (table: string, key: string) => {
    removeCalls.push({ table, key })
  }),
  getClient: vi.fn(() => null),
  createTable: vi.fn(async () => {}),
  scanTable: vi.fn(async () => []),
  searchTable: vi.fn(async () => ({ hits: { hits: [], total: 0 }, took: 0 })),
  deleteTable: vi.fn(async () => {}),
  getIndexHealth: vi.fn(async () => ({ ready: 0, total: 0, queued: 0 })),
}))

vi.mock('chokidar', () => ({
  watch: vi.fn().mockReturnValue({
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}))

import { start, stop } from '../../src/core/watcher'
import { buildSearchAPI, resetSearchRegistry } from '../../src/core/search-registry'
import { BakinEventBus } from '../../src/lib/events/event-bus'
import { MarkdownStorageAdapter } from '../../src/lib/storage/markdown-adapter'
import type { PluginContext, BakinPlugin } from '../../src/lib/plugin-types'

import projectsPlugin from '../../plugins/projects'
import workflowsPlugin from '../../plugins/workflows'
import assetsPlugin from '../../plugins/assets'

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
    registerNav: vi.fn(),
    registerRoute: vi.fn(),
    registerSlot: vi.fn(),
    registerExecTool: vi.fn(),
    registerSkill: vi.fn(),
    watchFiles: vi.fn(),
    getSettings: (() => ({})) as PluginContext['getSettings'],
    updateSettings: vi.fn(),
    activity: { log: vi.fn(), audit: vi.fn() },
    search,
    hooks: {
      register: vi.fn(() => () => {}),
      has: vi.fn(() => false),
      invoke: vi.fn(async () => undefined),
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
    mkdirSync(join(testDir, 'projects'), { recursive: true })
    mkdirSync(join(testDir, 'workflows', 'definitions'), { recursive: true })
    mkdirSync(join(testDir, 'workflows', 'instances'), { recursive: true })
    mkdirSync(join(testDir, 'assets', 'images', 'task-1'), { recursive: true })
    indexCalls.length = 0
    removeCalls.length = 0
    resetSearchRegistry()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await stop()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('projects plugin: write triggers index, delete triggers remove', async () => {
    await projectsPlugin.activate(makeCtx(projectsPlugin))
    const eventBus = new BakinEventBus(() => {})
    start({ contentDir: testDir, eventBus, onInboxFile: vi.fn() })
    const handlers = await getChokidarHandlers()

    const projectFile = join(testDir, 'projects', 'integration.md')
    writeFileSync(projectFile, '---\ntitle: Integration\nstatus: active\n---\nbody\n')
    handlers.add(projectFile)
    await flushHooks()

    const projectIndex = indexCalls.find(c => c.table === 'bakin_projects')
    expect(projectIndex).toBeDefined()
    expect(projectIndex!.key).toBe('integration')
    expect(projectIndex!.doc.title).toBe('Integration')

    handlers.unlink(projectFile)
    await flushHooks()

    expect(removeCalls).toContainEqual({ table: 'bakin_projects', key: 'integration' })
  })

  it('workflows plugin: definition YAML add/delete flows through search', async () => {
    await workflowsPlugin.activate(makeCtx(workflowsPlugin))
    const eventBus = new BakinEventBus(() => {})
    start({ contentDir: testDir, eventBus, onInboxFile: vi.fn() })
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
    start({ contentDir: testDir, eventBus, onInboxFile: vi.fn() })
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

  it('assets plugin: binary delete removes from index, sidecar-only delete does not', async () => {
    await assetsPlugin.activate(makeCtx(assetsPlugin))
    const eventBus = new BakinEventBus(() => {})
    start({ contentDir: testDir, eventBus, onInboxFile: vi.fn() })
    const handlers = await getChokidarHandlers()

    const assetFile = join(testDir, 'assets', 'images', 'task-1', 'photo.png')
    const sidecarFile = assetFile + '.meta.json'
    writeFileSync(assetFile, 'fake png bytes')
    writeFileSync(sidecarFile, JSON.stringify({
      description: 'integration photo',
      tags: ['x'],
      agent: 'tester',
      taskId: 'task-1',
      tool: 'test',
      created: '2026-04-12T00:00:00.000Z',
    }))

    // Sidecar-only delete: must NOT remove from search
    handlers.unlink(sidecarFile)
    await flushHooks()
    expect(removeCalls.find(c => c.table === 'bakin_assets')).toBeUndefined()

    // Binary delete: must remove from search
    handlers.unlink(assetFile)
    await flushHooks()
    expect(removeCalls).toContainEqual({
      table: 'bakin_assets',
      key: 'assets/images/task-1/photo.png',
    })
  })

  it('assets plugin: .trash/ deletes are ignored', async () => {
    await assetsPlugin.activate(makeCtx(assetsPlugin))
    const eventBus = new BakinEventBus(() => {})
    start({ contentDir: testDir, eventBus, onInboxFile: vi.fn() })
    const handlers = await getChokidarHandlers()

    mkdirSync(join(testDir, 'assets', '.trash'), { recursive: true })
    const trashFile = join(testDir, 'assets', '.trash', 'gone__deleted-1.png')
    writeFileSync(trashFile, 'bytes')

    handlers.unlink(trashFile)
    await flushHooks()

    expect(removeCalls.find(c => c.table === 'bakin_assets')).toBeUndefined()
  })
})
