/**
 * Build a single OpenAPI 3.1 Operation object from an `APIRoute<...>`.
 *
 * Pure function: takes a typed route plus scope/full-path and returns the
 * Operation. Used by both the static docs build (`scripts/docs/generate.ts`)
 * and the runtime `/api/docs` builder.
 */

import { z } from 'zod'
import type { BodySpec, ResponseSpec } from '../routing/types'
import { operationIdFor } from '../routing/operation-id'
import { zodToOpenApi, type OpenApiSchema } from './zod-to-openapi'
import { globalErrorResponses } from './errors'

/**
 * `buildOperation` accepts any APIRoute regardless of bound context, since it
 * only reads schemas and metadata — it never invokes the handler. We use this
 * loose alias to sidestep the contravariant handler-context type check.
 *
 * The shape also accepts the *legacy* `APIRoute` fields (`input`, `output`,
 * `description`) so the runtime OpenAPI builder can include unmigrated
 * routes. Adapter mapping: `input → body` (assumed application/json),
 * `output → responses[200]`. Legacy routes register through
 * `ctx.registerRoute(...)` during the migration window (T1–T16).
 */
interface AnyAPIRoute {
  path: string
  method: string
  summary: string
  description?: string
  params?: z.ZodType<unknown>
  query?: z.ZodType<unknown>
  body?: unknown
  responses?: Partial<Record<string | number, ResponseSpec>>
  visibility?: string
  stability?: string
  permissions?: string[]
  examples?: unknown[]
  operationId?: string
  tags?: string[]
  // Legacy fields (migration window only)
  input?: z.ZodType<unknown>
  output?: z.ZodType<unknown>
}

export interface OpenApiOperation {
  operationId: string
  summary: string
  description?: string
  tags?: string[]
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses: Record<string, OpenApiResponse>
  security?: Array<Record<string, string[]>>
  // x-extensions
  [key: `x-${string}`]: unknown
}

export interface OpenApiParameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required: boolean
  description?: string
  schema?: OpenApiSchema
}

export interface OpenApiRequestBody {
  description?: string
  required?: boolean
  content: Record<string, { schema?: OpenApiSchema; example?: unknown }>
}

export interface OpenApiResponse {
  description: string
  content?: Record<string, { schema?: OpenApiSchema; example?: unknown }>
}

export interface BuildOperationContext {
  scope: 'core' | string
  fullPath: string
  /** Optional tag override; defaults to scope-derived. */
  tag?: string
}

export function buildOperation(
  route: AnyAPIRoute,
  ctx: BuildOperationContext,
): OpenApiOperation {
  const operationId = route.operationId
    ?? operationIdFor(ctx.scope, route.method, route.path)

  const parameters: OpenApiParameter[] = [
    ...pathParameters(route),
    ...queryParameters(route),
  ]

  const operation: OpenApiOperation = {
    operationId,
    summary: route.summary,
    responses: buildResponses(route),
    tags: route.tags ?? [defaultTag(ctx)],
  }
  if (route.description) operation.description = route.description
  if (parameters.length) operation.parameters = parameters
  const requestBody = buildRequestBody(route)
  if (requestBody) operation.requestBody = requestBody
  if (route.permissions?.length) {
    operation.security = [{ pluginPermissions: route.permissions }]
  }
  if (route.visibility) operation['x-bakin-visibility'] = route.visibility
  if (route.stability) operation['x-bakin-stability'] = route.stability
  operation['x-bakin-full-path'] = ctx.fullPath
  return operation
}

function defaultTag(ctx: BuildOperationContext): string {
  if (ctx.tag) return ctx.tag
  if (ctx.scope === 'core') return 'Core'
  // Capitalize first letter of plugin id; callers can override with explicit tags.
  return ctx.scope.charAt(0).toUpperCase() + ctx.scope.slice(1)
}

