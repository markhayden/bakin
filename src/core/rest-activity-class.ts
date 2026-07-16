import type { ActivityClass } from '@makinbakin/sdk/types'

export interface ActivityRouteMetadata {
  path: string
  method: string
  activityClass?: ActivityClass
}

type PluginRouteLookup = (pluginId: string) => readonly ActivityRouteMetadata[]

export interface ResolvedRequestActivity {
  activityClass: ActivityClass
  /** Canonical registered plugin route, when the request matched one. */
  routePattern?: string
}

const HOST_ROUTINE_GET_PATHS = new Set([
  '/api/activity',
  '/api/agent-packages',
  '/api/agents/health',
  '/api/context-report',
  '/api/dispatch',
  '/api/plugins/manifest',
  '/api/settings',
  '/api/state',
  '/api/update/status',
  '/api/version',
])

// The messaging plugin is installed outside this repository, so its shell
// badge endpoint cannot declare route metadata alongside the core plugins.
const EXTERNAL_PLUGIN_ROUTINE_GET_PATHS = new Set([
  '/api/plugins/messaging/plans/summary',
])

const NON_STATUS_AGENT_SEGMENTS = new Set([
  'avatar',
  'health',
  'settings',
])

/**
 * Classify an HTTP request at its producer boundary.
 *
 * Declarative route metadata wins. Host-owned cadence routes are enumerated
 * here because they have no APIRoute declaration; all other requests are
 * explicitly foreground work at this boundary.
 */
export function resolveRequestActivityClass(
  rawMethod: string | undefined,
  pathname: string,
  pluginRoutes: PluginRouteLookup = () => [],
): ActivityClass {
  return resolveRequestActivity(rawMethod, pathname, pluginRoutes).activityClass
}

/**
 * Resolve request intent plus additive route metadata for stable usage
 * grouping. The raw request path remains the usage entry name; only a route
 * that actually wins dispatch matching contributes a canonical pattern.
 */
export function resolveRequestActivity(
  rawMethod: string | undefined,
  pathname: string,
  pluginRoutes: PluginRouteLookup = () => [],
): ResolvedRequestActivity {
  const method = (rawMethod ?? 'GET').toUpperCase()
  if (method === 'GET' && (
    /^\/api\/plugins\/[^/]+\/assets\//.test(pathname)
    || /^\/api\/plugin-settings\/[^/]+$/.test(pathname)
  )) return { activityClass: 'routine' }

  let routePattern: string | undefined
  const pluginMatch = pathname.match(/^\/api\/plugins\/([^/]+)(\/.*)?$/)
  if (pluginMatch) {
    const [, pluginId, rawSubpath] = pluginMatch
    const declared = matchDeclaredRoute(
      pluginRoutes(pluginId),
      rawSubpath || '/',
      method,
    )
    if (declared) {
      const declaredPath = declared.path === '/' ? '' : declared.path
      routePattern = `/api/plugins/${pluginId}${declaredPath}`
      if (declared.activityClass) return { activityClass: declared.activityClass, routePattern }
    }
  }

  if (method === 'GET') {
    if (EXTERNAL_PLUGIN_ROUTINE_GET_PATHS.has(pathname)) return { activityClass: 'routine', ...(routePattern ? { routePattern } : {}) }
    if (HOST_ROUTINE_GET_PATHS.has(pathname)) return { activityClass: 'routine', ...(routePattern ? { routePattern } : {}) }

    const agentStatus = pathname.match(/^\/api\/agents\/([^/]+)(?:\/status)?$/)
    if (agentStatus && !NON_STATUS_AGENT_SEGMENTS.has(agentStatus[1])) {
      return { activityClass: 'routine', ...(routePattern ? { routePattern } : {}) }
    }
  }

  return { activityClass: 'user', ...(routePattern ? { routePattern } : {}) }
}

function matchDeclaredRoute(
  routes: readonly ActivityRouteMetadata[],
  requestPath: string,
  method: string,
): ActivityRouteMetadata | null {
  // Keep metadata resolution identical to request dispatch: exact routes win
  // even when a parameter route was registered first.
  const exact = routes.find((route) => (
    route.method.toUpperCase() === method && route.path === requestPath
  ))
  if (exact) return exact

  const parameterized = routes.find((route) => (
    route.method.toUpperCase() === method && routePathMatches(route.path, requestPath)
  ))
  return parameterized ?? null
}

function routePathMatches(declaredPath: string, requestPath: string): boolean {
  const declared = declaredPath.split('/').filter(Boolean)
  const requested = requestPath.split('/').filter(Boolean)
  return declared.length === requested.length && declared.every((segment, index) => (
    segment.startsWith(':') || segment === requested[index]
  ))
}
