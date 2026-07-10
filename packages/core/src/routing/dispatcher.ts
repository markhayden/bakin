/**
 * Route dispatcher — runs a registered route against a Web Request.
 *
 * Responsibilities:
 *   - Parse path params (provided by the registry's match), query string,
 *     and request body against the route's Zod schemas.
 *   - On parse failure, return `400 { error, issues }` without invoking the
 *     handler.
 *   - On body content-type mismatch, return `415 { error }`.
 *   - Call the handler with the typed `parsed` object.
 *   - In dev / test, validate the response body against `responses[status]`
 *     and surface mismatches (test → throw, dev → console.warn).
 *
 * There is no legacy `input`/`output` adapter mapping here: `ctx.registerRoute`
 * and the legacy `APIRoute` shape were deleted (T19) — declarative routes and
 * core routes are the only producers, and both speak `body`/`responses`.
 * (The OpenAPI builder keeps a read-side mapping for historical doc callers;
 * see packages/core/src/openapi/operation.ts.)
 */

import { z } from 'zod'
import type { BodySpec, ResponseSpec } from './types'
import { errorResponseBody } from '../openapi/errors'
import { createLogger } from '../logger'

const log = createLogger('dispatcher')

/**
 * Loose route shape accepted by the dispatcher. Concrete `APIRoute<...>`
 * types from `defineRoute(...)` are assignable to this — the variance issue
 * with strongly-typed handler signatures is sidestepped by typing `handler`
 * as the most-permissive shape.
 */
export interface DispatchableRoute {
  path: string
  method: string
  params?: z.ZodType<unknown>
  query?: z.ZodType<unknown>
  body?: BodySpec<unknown>
  responses?: Partial<Record<string | number, ResponseSpec>>
  handler: (req: Request, ctx: any, parsed?: any) => Response | Promise<Response>
}

export interface DispatchInput {
  req: Request
  ctx: unknown
  route: DispatchableRoute
  params: Record<string, string>
}

export async function dispatchRoute(input: DispatchInput): Promise<Response> {
  const { req, ctx, route, params: pathParams } = input
  const url = new URL(req.url)

  const bodySpec = route.body as BodySpec<unknown> | undefined
  const responses = route.responses as Partial<Record<string, ResponseSpec>> | undefined

  // ─── 2. Body content-type gate ──────────────────────────────────────────
  if (bodySpec && typeof bodySpec === 'object' && 'contentType' in bodySpec
    && bodySpec.contentType === 'none') {
    if (!(await isEmptyBody(req))) {
      return jsonError(415, 'this route does not accept a request body')
    }
  }

  // ─── 3. Parse path params ────────────────────────────────────────────────
  let parsedParams: unknown
  if (route.params) {
    const r = (route.params as z.ZodType).safeParse(pathParams)
    if (!r.success) return jsonError(400, 'invalid input', r.error.issues)
    parsedParams = r.data
  }

  // ─── 4. Parse query ──────────────────────────────────────────────────────
  let parsedQuery: unknown
  if (route.query) {
    // Preserve repeated keys as arrays — `?facet=a&facet=b` becomes
    // { facet: ['a', 'b'] }. Single occurrences become scalars so the
    // common case (`z.string()`) doesn't trip on a one-element array.
    const queryObj: Record<string, string | string[]> = {}
    for (const key of new Set([...url.searchParams.keys()])) {
      const all = url.searchParams.getAll(key)
      queryObj[key] = all.length === 1 ? all[0] : all
    }
    const r = (route.query as z.ZodType).safeParse(queryObj)
    if (!r.success) return jsonError(400, 'invalid input', r.error.issues)
    parsedQuery = r.data
  }

  // ─── 5. Parse body ───────────────────────────────────────────────────────
  let parsedBody: unknown
  if (bodySpec) {
    const result = await parseBodySpec(req, bodySpec)
    if (!result.ok) return jsonError(result.status, result.error, result.issues)
    parsedBody = result.value
  }

  // ─── 6. Build the parsed object the handler receives ────────────────────
  const parsed: Record<string, unknown> = {}
  if (parsedParams !== undefined) parsed.params = parsedParams
  if (parsedQuery !== undefined) parsed.query = parsedQuery
  if (parsedBody !== undefined) parsed.body = parsedBody

  // ─── 7. Legacy compat: inject path params into searchParams so handlers
  // that read `url.searchParams.get('foo')` continue to work alongside
  // those using `parsed.params.foo`. Removed in T20+ once every handler
  // is migrated to the typed parsed argument.
  let dispatchReq = req
  if (Object.keys(pathParams).length > 0) {
    const newUrl = new URL(req.url)
    for (const [key, value] of Object.entries(pathParams)) {
      if (!newUrl.searchParams.has(key)) newUrl.searchParams.set(key, value)
    }
    dispatchReq = new Request(newUrl.toString(), {
      method: req.method,
      headers: req.headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
      // @ts-expect-error duplex needed for streaming bodies
      duplex: 'half',
    })
  }

  // ─── 8. Invoke handler ───────────────────────────────────────────────────
  const res = await route.handler(dispatchReq, ctx as any, parsed as any)

  // ─── 9. Validate response in dev / test ─────────────────────────────────
  if (shouldValidateResponses() && responses) {
    await validateResponse(res, responses, {
      method: route.method,
      path: route.path,
      url: req.url,
    })
  }

  return res
}

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

