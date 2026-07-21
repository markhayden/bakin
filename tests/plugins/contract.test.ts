import { describe, it, expect, afterAll, mock } from 'bun:test'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import { createMockBakinTaskStore } from '@bakin/core/tasks/testing'

const { hoistedBakinHome, hoistedOpenClawHome } = (() => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const bakinHome = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))
  const openclawHome = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-'))
  process.env.BAKIN_HOME = bakinHome
  process.env.OPENCLAW_HOME = openclawHome
  return { hoistedBakinHome: bakinHome, hoistedOpenClawHome: openclawHome }
})()

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => hoistedBakinHome,
  getBakinPaths: () => ({
    home: hoistedBakinHome,
    settings: `${hoistedBakinHome}/settings.json`,
    'plugin-settings': `${hoistedBakinHome}/plugin-settings`,
    plugins: `${hoistedBakinHome}/plugins`,
    agents: `${hoistedBakinHome}/agents`,
    assets: `${hoistedBakinHome}/assets`,
    projects: `${hoistedBakinHome}/projects`,
    heartbeats: `${hoistedBakinHome}/heartbeats`,
    schedule: `${hoistedBakinHome}/schedule`,
    workflows: `${hoistedBakinHome}/workflows`,
    team: `${hoistedBakinHome}/team`,
    logs: `${hoistedBakinHome}/logs`,
    audit: `${hoistedBakinHome}/audit.jsonl`,
    memoryLog: `${hoistedBakinHome}/MEMORY-LOG.md`,
  }),
  resetContentDir: () => {},
  isUsingBakinHome: () => true,
  initBakinHome: () => {},
}))

mock.module('@/core/task-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
  getTaskWithColumn: () => null,
  getTasksByColumn: () => [],
  getTasksByAgent: () => [],
  readAllColumns: () => ({ todo: [], 'in-progress': [], done: [] }),
  getTodoTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] }, todoTasks: [] }),
  getAgentTasks: () => [],
  createTask: mock(() => Promise.resolve({ id: 'mock-task' })),
  moveTask: mock(() => Promise.resolve()),
  assignTask: mock(() => Promise.resolve()),
  deleteTask: mock(() => Promise.resolve()),
  addTaskLog: mock(() => Promise.resolve()),
  blockTask: mock(() => Promise.resolve()),
  updateTask: mock(() => Promise.resolve()),
  setDependency: mock(() => Promise.resolve()),
  clearDependency: mock(() => Promise.resolve()),
  reorderTasks: mock(() => Promise.resolve()),
  moveTaskToInProgress: mock(() => Promise.resolve()),
  assignTaskToTeam: mock(() => Promise.resolve()),
  recordTeamResolution: mock(() => Promise.resolve()),
  archiveOldTasks: () => 0,
  getArchivedCount: () => 0,
  autoArchiveDoneTasks: () => 0,
  generateTaskId: () => 'mock-id',
  localDateString: () => '2026-04-13',
  VALID_TRANSITIONS: {},
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => hoistedOpenClawHome,
  getOpenClawPath: (...parts: string[]) => `${hoistedOpenClawHome}/${parts.join('/')}`,
  resetOpenClawHome: () => {},
}))

import type { PluginContext, BakinPlugin, RegisteredAPIRoute, NavItem } from '@bakin/core/plugin-types'
import { BakinEventBus } from '../../src/lib/events/event-bus'
import { MarkdownStorageAdapter } from '../../src/lib/storage/markdown-adapter'
import fs from 'fs'
import { createConversationTurnService } from '../../src/core/conversation-turns'

// Import all plugins via require — ES imports are hoisted above the IIFE
// that seeds BAKIN_HOME / OPENCLAW_HOME, so plugin modules that call
// getContentDir/getOpenClawHome at module init would hit the guard.
const tasksPlugin = require('../../plugins/tasks').default as typeof import('../../plugins/tasks').default
const memoryPlugin = require('../../plugins/memory').default as typeof import('../../plugins/memory').default
const modelsPlugin = require('../../plugins/models').default as typeof import('../../plugins/models').default
const workflowsPlugin = require('../../plugins/workflows').default as typeof import('../../plugins/workflows').default
const assetsPlugin = require('../../plugins/assets').default as typeof import('../../plugins/assets').default
const schedulePlugin = require('../../plugins/schedule').default as typeof import('../../plugins/schedule').default
const healthPlugin = require('../../plugins/health').default as typeof import('../../plugins/health').default
const gitPlugin = require('../../plugins/git').default as typeof import('../../plugins/git').default

const TEST_DIR = hoistedBakinHome
const TEST_OPENCLAW_HOME = hoistedOpenClawHome
const ORIGINAL_OPENCLAW_HOME = process.env.OPENCLAW_HOME

