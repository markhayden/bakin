import { describe, it, expect, afterAll, vi } from 'vitest'

const { hoistedBakinHome, hoistedOpenClawHome } = vi.hoisted(() => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const bakinHome = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))
  const openclawHome = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-'))
  process.env.BAKIN_HOME = bakinHome
  process.env.OPENCLAW_HOME = openclawHome
  return { hoistedBakinHome: bakinHome, hoistedOpenClawHome: openclawHome }
})

vi.mock('../../src/core/content-dir', () => ({
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
}))

vi.mock('../../plugins/tasks/lib/flow-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
  getTaskWithColumn: () => null,
  getTasksByColumn: () => [],
  getTasksByAgent: () => [],
  readAllColumns: () => ({ todo: [], 'in-progress': [], done: [] }),
  getTodoTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] }, todoTasks: [] }),
  getAgentTasks: () => [],
  createTask: vi.fn(() => Promise.resolve({ id: 'mock-task' })),
  moveTask: vi.fn(() => Promise.resolve()),
  assignTask: vi.fn(() => Promise.resolve()),
  deleteTask: vi.fn(() => Promise.resolve()),
  addTaskLog: vi.fn(() => Promise.resolve()),
  blockTask: vi.fn(() => Promise.resolve()),
  updateTask: vi.fn(() => Promise.resolve()),
  setDependency: vi.fn(() => Promise.resolve()),
  clearDependency: vi.fn(() => Promise.resolve()),
  reorderTasks: vi.fn(() => Promise.resolve()),
  moveTaskToInProgress: vi.fn(() => Promise.resolve()),
  archiveOldTasks: () => 0,
  getArchivedCount: () => 0,
  autoArchiveDoneTasks: () => 0,
  generateTaskId: () => 'mock-id',
  localDateString: () => '2026-04-13',
  VALID_TRANSITIONS: {},
}))

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import type { PluginContext, BakinPlugin, APIRoute, NavItem } from '../../src/lib/plugin-types'
import { BakinEventBus } from '../../src/lib/events/event-bus'
import { MarkdownStorageAdapter } from '../../src/lib/storage/markdown-adapter'
import fs from 'fs'

// Import all plugins
import tasksPlugin from '../../plugins/tasks'
import memoryPlugin from '../../plugins/memory'
import modelsPlugin from '../../plugins/models'
import messagingPlugin from '../../plugins/messaging'
import workflowsPlugin from '../../plugins/workflows'
import assetsPlugin from '../../plugins/assets'
import projectsPlugin from '../../plugins/projects'
import schedulePlugin from '../../plugins/schedule'
import healthPlugin from '../../plugins/health'

const TEST_DIR = hoistedBakinHome
const TEST_OPENCLAW_HOME = hoistedOpenClawHome
const ORIGINAL_OPENCLAW_HOME = process.env.OPENCLAW_HOME

function createMockContext(pluginId: string): {
  ctx: PluginContext
  routes: APIRoute[]
  navItems: NavItem[]
} {
  const routes: APIRoute[] = []
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
    registerNav: (items) => navItems.push(...items),
    registerRoute: (route) => routes.push(route),
    registerSlot: () => {},
    registerExecTool: () => {},
    registerSkill: () => {},
    registerWorkflow: () => {},
    registerNodeType: () => '',
    watchFiles: () => {},
    getSettings: (() => ({})) as PluginContext['getSettings'],
    updateSettings: () => {},
    activity: {
      log: () => {},
      audit: () => {},
    },
    search: {
      registerContentType: () => maybeAutoRegisterSearchRoute(),
      registerFileBackedContentType: () => maybeAutoRegisterSearchRoute(),
      index: async () => {},
      remove: async () => {},
      transform: async () => {},
      query: async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const } }),
    },
    hooks: {
      register: () => () => {},
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
  messagingPlugin,
  workflowsPlugin,
  assetsPlugin,
  projectsPlugin,
  schedulePlugin,
  healthPlugin,
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

      it('activate registers at least one route', async () => {
        const { ctx, routes } = createMockContext(plugin.id)
        await plugin.activate(ctx)
        expect(routes.length).toBeGreaterThan(0)
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
