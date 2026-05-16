/**
 * T4 — Route dispatcher tests.
 *
 * Verifies the dispatcher handles params, query, body parsing, error
 * envelopes, response validation, and the legacy-shape adapter mapping.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { z } from 'zod'

const testDir = join(tmpdir(), `bakin-test-route-dispatcher-${Date.now()}-${randomUUID()}`)
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
import { dispatchRoute } from '../../packages/core/src/routing/dispatcher'

const stubCtx = {} as any

describe('dispatchRoute — happy paths', () => {
  it('passes typed body, params, query into handler', async () => {
    const route = defineRoute({
      path: '/:taskId',
      method: 'POST',
      summary: 'Update task',
      params: z.object({ taskId: z.string() }),
      query: z.object({ from: z.string().optional() }),
      body: z.object({ title: z.string() }),
      responses: {
        200: z.object({
          taskId: z.string(),
          fromQuery: z.string().optional(),
          newTitle: z.string(),
        }),
      },
      handler: async (_req, _ctx, parsed) => {
        return Response.json({
          taskId: parsed.params.taskId,
          fromQuery: parsed.query.from,
          newTitle: parsed.body.title,
        })
      },
    })
    const req = new Request('http://x/api/plugins/tasks/abc-1?from=todo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'rename' }),
    })
    const res = await dispatchRoute({
      req,
      ctx: stubCtx,
      route,
      params: { taskId: 'abc-1' },
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ taskId: 'abc-1', fromQuery: 'todo', newTitle: 'rename' })
  })

  it('supports GET routes with no body', async () => {
    const route = defineRoute({
      path: '/list',
      method: 'GET',
      summary: 'List',
      responses: { 200: z.array(z.string()) },
      handler: async () => Response.json(['a', 'b']),
    })
    const req = new Request('http://x/api/plugins/tasks/list')
    const res = await dispatchRoute({ req, ctx: stubCtx, route, params: {} })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(['a', 'b'])
  })
})

describe('dispatchRoute — input validation', () => {
  it('returns 400 with issues when body fails Zod parse', async () => {
    const route = defineRoute({
      path: '/',
      method: 'POST',
      summary: 'Create',
      body: z.object({ title: z.string().min(1) }),
      responses: { 200: z.object({ ok: z.literal(true) }) },
      handler: async () => Response.json({ ok: true as const }),
    })
    const req = new Request('http://x/api/plugins/tasks/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    })
    const res = await dispatchRoute({ req, ctx: stubCtx, route, params: {} })
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string; issues: unknown[] }
    expect(json.error).toMatch(/invalid input/i)
    expect(Array.isArray(json.issues)).toBe(true)
  })

  it('preserves repeated query keys as arrays', async () => {
    const route = defineRoute({
      path: '/list',
      method: 'GET',
      summary: 'List',
      query: z.object({ facet: z.array(z.string()) }),
      responses: { 200: z.array(z.string()) },
      handler: async (_req, _ctx, parsed) => {
        return Response.json(parsed.query.facet)
      },
    })
    const req = new Request('http://x/list?facet=a&facet=b&facet=c')
    const res = await dispatchRoute({ req, ctx: stubCtx, route, params: {} })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(['a', 'b', 'c'])
  })

  it('passes single-occurrence query keys as scalars', async () => {
    const route = defineRoute({
      path: '/list',
      method: 'GET',
      summary: 'List',
      query: z.object({ q: z.string() }),
      responses: { 200: z.string() },
      handler: async (_req, _ctx, parsed) => {
        return Response.json(parsed.query.q)
      },
    })
    const req = new Request('http://x/list?q=hello')
    const res = await dispatchRoute({ req, ctx: stubCtx, route, params: {} })
    expect(res.status).toBe(200)
    expect(await res.json()).toBe('hello')
  })

  it('returns 400 when query fails Zod parse', async () => {
    const route = defineRoute({
      path: '/list',
      method: 'GET',
      summary: 'List',
      query: z.object({ limit: z.coerce.number() }),
      responses: { 200: z.array(z.string()) },
      handler: async () => Response.json([]),
    })
    const req = new Request('http://x/api/plugins/tasks/list?limit=not-a-number')
    const res = await dispatchRoute({ req, ctx: stubCtx, route, params: {} })
    expect(res.status).toBe(400)
  })

  it('returns 400 when params fail Zod parse', async () => {
    const route = defineRoute({
      path: '/:id',
      method: 'GET',
      summary: 'Get one',
      params: z.object({ id: z.string().uuid() }),
      responses: { 200: z.object({}) },
      handler: async () => Response.json({}),
    })
    const req = new Request('http://x/api/plugins/tasks/not-a-uuid')
    const res = await dispatchRoute({ req, ctx: stubCtx, route, params: { id: 'not-a-uuid' } })
    expect(res.status).toBe(400)
  })

  it('returns 415 when content-type is wrong for JSON body', async () => {
    const route = defineRoute({
      path: '/',
      method: 'POST',
      summary: 'Create',
      body: z.object({ title: z.string() }),
      responses: { 200: z.object({ ok: z.literal(true) }) },
      handler: async () => Response.json({ ok: true as const }),
    })
    const req = new Request('http://x/api/plugins/tasks/', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'not-json',
    })
    const res = await dispatchRoute({ req, ctx: stubCtx, route, params: {} })
    expect(res.status).toBe(415)
  })

  it('returns 415 when body is { contentType: "none" } and request has a body', async () => {
    const route = defineRoute({
      path: '/dispatch',
      method: 'POST',
      summary: 'Trigger',
      body: { contentType: 'none' },
      responses: { 200: z.object({ ok: z.literal(true) }) },
      handler: async () => Response.json({ ok: true as const }),
    })
    const req = new Request('http://x/api/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: 1 }),
    })
    const res = await dispatchRoute({ req, ctx: stubCtx, route, params: {} })
    expect(res.status).toBe(415)
  })
})

describe('dispatchRoute — multipart and raw bodies', () => {
  it('passes multipart bodies through without parsing', async () => {
    const route = defineRoute({
      path: '/upload',
      method: 'POST',
      summary: 'Upload',
      body: { contentType: 'multipart/form-data' },
      responses: { 200: z.object({ ok: z.literal(true) }) },
      handler: async (req) => {
        // Handler reads form data itself
        const form = await req.formData()
        return Response.json({ ok: true as const, fileName: form.get('name') })
      },
    })
    const form = new FormData()
    form.set('name', 'hello.txt')
    const req = new Request('http://x/api/plugins/assets/upload', {
      method: 'POST',
      body: form,
    })
    const res = await dispatchRoute({ req, ctx: stubCtx, route, params: {} })
    expect(res.status).toBe(200)
  })
})

describe('dispatchRoute — response validation (NODE_ENV=test)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
  })

  it('throws when handler returns 200 with shape that does not match responses[200]', async () => {
    const route = defineRoute({
      path: '/',
      method: 'GET',
      summary: 'List',
      responses: { 200: z.object({ items: z.array(z.string()) }) },
      handler: async () => Response.json({ wrong: 'shape' }),
    })
    const req = new Request('http://x/')
    await expect(dispatchRoute({ req, ctx: stubCtx, route, params: {} })).rejects.toThrow(
      /response.+200.+schema/i,
    )
  })

  it('throws when handler returns an undeclared status', async () => {
    const route = defineRoute({
      path: '/',
      method: 'POST',
      summary: 'Create',
      responses: { 200: z.object({ ok: z.literal(true) }) },
      handler: async () => Response.json({ ok: true }, { status: 201 }),
    })
    const req = new Request('http://x/', { method: 'POST' })
    await expect(dispatchRoute({ req, ctx: stubCtx, route, params: {} })).rejects.toThrow(
      /POST \/ \(http:\/\/x\/\): undeclared response status 201/i,
    )
  })

  it('includes route context when a JSON response cannot be parsed', async () => {
    const route = defineRoute({
      path: '/bad-json',
      method: 'GET',
      summary: 'Bad JSON',
      responses: { 200: z.object({ ok: z.literal(true) }) },
      handler: async () => new Response('', { status: 200 }),
    })
    const req = new Request('http://x/bad-json')
    await expect(dispatchRoute({ req, ctx: stubCtx, route, params: {} })).rejects.toThrow(
      /GET \/bad-json \(http:\/\/x\/bad-json\): response 200: expected JSON body but parse failed/i,
    )
  })

  it('includes route and request context when response JSON validation fails', async () => {
    const route = defineRoute({
      path: '/:agentId/avatar',
      method: 'GET',
      summary: 'Avatar',
      responses: { 404: z.object({ error: z.string() }) },
      handler: async () => new Response('missing', { status: 404 }),
    })
    const req = new Request('http://x/api/plugins/team/patch/avatar')

    await expect(dispatchRoute({
      req,
      ctx: stubCtx,
      route,
      params: { agentId: 'patch' },
    })).rejects.toThrow(
      /GET \/:agentId\/avatar .*api\/plugins\/team\/patch\/avatar.*response 404: expected JSON body/i,
    )
  })

  it('does not validate non-JSON responses', async () => {
    const route = defineRoute({
      path: '/sse',
      method: 'GET',
      summary: 'SSE',
      responses: { 200: { contentType: 'text/event-stream' } },
      handler: async () => new Response('data: hi\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      }),
    })
    const req = new Request('http://x/sse')
    const res = await dispatchRoute({ req, ctx: stubCtx, route, params: {} })
    expect(res.status).toBe(200)
  })

  it('does not validate when responses[status] is { contentType: "none" }', async () => {
    const route = defineRoute({
      path: '/foo',
      method: 'POST',
      summary: 'Empty',
      body: { contentType: 'none' },
      responses: { 204: { contentType: 'none' } },
      handler: async () => new Response(null, { status: 204 }),
    })
    const req = new Request('http://x/foo', { method: 'POST' })
    const res = await dispatchRoute({ req, ctx: stubCtx, route, params: {} })
    expect(res.status).toBe(204)
  })
})

describe('dispatchRoute — legacy adapter mapping', () => {
  it('treats legacy `input` as JSON body and `output` as responses[200]', async () => {
    // Legacy APIRoute shape — used when ctx.registerRoute({input, output}) is called.
    const legacyRoute: any = {
      path: '/',
      method: 'POST',
      summary: 'Legacy create',
      input: z.object({ title: z.string() }),
      output: z.object({ id: z.string() }),
      handler: async (_req: Request, _ctx: any) => Response.json({ id: 'a' }),
    }
    const req = new Request('http://x/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'hello' }),
    })
    const res = await dispatchRoute({ req, ctx: stubCtx, route: legacyRoute, params: {} })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'a' })
  })

  it('legacy route with no input/output does not validate', async () => {
    const legacyRoute: any = {
      path: '/x',
      method: 'GET',
      summary: 'Legacy x',
      handler: async () => Response.json({ anything: true }),
    }
    const req = new Request('http://x/x')
    const res = await dispatchRoute({ req, ctx: stubCtx, route: legacyRoute, params: {} })
    expect(res.status).toBe(200)
  })

  it('legacy handler signature (req, ctx) still works (no third arg)', async () => {
    const legacyRoute: any = {
      path: '/',
      method: 'POST',
      summary: 'Two-arg handler',
      input: z.object({ x: z.number() }),
      output: z.object({ doubled: z.number() }),
      handler: async (req: Request) => {
        const body = await req.clone().json() as { x: number }
        return Response.json({ doubled: body.x * 2 })
      },
    }
    const req = new Request('http://x/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: 21 }),
    })
    const res = await dispatchRoute({ req, ctx: stubCtx, route: legacyRoute, params: {} })
    expect(await res.json()).toEqual({ doubled: 42 })
  })
})
