import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const tempStub = mkdtempSync(join(tmpdir(), 'bakin-api-docs-content-'))
process.env.BAKIN_HOME = tempStub
process.env.OPENCLAW_HOME = join(tempStub, 'openclaw')

const contentDirMock = {
  getContentDir: () => tempStub,
  getBakinPaths: () => ({ home: tempStub }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => ({ created: [], seeded: [] }),
}
mock.module('../../src/core/content-dir', () => contentDirMock)
mock.module('../../packages/core/src/content-dir', () => contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(tempStub, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(tempStub, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

// We need fresh module state per test since routeDocs is module-level
let registerRouteDoc: typeof import('../../src/core/api-docs').registerRouteDoc
let getAllRoutes: typeof import('../../src/core/api-docs').getAllRoutes

describe('api-docs', () => {
  beforeEach(async () => {
    const mod = await import('../../src/core/api-docs')
    registerRouteDoc = mod.registerRouteDoc
    getAllRoutes = mod.getAllRoutes
    // bun:test has no vi.resetModules; reset via the module's test hook
    mod._resetRouteDocsForTests()
  })

  afterAll(() => {
    rmSync(tempStub, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // registerRouteDoc
  // -------------------------------------------------------------------------

  describe('registerRouteDoc', () => {
    it('adds a route to the registry', () => {
      registerRouteDoc('tasks', { path: '/list', method: 'GET', description: 'List tasks' })

      const all = getAllRoutes()
      const registered = all.find(r => r.pluginId === 'tasks' && r.path === '/list')
      expect(registered).toBeDefined()
      expect(registered!.method).toBe('GET')
      expect(registered!.description).toBe('List tasks')
    })

    it('constructs fullPath as /api/plugins/{pluginId}{path}', () => {
      registerRouteDoc('schedule', { path: '/jobs', method: 'POST' })

      const route = getAllRoutes().find(r => r.pluginId === 'schedule')
      expect(route!.fullPath).toBe('/api/plugins/schedule/jobs')
    })

    it('includes optional params field', () => {
      registerRouteDoc('tasks', { path: '/:id', method: 'PUT', params: '{"title":"string"}' })

      const route = getAllRoutes().find(r => r.pluginId === 'tasks' && r.path === '/:id')
      expect(route!.params).toBe('{"title":"string"}')
    })

    it('allows multiple routes for the same plugin', () => {
      registerRouteDoc('tasks', { path: '/', method: 'GET' })
      registerRouteDoc('tasks', { path: '/', method: 'POST' })
      registerRouteDoc('tasks', { path: '/:id', method: 'DELETE' })

      const taskRoutes = getAllRoutes().filter(r => r.pluginId === 'tasks')
      expect(taskRoutes).toHaveLength(3)
    })
  })

  // -------------------------------------------------------------------------
  // getAllRoutes
  // -------------------------------------------------------------------------

  describe('getAllRoutes', () => {
    it('includes core routes by default', () => {
      const routes = getAllRoutes()
      const coreRoutes = routes.filter(r => r.pluginId === 'core')
      expect(coreRoutes.length).toBeGreaterThan(0)
    })

    it('core routes include SSE endpoint', () => {
      const routes = getAllRoutes()
      const sse = routes.find(r => r.fullPath === '/api/events')
      expect(sse).toBeDefined()
      expect(sse!.method).toBe('GET')
    })

    it('returns core routes followed by registered plugin routes', () => {
      registerRouteDoc('my-plugin', { path: '/data', method: 'GET' })
      const routes = getAllRoutes()

      const coreIdx = routes.findIndex(r => r.pluginId === 'core')
      const pluginIdx = routes.findIndex(r => r.pluginId === 'my-plugin')
      expect(coreIdx).toBeLessThan(pluginIdx)
    })
  })

  // generateDocs(contentDir) was removed in T17 — `~/.bakin/docs/API.md` is
  // no longer generated; the docs site is the canonical view. The function
  // remains as a no-op stub to avoid breaking imports, so there is nothing
  // to test here.
})
