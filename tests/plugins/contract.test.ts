import { describe, it, expect, afterAll } from 'vitest'
import type { PluginContext, BakinPlugin, APIRoute, NavItem } from '../../src/lib/plugin-types'
import { BakinEventBus } from '../../src/lib/events/event-bus'
import { MarkdownStorageAdapter } from '../../src/lib/storage/markdown-adapter'
import fs from 'fs'
import path from 'path'

// Import all plugins
import tasksPlugin from '../../plugins/tasks'
import memoryPlugin from '../../plugins/memory'
import modelsPlugin from '../../plugins/models'
import calendarPlugin from '../../plugins/calendar'
import workflowsPlugin from '../../plugins/workflows'

const TEST_DIR = path.join(process.cwd(), 'test-content-contract')

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

  const storage = new MarkdownStorageAdapter(TEST_DIR)
  const events = new BakinEventBus(() => {})

  const ctx: PluginContext = {
    storage,
    events,
    pluginId,
    registerNav: (items) => navItems.push(...items),
    registerRoute: (route) => routes.push(route),
    registerSlot: () => {},
    registerExecTool: () => {},
    registerSkill: () => {},
    watchFiles: () => {},
    getSettings: (() => ({})) as PluginContext['getSettings'],
    updateSettings: () => {},
    activity: {
      log: () => {},
      audit: () => {},
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
  calendarPlugin,
  workflowsPlugin,
]

describe('Plugin Contract', () => {
  afterAll(() => {
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

      it('all registered routes have valid method and path', async () => {
        const { ctx, routes } = createMockContext(plugin.id)
        await plugin.activate(ctx)

        for (const route of routes) {
          expect(['GET', 'POST', 'PUT', 'DELETE']).toContain(route.method)
          expect(route.path).toMatch(/^\//)
          expect(typeof route.handler).toBe('function')
        }
      })
    })
  }
})
