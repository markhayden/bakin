/**
 * T5 — Route-contract validator behavior.
 *
 * Validator walks declarative routes (plugin.routes + coreRoutes) and
 * reports public-route schema gaps. Internal routes are exempt. Multipart
 * and raw bodies are allowed without schemas.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { z } from 'zod'

const testDir = join(tmpdir(), `bakin-test-route-validator-${Date.now()}-${randomUUID()}`)
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

import { defineRoute } from '../../packages/core/src/routing'
import { validateRouteContracts } from '../../scripts/docs/route-contract-check-lib'

describe('validateRouteContracts', () => {
  it('passes a route with body + responses[200] schema', () => {
    const route = defineRoute({
      path: '/',
      method: 'POST',
      summary: 'Create',
      body: z.object({ title: z.string() }),
      responses: { 200: z.object({ ok: z.literal(true) }) },
      handler: async () => Response.json({ ok: true as const }),
    })
    const result = validateRouteContracts({
      pluginRoutes: { tasks: [route] },
      coreRoutes: [],
    })
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('warns when a public route has no responses[2xx]', () => {
    const route = defineRoute({
      path: '/',
      method: 'POST',
      summary: 'Create',
      body: z.object({ title: z.string() }),
      responses: { 500: z.object({ error: z.string() }) },
      handler: async () => Response.json({}, { status: 500 }),
    })
    const result = validateRouteContracts({
      pluginRoutes: { tasks: [route] },
      coreRoutes: [],
    })
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0]).toMatchObject({
      scope: 'tasks',
      method: 'POST',
      path: '/',
    })
    expect(result.warnings[0].issue).toMatch(/2xx/)
  })

  it('warns when public path has :param without params schema', () => {
    const route = defineRoute({
      path: '/:taskId',
      method: 'GET',
      summary: 'Get',
      responses: { 200: z.object({ id: z.string() }) },
      handler: async () => Response.json({ id: 'a' }),
    })
    const result = validateRouteContracts({
      pluginRoutes: { tasks: [route] },
      coreRoutes: [],
    })
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0].issue).toMatch(/params schema/i)
  })

  it('skips internal routes entirely', () => {
    const route = defineRoute({
      path: '/internal',
      method: 'POST',
      summary: 'Internal',
      visibility: 'internal',
      // No body, no responses[2xx], :param-less — public would fail.
      responses: { 500: z.object({ error: z.string() }) },
      handler: async () => Response.json({}, { status: 500 }),
    })
    const result = validateRouteContracts({
      pluginRoutes: { tasks: [route] },
      coreRoutes: [],
    })
    expect(result.warnings).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('multipart with no schema is allowed for public routes', () => {
    const route = defineRoute({
      path: '/upload',
      method: 'POST',
      summary: 'Upload',
      body: { contentType: 'multipart/form-data' },
      responses: { 200: z.object({ ok: z.literal(true) }) },
      handler: async () => Response.json({ ok: true as const }),
    })
    const result = validateRouteContracts({
      pluginRoutes: { assets: [route] },
      coreRoutes: [],
    })
    expect(result.warnings).toEqual([])
  })

  it('warns when 2xx response is application/json without schema', () => {
    // Forge an invalid spec via type assertion — the type system rejects this
    // shape but a hand-edited JSON could produce it.
    const route = defineRoute({
      path: '/',
      method: 'GET',
      summary: 'Bad',
      responses: { 200: { contentType: 'application/json' } as any },
      handler: async () => Response.json({}),
    })
    const result = validateRouteContracts({
      pluginRoutes: { tasks: [route] },
      coreRoutes: [],
    })
    expect(result.warnings.length).toBe(1)
  })

  it('mode: error promotes warnings to errors', () => {
    const route = defineRoute({
      path: '/',
      method: 'POST',
      summary: 'Create',
      // No responses declared — public route should be flagged.
      responses: {} as any,
      handler: async () => Response.json({}),
    })
    const result = validateRouteContracts({
      pluginRoutes: { tasks: [route] },
      coreRoutes: [],
      mode: 'error',
    })
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.warnings).toEqual([])
  })
})
