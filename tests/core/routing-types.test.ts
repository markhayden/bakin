/**
 * T1 — Type-shape tests for routing primitives.
 *
 * These are compile-time assertions: the body of each `it()` is a TypeScript
 * exercise. If the file typechecks, the assertions hold. Runtime side just
 * verifies the helpers are identity functions.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { z } from 'zod'

const testDir = join(tmpdir(), `bakin-test-routing-types-${Date.now()}-${randomUUID()}`)
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
import {
  defineRoute,
  defineCoreRoute,
  definePlugin,
  type APIRoute,
  type RouteContext,
  type CoreContext,
  type PluginContextLite,
  type ParsedInput,
} from '../../packages/core/src/routing'

type Expect<T extends true> = T
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false

describe('routing types', () => {
  it('ParsedInput omits keys whose schema is undefined', () => {
    type _BodyOnly = Expect<Equal<ParsedInput<undefined, undefined, { x: number }>, { body: { x: number } }>>
    type _ParamsOnly = Expect<Equal<ParsedInput<{ id: string }, undefined, undefined>, { params: { id: string } }>>
    type _AllThree = Expect<Equal<
      ParsedInput<{ id: string }, { q?: string }, { x: number }>,
      { params: { id: string } } & { query: { q?: string } } & { body: { x: number } }
    >>
    type _NoneDeclared = Expect<Equal<ParsedInput<undefined, undefined, undefined>, {}>>
    expect(true).toBe(true)
  })

  it('defineRoute is identity and infers handler arg types', () => {
    const body = z.object({ title: z.string() })
    const responses = { 200: z.object({ id: z.string() }) }
    const route = defineRoute({
      path: '/',
      method: 'POST',
      summary: 'Create thing',
      body,
      responses,
      handler: async (_req, _ctx, parsed) => {
        const _title: string = parsed.body.title
        return Response.json({ id: 'a1' })
      },
    })
    expect(route.path).toBe('/')
    expect(route.method).toBe('POST')
    expect(route.body).toBe(body)
  })

  it('defineRoute with no body omits parsed.body', () => {
    const route = defineRoute({
      path: '/list',
      method: 'GET',
      summary: 'List things',
      responses: { 200: z.array(z.string()) },
      handler: async (_req, _ctx, parsed) => {
        // @ts-expect-error parsed.body should not exist
        const _shouldFail = parsed.body
        return Response.json([])
      },
    })
    expect(route.method).toBe('GET')
  })

  it('defineCoreRoute binds CoreContext to the handler', () => {
    const route = defineCoreRoute({
      path: '/api/version',
      method: 'GET',
      summary: 'Get runtime version',
      responses: { 200: z.object({ version: z.string() }) },
      handler: async (_req, ctx) => {
        const _isCore: CoreContext = ctx
        return Response.json({ version: '1.0.0' })
      },
    })
    expect(route.path).toBe('/api/version')
  })

  it('definePlugin preserves per-route inference inside routes array', () => {
    const plugin = definePlugin({
      id: 'sample',
      name: 'Sample',
      version: '1.0.0',
      routes: [
        defineRoute({
          path: '/',
          method: 'POST',
          summary: 'Create',
          body: z.object({ name: z.string() }),
          responses: { 200: z.object({ ok: z.literal(true) }) },
          handler: async (_req, _ctx, parsed) => {
            const _name: string = parsed.body.name
            return Response.json({ ok: true as const })
          },
        }),
      ],
    })
    expect(plugin.id).toBe('sample')
    expect(plugin.routes?.length).toBe(1)
  })

  it('ResponseSpec discriminates JSON, NoContent, and NonJson', () => {
    const r1 = defineRoute({
      path: '/sse',
      method: 'GET',
      summary: 'SSE stream',
      responses: { 200: { contentType: 'text/event-stream' } },
      handler: async () => new Response('data: hi\n\n'),
    })
    const r2 = defineRoute({
      path: '/empty',
      method: 'POST',
      summary: 'No-content op',
      responses: { 204: { contentType: 'none' } },
      handler: async () => new Response(null, { status: 204 }),
    })
    const r3 = defineRoute({
      path: '/json',
      method: 'GET',
      summary: 'JSON shorthand',
      responses: { 200: z.object({ a: z.number() }) },
      handler: async () => Response.json({ a: 1 }),
    })
    expect(r1.responses?.[200]).toEqual({ contentType: 'text/event-stream' })
    expect(r2.responses?.[204]).toEqual({ contentType: 'none' })
    expect(r3.responses?.[200]).toBeDefined()
  })

  it('handler types reflect ctx narrowing — RouteContext is the common base', () => {
    type _CoreExtendsRoute = Expect<Equal<CoreContext extends RouteContext ? true : false, true>>
    type _PluginExtendsRoute = Expect<Equal<PluginContextLite extends RouteContext ? true : false, true>>
    expect(true).toBe(true)
  })
})