function createMockContext(pluginId: string): {
  ctx: PluginContext
  routes: RegisteredAPIRoute[]
  navItems: NavItem[]
} {
  const routes: RegisteredAPIRoute[] = []
  const navItems: NavItem[] = []

  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true })
  }
  process.env.OPENCLAW_HOME = TEST_OPENCLAW_HOME

  const storage = new MarkdownStorageAdapter(TEST_DIR)
  const events = new BakinEventBus(() => {})

  // Mirror production: registerContentType auto-registers GET /search on the
  // plugin's router. Without this, a plugin whose only public route is the
  // free /search trips the "activate registers at least one route" contract.
  let searchRouteRegistered = false
  const maybeAutoRegisterSearchRoute = () => {
    if (searchRouteRegistered) return
    searchRouteRegistered = true
    routes.push({
      path: '/search',
      method: 'GET',
      description: `Search ${pluginId}`,
      handler: async () => Response.json({ results: [] }),
    })
  }

  const ctx: PluginContext = {
    storage,
    events,
    pluginId,
    runtime: createMockRuntimeAdapter(),
    tasks: createMockBakinTaskStore() as unknown as PluginContext['tasks'],
    conversations: {
      createTurnService: (config) => createConversationTurnService(config as unknown as Parameters<typeof createConversationTurnService>[0]) as unknown as ReturnType<PluginContext['conversations']['createTurnService']>,
    },
    assets: {
      createAsset: async () => ({ assetId: 'test-asset', version: 1 }),
      getAsset: async () => null,
      addVersion: async () => ({ assetId: 'test-asset', version: 2 }),
      addExport: async () => ({ name: 'export', file: 'exports/export.jpg' }),
      resolveVersionFile: async () => null,
      listAssets: async () => [],
      getAssetVersions: async () => null,
      upsertFromSource: async () => ({ assetId: 'test-asset', version: 1, changed: true }),
      resolveStoreFile: async () => null,
    },
    registerNav: (items) => navItems.push(...items),
    registerSlot: () => {},
    registerExecTool: () => {},
    registerSkill: () => {},
    registerWorkflow: () => {},
    registerNodeType: () => '',
    registerNotificationChannel: () => '',
    registerHealthCheck: () => '',
    registerHealthRepairAction: () => '',
    watchFiles: () => {},
    getSettings: (() => ({})) as PluginContext['getSettings'],
    updateSettings: () => {},
    activity: {
      log: () => {},
      audit: () => {},
    },
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    search: {
      registerContentType: () => maybeAutoRegisterSearchRoute(),
      registerFileBackedContentType: () => maybeAutoRegisterSearchRoute(),
      index: async () => {},
      remove: async () => {},
      transform: async () => {},
      query: async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' as const } }),
    },
    hooks: {
      register: () => () => {},
      call: async (_name, data) => data,
      callAll: async () => {},
      has: () => false,
      invoke: async () => undefined,
    },
  }

  return { ctx, routes, navItems }
}

const ALL_PLUGINS: BakinPlugin[] = [
  tasksPlugin,
  memoryPlugin,
  modelsPlugin,
  workflowsPlugin,
  assetsPlugin,
  schedulePlugin,
  healthPlugin,
  gitPlugin,
]

describe('Plugin Contract', () => {
  afterAll(() => {
    if (ORIGINAL_OPENCLAW_HOME === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = ORIGINAL_OPENCLAW_HOME
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true })
    }
  })

  for (const plugin of ALL_PLUGINS) {
    describe(`Plugin: ${plugin.name || plugin.id}`, () => {
      it('has required fields: id, name, version', () => {
        expect(plugin.id).toBeDefined()
        expect(typeof plugin.id).toBe('string')
        expect(plugin.id.length).toBeGreaterThan(0)

        expect(plugin.name).toBeDefined()
        expect(typeof plugin.name).toBe('string')

        expect(plugin.version).toBeDefined()
        expect(typeof plugin.version).toBe('string')
      })

      it('has an activate function', () => {
        expect(plugin.activate).toBeDefined()
        expect(typeof plugin.activate).toBe('function')
      })

      it('exposes at least one declarative route', () => {
        // Every in-repo plugin declares routes statically on `plugin.routes`;
        // the legacy `ctx.registerRoute` adapter is gone (T19).
        const declarative = plugin.routes ?? []
        expect(declarative.length).toBeGreaterThan(0)
      })

      it('has a settingsSchema with valid fields', () => {
        if (!plugin.settingsSchema) return // optional but recommended
        expect(Array.isArray(plugin.settingsSchema.fields)).toBe(true)
        for (const field of plugin.settingsSchema.fields) {
          expect(field.key).toBeDefined()
          expect(['string', 'number', 'boolean', 'select', 'list']).toContain(field.type)
          expect(field.label).toBeDefined()
          if (field.type === 'select') {
            expect(Array.isArray(field.options)).toBe(true)
          }
          if (field.type === 'list') {
            expect(typeof field.itemShape).toBe('object')
          }
        }
      })

      it('lifecycle hooks are functions if defined', () => {
        if (plugin.onReady) expect(typeof plugin.onReady).toBe('function')
        if (plugin.onShutdown) expect(typeof plugin.onShutdown).toBe('function')
      })

      it('all registered routes have valid method and path', async () => {
        const { ctx, routes } = createMockContext(plugin.id)
        await plugin.activate(ctx)

        for (const route of routes) {
          expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(route.method)
          expect(route.path).toMatch(/^\//)
          expect(typeof route.handler).toBe('function')
        }
      })
    })
  }
})