interface BodyOk { ok: true; value: unknown }
interface BodyErr { ok: false; status: number; error: string; issues?: unknown[] }

const VALID_BODY_CONTENT_TYPES = ['application/json', 'multipart/form-data', '*/*', 'none'] as const

/**
 * Loudly reject malformed `body` specs. A typo'd contentType (`'json'`)
 * previously fell through parseBodySpec as a silent pass-through with an
 * undefined parsed body — the handler then read `parsed.body.title` off
 * undefined at request time with no hint why. Definition/registration time
 * is the right place to fail: defineRoute/defineCoreRoute call this at
 * module eval, and the plugin registry calls it for bare-literal routes at
 * activation. `label` names the route in the error (e.g. `POST /items`).
 */
export function assertValidBodySpec(body: unknown, label: string): void {
  if (body === undefined || body === null) return
  if (isZodType(body)) return
  if (typeof body !== 'object' || !('contentType' in body)) {
    throw new Error(`route ${label}: body spec must be a zod schema or declare a contentType (got ${JSON.stringify(body)})`)
  }
  const ct = (body as { contentType: unknown }).contentType
  if (!VALID_BODY_CONTENT_TYPES.includes(ct as (typeof VALID_BODY_CONTENT_TYPES)[number])) {
    throw new Error(
      `route ${label}: unknown body contentType '${String(ct)}' — valid values: ${VALID_BODY_CONTENT_TYPES.join(', ')}`,
    )
  }
  if (ct === 'application/json' && !isZodType((body as { schema?: unknown }).schema)) {
    throw new Error(`route ${label}: contentType 'application/json' requires a zod schema`)
  }
}

async function parseBodySpec(req: Request, body: BodySpec<unknown>): Promise<BodyOk | BodyErr> {
  // Zod shorthand → JSON
  if (isZodType(body)) return parseJsonBody(req, body)

  if ('contentType' in body) {
    if (body.contentType === 'none') return { ok: true, value: undefined }
    if (body.contentType === 'application/json') return parseJsonBody(req, body.schema)
    if (body.contentType === 'multipart/form-data' || body.contentType === '*/*') {
      // Pass through; handler reads req.formData() / req.body itself.
      return { ok: true, value: undefined }
    }
  }
  // Unreachable for routes that passed assertValidBodySpec; loud for smuggled specs.
  return {
    ok: false,
    status: 500,
    error: `unknown body contentType '${String((body as { contentType?: unknown }).contentType)}' — route was registered without validation`,
  }
}

