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
import type { RegisteredAPIRoute } from '../../packages/core/src/plugin-types'
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
 * Register a plugin route for documentation on the `/api/docs` surface.
 * Called for declarative `definePlugin({ routes })` entries at activation
 * (plugin-registry.registerDeclarativeRoutes) and for the search auto-route.
 * Re-registration (hot reload) REPLACES the (pluginId, method, path) entry —
 * the list must not grow per reload cycle — and `removeRouteDocsByPlugin`
 * sweeps a plugin's entries on deactivation/failed activation.
 */
export function registerRouteDoc(pluginId: string, route: Pick<RegisteredAPIRoute, 'path' | 'method' | 'summary' | 'description' | 'params' | 'visibility' | 'stability' | 'permissions'>): void {
  const summary = route.summary ?? route.description ?? `${route.method} ${route.path}`
  const existing = routeDocs.findIndex(
    (d) => d.pluginId === pluginId && d.method === route.method && d.path === route.path,
  )
  if (existing >= 0) routeDocs.splice(existing, 1)
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

/** Sweep a plugin's route docs (deactivation, uninstall, failed activation). */
export function removeRouteDocsByPlugin(pluginId: string): number {
  let removed = 0
  for (let i = routeDocs.length - 1; i >= 0; i--) {
    if (routeDocs[i].pluginId === pluginId) {
      routeDocs.splice(i, 1)
      removed++
    }
  }
  return removed
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
