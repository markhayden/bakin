import type { ActivityClass } from '@makinbakin/sdk/types'

export interface ActivityRouteMetadata {
  path: string
  method: string
  activityClass?: ActivityClass
}

type PluginRouteLookup = (pluginId: string) => readonly ActivityRouteMetadata[]

const HOST_ROUTINE_GET_PATHS = new Set([
  '/api/agents/health',
  '/api/dispatch',
  '/api/plugins/manifest',
  '/api/update/status',
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
  const method = (rawMethod ?? 'GET').toUpperCase()
  const pluginMatch = pathname.match(/^\/api\/plugins\/([^/]+)(\/.*)?$/)
  if (pluginMatch) {
    const [, pluginId, rawSubpath] = pluginMatch
    const declared = declaredRouteActivityClass(
      pluginRoutes(pluginId),
      rawSubpath || '/',
      method,
    )
    if (declared) return declared
  }

  if (method === 'GET') {
    if (HOST_ROUTINE_GET_PATHS.has(pathname)) return 'routine'

    const agentStatus = pathname.match(/^\/api\/agents\/([^/]+)(?:\/status)?$/)
    if (agentStatus && !NON_STATUS_AGENT_SEGMENTS.has(agentStatus[1])) return 'routine'
  }

  return 'user'
}

function declaredRouteActivityClass(
  routes: readonly ActivityRouteMetadata[],
  requestPath: string,
  method: string,
): ActivityClass | null {
  // Keep metadata resolution identical to request dispatch: exact routes win
  // even when a parameter route was registered first.
  const exact = routes.find((route) => (
    route.method.toUpperCase() === method && route.path === requestPath
  ))
  if (exact) return exact.activityClass ?? null

  const parameterized = routes.find((route) => (
    route.method.toUpperCase() === method && routePathMatches(route.path, requestPath)
  ))
  return parameterized?.activityClass ?? null
}

function routePathMatches(declaredPath: string, requestPath: string): boolean {
  const declared = declaredPath.split('/').filter(Boolean)
  const requested = requestPath.split('/').filter(Boolean)
  return declared.length === requested.length && declared.every((segment, index) => (
    segment.startsWith(':') || segment === requested[index]
  ))
}
