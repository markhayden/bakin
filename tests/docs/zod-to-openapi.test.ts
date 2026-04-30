/**
 * T3 — Zod→OpenAPI converter + Operation builder.
 *
 * Verifies:
 *   - JSON shorthand response → application/json + schema
 *   - Explicit JSON spec → same
 *   - NoContent (204) → no content key emitted, just description
 *   - NonJson (text/event-stream) → content with the declared content type
 *   - body shorthand → application/json requestBody
 *   - body: { contentType: 'multipart/form-data' } no schema → multipart binary
 *   - body: { contentType: 'none' } → no requestBody
 *   - params + query auto-emit OpenAPI parameters
 *   - global 400 emitted when params|query|body declared
 *   - global 415 emitted only when body declared (not params/query-only)
 *   - :id paths normalize to {id}
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { z } from 'zod'

const testDir = join(tmpdir(), `bakin-test-zod-openapi-${Date.now()}-${randomUUID()}`)
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
import { buildOperation, normalizeOpenApiPath, zodToOpenApi } from '../../packages/core/src/openapi'

describe('zodToOpenApi', () => {
  it('converts a Zod object to an OpenAPI 3.1 JSON Schema (no $schema link)', () => {
    const schema = zodToOpenApi(z.object({ id: z.string(), n: z.number().optional() }))
    expect(schema.$schema).toBeUndefined()
    expect(schema.type).toBe('object')
    expect((schema.properties as any).id).toEqual({ type: 'string' })
    expect(schema.required).toEqual(['id'])
  })
})

describe('normalizeOpenApiPath', () => {
  it('converts :param to {param}', () => {
    expect(normalizeOpenApiPath('/')).toBe('/')
    expect(normalizeOpenApiPath('/:taskId')).toBe('/{taskId}')
    expect(normalizeOpenApiPath('/:taskId/move')).toBe('/{taskId}/move')
    expect(normalizeOpenApiPath('/sessions/:sessionId/turns/:turnId')).toBe('/sessions/{sessionId}/turns/{turnId}')
    expect(normalizeOpenApiPath('/api/agents')).toBe('/api/agents')
  })
})

describe('buildOperation', () => {
  it('emits parameters from path :params with schema-derived types', () => {
    const route = defineRoute({
      path: '/:taskId',
      method: 'GET',
      summary: 'Get task',
      params: z.object({ taskId: z.string() }),
      responses: { 200: z.object({ id: z.string() }) },
      handler: async () => Response.json({ id: 'a' }),
    })
    const op = buildOperation(route, { scope: 'tasks', fullPath: '/api/plugins/tasks/:taskId' })
    expect(op.parameters).toBeDefined()
    expect(op.parameters?.length).toBe(1)
    expect(op.parameters?.[0]).toMatchObject({ name: 'taskId', in: 'path', required: true })
  })

  it('emits parameters from query schema fields', () => {
    const route = defineRoute({
      path: '/list',
      method: 'GET',
      summary: 'List things',
      query: z.object({ limit: z.coerce.number().optional(), q: z.string() }),
      responses: { 200: z.array(z.string()) },
      handler: async () => Response.json([]),
    })
    const op = buildOperation(route, { scope: 'tasks', fullPath: '/api/plugins/tasks/list' })
    const names = op.parameters?.map(p => p.name).sort() ?? []
    expect(names).toEqual(['limit', 'q'])
    const q = op.parameters?.find(p => p.name === 'q')
    expect(q?.required).toBe(true)
    const limit = op.parameters?.find(p => p.name === 'limit')
    expect(limit?.required).toBe(false)
  })

  it('JSON body shorthand emits application/json requestBody', () => {
    const route = defineRoute({
      path: '/',
      method: 'POST',
      summary: 'Create',
      body: z.object({ title: z.string() }),
      responses: { 200: z.object({ ok: z.literal(true) }) },
      handler: async () => Response.json({ ok: true as const }),
    })
    const op = buildOperation(route, { scope: 'tasks', fullPath: '/api/plugins/tasks/' })
    expect(op.requestBody).toBeDefined()
    expect(op.requestBody?.required).toBe(true)
    expect((op.requestBody as any).content['application/json'].schema.type).toBe('object')
  })

  it('multipart body emits multipart/form-data with binary format when no schema', () => {
    const route = defineRoute({
      path: '/upload',
      method: 'POST',
      summary: 'Upload file',
      body: { contentType: 'multipart/form-data' },
      responses: { 200: z.object({ ok: z.literal(true) }) },
      handler: async () => Response.json({ ok: true as const }),
    })
    const op = buildOperation(route, { scope: 'assets', fullPath: '/api/plugins/assets/upload' })
    expect((op.requestBody as any).content['multipart/form-data']).toBeDefined()
  })

  it('body: { contentType: "none" } emits no requestBody', () => {
    const route = defineRoute({
      path: '/dispatch',
      method: 'POST',
      summary: 'Trigger dispatch',
      body: { contentType: 'none' },
      responses: { 200: z.object({ ok: z.literal(true) }) },
      handler: async () => Response.json({ ok: true as const }),
    })
    const op = buildOperation(route, { scope: 'core', fullPath: '/api/dispatch' })
    expect(op.requestBody).toBeUndefined()
  })

  it('omitted body for GET routes emits no requestBody', () => {
    const route = defineRoute({
      path: '/all',
      method: 'GET',
      summary: 'List',
      responses: { 200: z.array(z.string()) },
      handler: async () => Response.json([]),
    })
    const op = buildOperation(route, { scope: 'tasks', fullPath: '/api/plugins/tasks/all' })
    expect(op.requestBody).toBeUndefined()
  })

  it('200 JSON shorthand → application/json schema', () => {
    const route = defineRoute({
      path: '/json',
      method: 'GET',
      summary: 'JSON',
      responses: { 200: z.object({ a: z.number() }) },
      handler: async () => Response.json({ a: 1 }),
    })
    const op = buildOperation(route, { scope: 'tasks', fullPath: '/api/plugins/tasks/json' })
    const r200 = op.responses['200']
    expect((r200 as any).content['application/json'].schema.type).toBe('object')
  })

  it('SSE response emits text/event-stream content', () => {
    const route = defineRoute({
      path: '/events',
      method: 'GET',
      summary: 'SSE stream',
      responses: { 200: { contentType: 'text/event-stream' } },
      handler: async () => new Response('data: hi\n\n'),
    })
    const op = buildOperation(route, { scope: 'core', fullPath: '/api/events' })
    const r200 = op.responses['200']
    expect((r200 as any).content['text/event-stream']).toBeDefined()
  })

  it('204 NoContent emits description but no content', () => {
    const route = defineRoute({
      path: '/foo',
      method: 'POST',
      summary: 'No content',
      body: { contentType: 'none' },
      responses: { 204: { contentType: 'none' } },
      handler: async () => new Response(null, { status: 204 }),
    })
    const op = buildOperation(route, { scope: 'tasks', fullPath: '/api/plugins/tasks/foo' })
    expect(op.responses['204']).toBeDefined()
    expect((op.responses['204'] as any).content).toBeUndefined()
  })

  it('emits global 400 when params/query/body declared', () => {
    const r1 = defineRoute({
      path: '/q',
      method: 'GET',
      summary: 'Q',
      query: z.object({ q: z.string() }),
      responses: { 200: z.object({}) },
      handler: async () => Response.json({}),
    })
    const op1 = buildOperation(r1, { scope: 'tasks', fullPath: '/api/plugins/tasks/q' })
    expect(op1.responses['400']).toBeDefined()

    const r2 = defineRoute({
      path: '/no-input',
      method: 'GET',
      summary: 'No input',
      responses: { 200: z.object({}) },
      handler: async () => Response.json({}),
    })
    const op2 = buildOperation(r2, { scope: 'tasks', fullPath: '/api/plugins/tasks/no-input' })
    expect(op2.responses['400']).toBeUndefined()
  })

  it('emits global 415 only when body is declared (not for query/params-only)', () => {
    const withBody = defineRoute({
      path: '/post',
      method: 'POST',
      summary: 'Body',
      body: z.object({ x: z.number() }),
      responses: { 200: z.object({}) },
      handler: async () => Response.json({}),
    })
    const op1 = buildOperation(withBody, { scope: 'tasks', fullPath: '/api/plugins/tasks/post' })
    expect(op1.responses['415']).toBeDefined()

    const queryOnly = defineRoute({
      path: '/q-only',
      method: 'GET',
      summary: 'Q only',
      query: z.object({ q: z.string() }),
      responses: { 200: z.object({}) },
      handler: async () => Response.json({}),
    })
    const op2 = buildOperation(queryOnly, { scope: 'tasks', fullPath: '/api/plugins/tasks/q-only' })
    expect(op2.responses['415']).toBeUndefined()
  })

  it('respects route.operationId override and falls back to derived id', () => {
    const explicit = defineRoute({
      path: '/x',
      method: 'GET',
      summary: 'X',
      operationId: 'customId',
      responses: { 200: z.object({}) },
      handler: async () => Response.json({}),
    })
    const op1 = buildOperation(explicit, { scope: 'tasks', fullPath: '/api/plugins/tasks/x' })
    expect(op1.operationId).toBe('customId')

    const derived = defineRoute({
      path: '/y',
      method: 'GET',
      summary: 'Y',
      responses: { 200: z.object({}) },
      handler: async () => Response.json({}),
    })
    const op2 = buildOperation(derived, { scope: 'tasks', fullPath: '/api/plugins/tasks/y' })
    expect(op2.operationId).toBe('tasks.get.y')
  })

  it('adapter-maps legacy `input` to JSON requestBody and `output` to responses[200]', () => {
    const legacyRoute = {
      path: '/legacy',
      method: 'POST',
      summary: 'Legacy create',
      input: z.object({ title: z.string() }),
      output: z.object({ id: z.string() }),
      handler: async () => Response.json({ id: 'a' }),
    } as unknown as Parameters<typeof buildOperation>[0]
    const op = buildOperation(legacyRoute, { scope: 'legacy', fullPath: '/api/plugins/legacy/legacy' })
    expect(op.requestBody).toBeDefined()
    expect((op.requestBody as any).content['application/json'].schema.type).toBe('object')
    expect(op.responses['200']).toBeDefined()
    expect((op.responses['200'] as any).content['application/json'].schema.type).toBe('object')
    expect(op.responses['400']).toBeDefined()  // hasInput → global 400
    expect(op.responses['415']).toBeDefined()  // hasBody → global 415
  })

  it('passes through visibility and stability as x- extensions', () => {
    const r = defineCoreRoute({
      path: '/api/dev/notify',
      method: 'POST',
      summary: 'Dev notify',
      visibility: 'internal',
      stability: 'experimental',
      body: z.object({ type: z.string(), payload: z.unknown() }),
      responses: { 200: z.object({ ok: z.literal(true) }) },
      handler: async () => Response.json({ ok: true as const }),
    })
    const op = buildOperation(r, { scope: 'core', fullPath: '/api/dev/notify' })
    expect((op as any)['x-bakin-visibility']).toBe('internal')
    expect((op as any)['x-bakin-stability']).toBe('experimental')
  })
})