async function parseJsonBody(req: Request, schema: z.ZodType<unknown>): Promise<BodyOk | BodyErr> {
  const ct = (req.headers.get('content-type') ?? '').toLowerCase()
  if (ct && !ct.startsWith('application/json')) {
    return { ok: false, status: 415, error: 'expected application/json body' }
  }
  if (await isEmptyBody(req)) {
    const empty = schema.safeParse(undefined)
    if (empty.success) return { ok: true, value: empty.data }
  }
  let raw: unknown
  try {
    raw = await req.clone().json()
  } catch {
    return { ok: false, status: 400, error: 'invalid input', issues: [{ message: 'malformed JSON body' }] }
  }
  const r = schema.safeParse(raw)
  if (!r.success) return { ok: false, status: 400, error: 'invalid input', issues: r.error.issues }
  return { ok: true, value: r.data }
}

async function isEmptyBody(req: Request): Promise<boolean> {
  // GET / HEAD never carry a body.
  if (req.method === 'GET' || req.method === 'HEAD') return true
  const cl = req.headers.get('content-length')
  if (cl === '0') return true
  if (cl === null && !req.headers.has('transfer-encoding') && !req.headers.has('content-type')) return true
  // Read the body; empty buffers count as no body.
  try {
    const buf = await req.clone().arrayBuffer()
    return buf.byteLength === 0
  } catch {
    return true
  }
}

// ---------------------------------------------------------------------------
// Response validation
// ---------------------------------------------------------------------------

function shouldValidateResponses(): boolean {
  return process.env.NODE_ENV !== 'production'
}

async function validateResponse(
  res: Response,
  responses: Partial<Record<string, ResponseSpec>>,
  context: { method: string; path: string; url: string },
): Promise<void> {
  const statusKey = String(res.status)
  const spec = responses[statusKey]
  if (spec === undefined) {
    // Allow auto-emitted error responses (400/415) to skip validation —
    // the dispatcher emits these with the global error envelope shape.
    if (statusKey === '400' || statusKey === '415') return
    fail(`undeclared response status ${statusKey}`, context)
    return
  }
  // Zod shorthand → validate JSON
  if (isZodType(spec)) return validateJsonResponse(res, spec, statusKey, context)
  if (spec.contentType === 'none') return
  if (spec.contentType === 'application/json') {
    const json = spec as { contentType: 'application/json'; schema: z.ZodType<unknown> }
    return validateJsonResponse(res, json.schema, statusKey, context)
  }
  // NonJson — no validation.
}

async function validateJsonResponse(
  res: Response,
  schema: z.ZodType<unknown>,
  statusKey: string,
  context: { method: string; path: string; url: string },
): Promise<void> {
  let body: unknown
  try {
    body = await res.clone().json()
  } catch {
    fail(`response ${statusKey}: expected JSON body but parse failed`, context)
    return
  }
  const r = schema.safeParse(body)
  if (!r.success) {
    fail(`response ${statusKey} body did not match schema: ${formatIssues(r.error.issues)}`, context)
  }
}

function fail(message: string, context: { method: string; path: string; url: string }): void {
  const scoped = `${context.method.toUpperCase()} ${context.path} (${context.url}): ${message}`
  if (process.env.NODE_ENV === 'test' || (process.env as Record<string, string>).VITEST) {
    throw new Error(scoped)
  }
  log.warn(scoped)
}

function formatIssues(issues: unknown[]): string {
  try {
    return issues
      .map(i => {
        const issue = i as { path?: unknown[]; message?: string }
        const path = (issue.path ?? []).join('.')
        return `${path}: ${issue.message ?? 'unknown'}`
      })
      .join('; ')
  } catch {
    return JSON.stringify(issues)
  }
}

// ---------------------------------------------------------------------------
// Error response helpers
// ---------------------------------------------------------------------------

function jsonError(status: number, error: string, issues?: unknown[]): Response {
  return Response.json(errorResponseBody(error, issues), { status })
}

// ---------------------------------------------------------------------------
// Zod type guard
// ---------------------------------------------------------------------------

function isZodType(value: unknown): value is z.ZodType<unknown> {
  if (!value || typeof value !== 'object') return false
  // Zod 4 instances expose a `_zod` brand.
  return value instanceof z.ZodType || (
    typeof (value as { _zod?: unknown })._zod === 'object'
    && (value as { _zod?: unknown })._zod !== null
  )
}