function pathParameters(route: AnyAPIRoute): OpenApiParameter[] {
  const placeholders = (route.path.match(/:([A-Za-z_][\w]*)/g) ?? [])
    .map(s => s.slice(1))
  if (placeholders.length === 0) return []

  // Pull per-property schemas out of the params Zod object if present.
  const paramShapes = extractObjectShapeSchemas(route.params)
  return placeholders.map(name => {
    const schema = paramShapes[name]
    return {
      name,
      in: 'path' as const,
      required: true,
      schema: schema ? zodToOpenApi(schema) : { type: 'string' },
    }
  })
}

function queryParameters(route: AnyAPIRoute): OpenApiParameter[] {
  if (!route.query) return []
  const shapes = extractObjectShapeSchemas(route.query)
  const optionalKeys = extractOptionalKeys(route.query)
  return Object.entries(shapes).map(([name, schema]) => ({
    name,
    in: 'query' as const,
    required: !optionalKeys.has(name),
    schema: zodToOpenApi(schema),
  }))
}

function buildRequestBody(
  route: AnyAPIRoute,
): OpenApiRequestBody | undefined {
  // Adapter: legacy `input` (no `body`) → JSON body schema.
  const body = (route.body as BodySpec<unknown> | undefined)
    ?? (route.input ? (route.input as unknown as BodySpec<unknown>) : undefined)
  if (!body) return undefined
  // Zod shorthand → JSON
  if (isZodType(body)) {
    return {
      required: true,
      content: {
        'application/json': { schema: zodToOpenApi(body) },
      },
    }
  }
  if ('contentType' in body) {
    if (body.contentType === 'none') return undefined
    if (body.contentType === 'application/json') {
      return {
        required: true,
        content: {
          'application/json': { schema: zodToOpenApi(body.schema) },
        },
      }
    }
    if (body.contentType === 'multipart/form-data') {
      const schema = body.schema
        ? zodToOpenApi(body.schema)
        : { type: 'string', format: 'binary' }
      return {
        required: true,
        content: {
          'multipart/form-data': { schema },
        },
      }
    }
    if (body.contentType === '*/*') {
      const schema = body.schema
        ? zodToOpenApi(body.schema)
        : { type: 'string', format: 'binary' }
      return {
        required: true,
        content: {
          '*/*': { schema },
        },
      }
    }
  }
  return undefined
}

function buildResponses(
  route: AnyAPIRoute,
): Record<string, OpenApiResponse> {
  // Adapter: legacy `output` (no `responses`) synthesizes a 200.
  const responsesMap: Partial<Record<string | number, ResponseSpec>> =
    route.responses ?? (route.output ? { 200: route.output as ResponseSpec } : {})
  const out: Record<string, OpenApiResponse> = {}
  for (const [statusKey, spec] of Object.entries(responsesMap)) {
    if (!spec) continue
    out[statusKey] = buildResponseSpec(spec as ResponseSpec, statusKey)
  }
  // Auto-emit global 400/415 from declared inputs.
  const effectiveBody = route.body ?? route.input
  const hasNoneBody = !!route.body
    && typeof route.body === 'object'
    && 'contentType' in (route.body as object)
    && (route.body as { contentType: string }).contentType === 'none'
  const globals = globalErrorResponses({
    hasInput: !!(route.params || route.query || effectiveBody),
    hasBody: !!effectiveBody && !hasNoneBody,
  })
  for (const [k, v] of Object.entries(globals)) {
    if (!out[k]) out[k] = v as OpenApiResponse
  }
  return out
}

