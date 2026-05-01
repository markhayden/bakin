/**
 * Route-contract validator (T5).
 *
 * Walks declarative routes and reports public-route schema gaps. The
 * caller (`scripts/docs/route-contract-check.ts`) invokes this with the
 * bundled surface (in-repo plugins + coreRoutes); during the migration
 * window (T6–T16) findings are warnings (exit 0). At T18 the mode flips
 * to `error` and the validator fails CI on any unmigrated route.
 *
 * Internal routes (`visibility: 'internal'`) are exempt regardless of
 * stability. Multipart and raw-content bodies are allowed without
 * schemas (binary uploads).
 */

import type { z } from 'zod'
import type { APIRoute, BodySpec, ResponseSpec } from '../../packages/core/src/routing/types'

export interface RouteFinding {
  scope: 'core' | string
  method: string
  path: string
  issue: string
}

export interface ValidatorInput {
  /** Map of pluginId → declarative routes. Empty arrays are ignored. */
  pluginRoutes: Record<string, ReadonlyArray<APIRoute<any, any, any, any>>>
  /** Core (host) routes from `packages/host/src/core-routes`. Empty until T14. */
  coreRoutes: ReadonlyArray<APIRoute<any, any, any, any>>
  /** Plugin IDs whose routes should be exempt entirely (e.g., extracted plugins). */
  exemptPlugins?: ReadonlyArray<string>
  /** `warn` (default) → findings go to `warnings`; `error` → findings go to `errors`. */
  mode?: 'warn' | 'error'
}

export interface ValidatorResult {
  errors: RouteFinding[]
  warnings: RouteFinding[]
}

export function validateRouteContracts(input: ValidatorInput): ValidatorResult {
  const findings: RouteFinding[] = []
  const exempt = new Set(input.exemptPlugins ?? [])
  const isError = input.mode === 'error'

  for (const route of input.coreRoutes) {
    findings.push(...checkRoute(route, 'core'))
  }
  for (const [pluginId, routes] of Object.entries(input.pluginRoutes)) {
    if (exempt.has(pluginId)) continue
    for (const route of routes) {
      findings.push(...checkRoute(route, pluginId))
    }
  }

  return isError
    ? { errors: findings, warnings: [] }
    : { errors: [], warnings: findings }
}

function checkRoute(
  route: APIRoute<any, any, any, any>,
  scope: 'core' | string,
): RouteFinding[] {
  if (route.visibility === 'internal') return []
  const out: RouteFinding[] = []

  // 1. :param paths require a params schema.
  const placeholders = (route.path.match(/:([A-Za-z_][\w]*)/g) ?? [])
  if (placeholders.length > 0 && !route.params) {
    out.push({
      scope,
      method: route.method,
      path: route.path,
      issue: `path has ${placeholders.length} :param segment(s) but no params schema`,
    })
  }

  // 2. body declarations that are JSON-flavored need a schema.
  if (route.body) {
    const issue = checkBody(route.body as BodySpec<unknown>)
    if (issue) {
      out.push({ scope, method: route.method, path: route.path, issue })
    }
  }

  // 3. At least one declared 2xx response.
  const responses = (route.responses ?? {}) as Partial<Record<string | number, ResponseSpec>>
  const has2xx = Object.keys(responses).some(k => /^2\d{2}$/.test(String(k)))
  if (!has2xx) {
    out.push({
      scope,
      method: route.method,
      path: route.path,
      issue: 'no 2xx response declared',
    })
  } else {
    // 4. JSON 2xx responses need a schema.
    for (const [statusKey, spec] of Object.entries(responses)) {
      if (!/^2\d{2}$/.test(String(statusKey))) continue
      if (!spec) continue
      const issue = checkResponseJsonHasSchema(spec as ResponseSpec, statusKey)
      if (issue) out.push({ scope, method: route.method, path: route.path, issue })
    }
  }

  return out
}

function checkBody(body: BodySpec<unknown>): string | null {
  if (isZodLike(body)) return null  // shorthand JSON: schema present
  if ('contentType' in body) {
    if (body.contentType === 'application/json') {
      if (!body.schema) return 'body declares application/json without schema'
      return null
    }
    if (body.contentType === 'none') return null
    if (body.contentType === 'multipart/form-data' || body.contentType === '*/*') return null
    // Unrecognized content type — pass through.
    return null
  }
  return null
}

function checkResponseJsonHasSchema(spec: ResponseSpec, statusKey: string): string | null {
  if (isZodLike(spec)) return null
  if ('contentType' in spec) {
    if (spec.contentType === 'application/json') {
      if (!('schema' in spec) || !spec.schema) {
        return `response ${statusKey} declares application/json without schema`
      }
      return null
    }
  }
  return null
}

function isZodLike(value: unknown): value is z.ZodType<unknown> {
  if (!value || typeof value !== 'object') return false
  // Zod 4 instances expose a `_zod` brand.
  const v = value as { _zod?: unknown; parse?: unknown }
  return typeof v._zod === 'object' || typeof v.parse === 'function'
}
