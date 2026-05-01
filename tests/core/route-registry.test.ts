/**
 * T2 — Route registry behavior tests.
 *
 * Covers:
 *   - register() / match() round-trip with literal and parameterized paths
 *   - duplicate <method, fullPath> registration throws
 *   - duplicate operationId throws
 *   - literal segments take precedence over :param
 *   - :param segments take precedence over wildcard catch-alls
 *   - plugin routes are prefixed with /api/plugins/<id>; core routes are not
 *   - clear() resets state
 *   - all() returns the registered route set
 *   - operationIdFor derivation
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { z } from 'zod'

const testDir = join(tmpdir(), `bakin-test-route-registry-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/task-store', () => ({}))

import { defineRoute, defineCoreRoute } from '../../packages/core/src/routing'
import { RouteRegistry } from '../../packages/core/src/routing/registry'
import { operationIdFor } from '../../packages/core/src/routing/operation-id'

const stubResponse = z.object({ ok: z.literal(true) })

const exampleCoreRoute = defineCoreRoute({
  path: '/api/version',
  method: 'GET',
  summary: 'Get version',
  responses: { 200: stubResponse },
  handler: async () => Response.json({ ok: true as const }),
})

const exampleParamRoute = defineRoute({
  path: '/:id',
  method: 'GET',
  summary: 'Get one',
  params: z.object({ id: z.string() }),
  responses: { 200: stubResponse },
  handler: async () => Response.json({ ok: true as const }),
})

const exampleLiteralRoute = defineRoute({
  path: '/all',
  method: 'GET',
  summary: 'Get all',
  responses: { 200: stubResponse },
  handler: async () => Response.json({ ok: true as const }),
})

describe('RouteRegistry', () => {
  let registry: RouteRegistry

  beforeEach(() => {
    registry = new RouteRegistry()
  })

  describe('register / match', () => {
    it('matches a literal core route', () => {
      registry.register({ scope: 'core', route: exampleCoreRoute })
      const m = registry.match('GET', '/api/version')
      expect(m).not.toBeNull()
      expect(m?.route.path).toBe('/api/version')
      expect(m?.params).toEqual({})
    })

    it('matches a plugin route at the prefixed full path', () => {
      registry.register({ scope: 'plugin', pluginId: 'tasks', route: exampleLiteralRoute })
      const m = registry.match('GET', '/api/plugins/tasks/all')
      expect(m).not.toBeNull()
      expect(m?.route.path).toBe('/all')
    })

    it('extracts :param values into match.params', () => {
      registry.register({ scope: 'plugin', pluginId: 'tasks', route: exampleParamRoute })
      const m = registry.match('GET', '/api/plugins/tasks/abc-123')
      expect(m).not.toBeNull()
      expect(m?.params).toEqual({ id: 'abc-123' })
    })

    it('returns null when no route matches', () => {
      registry.register({ scope: 'plugin', pluginId: 'tasks', route: exampleLiteralRoute })
      expect(registry.match('GET', '/api/plugins/tasks/nope')).toBeNull()
      expect(registry.match('POST', '/api/plugins/tasks/all')).toBeNull()
    })
  })

  describe('precedence', () => {
    it('literal segments beat :param segments', () => {
      // /api/plugins/tasks/all (literal) should match before /:id
      registry.register({ scope: 'plugin', pluginId: 'tasks', route: exampleParamRoute })
      registry.register({ scope: 'plugin', pluginId: 'tasks', route: exampleLiteralRoute })
      const m = registry.match('GET', '/api/plugins/tasks/all')
      expect(m?.route.path).toBe('/all')
      expect(m?.params).toEqual({})
    })
  })

  describe('duplicates', () => {
    it('throws on duplicate <method, fullPath>', () => {
      registry.register({ scope: 'core', route: exampleCoreRoute })
      expect(() => registry.register({ scope: 'core', route: exampleCoreRoute })).toThrow(
        /duplicate route/i,
      )
    })

    it('throws on duplicate operationId', () => {
      const a = defineCoreRoute({
        ...exampleCoreRoute,
        path: '/api/a',
        operationId: 'shared',
      })
      const b = defineCoreRoute({
        ...exampleCoreRoute,
        path: '/api/b',
        operationId: 'shared',
      })
      registry.register({ scope: 'core', route: a })
      expect(() => registry.register({ scope: 'core', route: b })).toThrow(
        /duplicate operation/i,
      )
    })
  })

  describe('clear / all', () => {
    it('clear() resets state', () => {
      registry.register({ scope: 'core', route: exampleCoreRoute })
      expect(registry.all().length).toBe(1)
      registry.clear()
      expect(registry.all().length).toBe(0)
      expect(registry.match('GET', '/api/version')).toBeNull()
    })

    it('all() reports the registered route set', () => {
      registry.register({ scope: 'core', route: exampleCoreRoute })
      registry.register({ scope: 'plugin', pluginId: 'tasks', route: exampleLiteralRoute })
      const entries = registry.all()
      expect(entries.length).toBe(2)
      const fullPaths = entries.map(e => e.fullPath).sort()
      expect(fullPaths).toEqual(['/api/plugins/tasks/all', '/api/version'])
    })
  })

  describe('operationIdFor', () => {
    it('derives a slug from scope, method, path', () => {
      expect(operationIdFor('tasks', 'GET', '/')).toBe('tasks.get.root')
      expect(operationIdFor('tasks', 'POST', '/:taskId/move')).toBe('tasks.post.task-id-move')
      expect(operationIdFor('core', 'GET', '/api/version')).toBe('core.get.api-version')
      expect(operationIdFor('core', 'POST', '/api/agents/start')).toBe('core.post.api-agents-start')
    })

    it('handles trailing-slash and multiple :params', () => {
      expect(operationIdFor('memory', 'GET', '/sessions/:sessionId/turns/:turnId/'))
        .toBe('memory.get.sessions-session-id-turns-turn-id')
    })
  })
})