function buildResponseSpec(spec: ResponseSpec, statusKey: string): OpenApiResponse {
  // Zod shorthand
  if (isZodType(spec)) {
    return {
      description: defaultResponseDescription(statusKey),
      content: { 'application/json': { schema: zodToOpenApi(spec) } },
    }
  }
  // NoContent
  if (spec.contentType === 'none') {
    return { description: defaultResponseDescription(statusKey) }
  }
  // JSON explicit
  if (spec.contentType === 'application/json') {
    const json = spec as { contentType: 'application/json'; schema: z.ZodType }
    return {
      description: defaultResponseDescription(statusKey),
      content: { 'application/json': { schema: zodToOpenApi(json.schema) } },
    }
  }
  // NonJson — the only remaining variant.
  const nonJson = spec as { contentType: string; schema?: z.ZodType }
  const schema = nonJson.schema
    ? zodToOpenApi(nonJson.schema)
    : { type: 'string', format: 'binary' }
  return {
    description: defaultResponseDescription(statusKey),
    content: { [nonJson.contentType]: { schema } },
  }
}

function defaultResponseDescription(statusKey: string): string {
  switch (statusKey) {
    case '200': return 'Successful response.'
    case '201': return 'Created.'
    case '202': return 'Accepted.'
    case '204': return 'No content.'
    case '301':
    case '302': return 'Redirect.'
    case '304': return 'Not modified.'
    case '400': return 'Invalid input.'
    case '401': return 'Unauthorized.'
    case '403': return 'Forbidden.'
    case '404': return 'Not found.'
    case '409': return 'Conflict.'
    case '410': return 'Gone.'
    case '415': return 'Unsupported media type.'
    case '422': return 'Unprocessable entity.'
    case '429': return 'Too many requests.'
    case '500': return 'Server error.'
    case '502': return 'Bad gateway.'
    case '503': return 'Service unavailable.'
    case '504': return 'Gateway timeout.'
    default: return `Response ${statusKey}.`
  }
}

// ---------------------------------------------------------------------------
// Zod introspection helpers
// ---------------------------------------------------------------------------

function isZodType(value: unknown): value is z.ZodType<unknown> {
  return !!value && typeof value === 'object' && (value instanceof z.ZodType || (
    typeof (value as { _zod?: unknown })._zod === 'object'
    && (value as { _zod?: unknown })._zod !== null
  ))
}

function unwrapZod(schema: z.ZodType<unknown>): z.ZodType<unknown> {
  // Strip ZodOptional / ZodDefault / ZodNullable to reach the inner type.
  let current: any = schema
  while (current?._def?.typeName === 'ZodOptional'
    || current?._def?.typeName === 'ZodDefault'
    || current?._def?.typeName === 'ZodNullable'
    || (typeof current?.def?.type === 'string'
      && (current.def.type === 'optional' || current.def.type === 'default' || current.def.type === 'nullable'))) {
    if (current?._def?.innerType) current = current._def.innerType
    else if (current?.def?.innerType) current = current.def.innerType
    else break
  }
  return current as z.ZodType<unknown>
}

function extractObjectShapeSchemas(
  schema?: z.ZodType<unknown>,
): Record<string, z.ZodType<unknown>> {
  if (!schema) return {}
  const inner = unwrapZod(schema) as any
  // Zod v4: `def.shape` for ZodObject.
  const shape = inner?.shape ?? inner?.def?.shape ?? inner?._def?.shape?.()
  if (!shape || typeof shape !== 'object') return {}
  return shape as Record<string, z.ZodType<unknown>>
}

function extractOptionalKeys(schema?: z.ZodType<unknown>): Set<string> {
  const keys = new Set<string>()
  if (!schema) return keys
  const shapes = extractObjectShapeSchemas(schema)
  for (const [name, fieldSchema] of Object.entries(shapes)) {
    if (isOptional(fieldSchema)) keys.add(name)
  }
  return keys
}

function isOptional(schema: z.ZodType<unknown>): boolean {
  const anyS: any = schema
  if (anyS?._def?.typeName === 'ZodOptional' || anyS?._def?.typeName === 'ZodDefault') return true
  if (anyS?.def?.type === 'optional' || anyS?.def?.type === 'default') return true
  // safeParse(undefined).success means the field accepts undefined.
  try {
    return schema.safeParse(undefined).success
  } catch {
    return false
  }
}
