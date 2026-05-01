/**
 * Legacy /api/docs adapter.
 *
 * Pre-T17 this module hand-listed every core route in CORE_ROUTES. After
 * T17 the source of truth is `packages/host/src/core-routes/index.ts` —
 * this file reshapes those entries into the legacy `RouteDoc` shape that
 * the CLI (`bakin plugins list`, `bakin docs`) and `/api/docs` consumers
 * still expect. After downstream consumers migrate to /api/openapi this
 * module can be deleted entirely.
 */
import type { APIRoute } from '../../packages/core/src/plugin-types'
import type { ContractStability, ContractVisibility, DocsExample, SchemaLike, SourceLocation } from '../../packages/core/src/docs'
import { coreRoutes } from '../../packages/host/src/core-routes'

export interface RouteDoc {
  pluginId: string
  method: string
  path: string
  fullPath: string
  summary: string
  description?: string
  params?: string
  /** Legacy fields; kept for compatibility with the docs generator. */
  input?: SchemaLike
  output?: SchemaLike
  examples?: DocsExample[]
  source?: SourceLocation
  visibility: ContractVisibility
  stability: ContractStability
  permissions?: string[]
}

const routeDocs: RouteDoc[] = []

/** Tests call this between cases — bun:test has no vi.resetModules equivalent. */
export function _resetRouteDocsForTests(): void {
  routeDocs.length = 0
}

/**
 * Register a plugin route for documentation. Kept for backward compat with
 * any caller that still pushes plugin route metadata via this surface.
 * Plugin routes registered through `definePlugin({ routes })` are surfaced
 * through `pluginRegistry.getAllPluginRoutes()` instead.
 */
export function registerRouteDoc(pluginId: string, route: Pick<APIRoute, 'path' | 'method' | 'summary' | 'description' | 'params' | 'visibility' | 'stability' | 'permissions'>): void {
  const summary = route.summary ?? route.description ?? `${route.method} ${route.path}`
  routeDocs.push({
    pluginId,
    method: route.method,
    path: route.path,
    fullPath: `/api/plugins/${pluginId}${route.path}`,
    summary,
    description: route.description,
    params: route.params,
    visibility: route.visibility ?? 'public',
    stability: route.stability ?? 'stable',
    permissions: route.permissions,
  })
}

/**
 * Reshape coreRoutes (T14–T16) into the legacy RouteDoc shape so the
 * `/api/docs` CLI surface keeps working. Combined with any
 * `registerRouteDoc()`-registered entries.
 */
export function getAllRoutes(): RouteDoc[] {
  const coreShaped: RouteDoc[] = coreRoutes.map(route => ({
    pluginId: 'core',
    method: route.method,
    path: route.path,
    fullPath: route.path,
    summary: route.summary ?? route.description ?? `${route.method} ${route.path}`,
    description: route.description,
    visibility: route.visibility ?? 'public',
    stability: route.stability ?? 'stable',
    permissions: route.permissions,
  }))
  return [...coreShaped, ...routeDocs]
}

/**
 * Removed in T17: `generateDocs(contentDir)` previously wrote a markdown
 * file at `~/.bakin/docs/API.md`. The docs site is the canonical view.
 * This stub stays only because some callers may still import the symbol.
 */
export function generateDocs(_contentDir: string): void {
  // no-op
}
