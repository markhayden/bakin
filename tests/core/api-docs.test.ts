import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// We need fresh module state per test since routeDocs is module-level
let registerRouteDoc: typeof import('../../src/core/api-docs').registerRouteDoc
let getAllRoutes: typeof import('../../src/core/api-docs').getAllRoutes
let generateDocs: typeof import('../../src/core/api-docs').generateDocs

describe('api-docs', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-api-docs-'))
    // Reset module to clear routeDocs array between tests
    vi.resetModules()
    const mod = await import('../../src/core/api-docs')
    registerRouteDoc = mod.registerRouteDoc
    getAllRoutes = mod.getAllRoutes
    generateDocs = mod.generateDocs
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
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

  // -------------------------------------------------------------------------
  // generateDocs
  // -------------------------------------------------------------------------

  describe('generateDocs', () => {
    it('creates docs/API.md in the content directory', () => {
      generateDocs(tempDir)

      const docsPath = join(tempDir, 'docs', 'API.md')
      expect(existsSync(docsPath)).toBe(true)
    })

    it('creates the docs/ directory if it does not exist', () => {
      expect(existsSync(join(tempDir, 'docs'))).toBe(false)
      generateDocs(tempDir)
      expect(existsSync(join(tempDir, 'docs'))).toBe(true)
    })

    it('includes header and base URL', () => {
      generateDocs(tempDir)

      const content = readFileSync(join(tempDir, 'docs', 'API.md'), 'utf-8')
      expect(content).toContain('# Bakin API Documentation')
      expect(content).toContain('**Base URL:**')
    })

    it('groups routes by plugin with section headers', () => {
      registerRouteDoc('tasks', { path: '/list', method: 'GET', description: 'List tasks' })
      registerRouteDoc('schedule', { path: '/jobs', method: 'GET', description: 'List jobs' })
      generateDocs(tempDir)

      const content = readFileSync(join(tempDir, 'docs', 'API.md'), 'utf-8')
      expect(content).toContain('## Core Routes')
      expect(content).toContain('## Plugin: tasks')
      expect(content).toContain('## Plugin: schedule')
    })

    it('renders route method and full path', () => {
      registerRouteDoc('tasks', { path: '/list', method: 'GET' })
      generateDocs(tempDir)

      const content = readFileSync(join(tempDir, 'docs', 'API.md'), 'utf-8')
      expect(content).toContain('`GET /api/plugins/tasks/list`')
    })

    it('renders description and params when present', () => {
      registerRouteDoc('tasks', {
        path: '/:id',
        method: 'PUT',
        description: 'Update a task',
        params: '{"title":"string"}',
      })
      generateDocs(tempDir)

      const content = readFileSync(join(tempDir, 'docs', 'API.md'), 'utf-8')
      expect(content).toContain('Update a task')
      expect(content).toContain('**Parameters:** `{"title":"string"}`')
    })
  })
})
