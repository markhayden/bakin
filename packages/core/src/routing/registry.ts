/**
 * Route registry — single source of truth for HTTP route dispatch.
 *
 * Routes register here at boot (core first, then plugins, then user plugins).
 * The dispatcher (T4) looks up routes by <method, url> against this table.
 * Docs generation reads `all()` to emit OpenAPI from the in-memory registry.
 *
 * Path matching uses radix-style precedence: literal segments beat `:param`,
 * and `:param` beats wildcards. Duplicates throw at registration so boot
 * fails loudly on a misconfiguration rather than silently shadowing.
 */

import type { APIRoute, HttpMethod, RouteContext } from './types'
import { operationIdFor } from './operation-id'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RouteScope =
  | { scope: 'core'; route: APIRoute<any, any, any, any> }
  | { scope: 'plugin'; pluginId: string; route: APIRoute<any, any, any, any> }

/** A route as stored in the registry, with derived metadata. */
export interface RegisteredRoute {
  route: APIRoute<RouteContext, any, any, any>
  scope: 'core' | string                  // 'core' or pluginId
  fullPath: string                        // resolved (plugin routes are prefixed)
  operationId: string                     // declared or derived
}

export interface RouteMatch {
  route: APIRoute<RouteContext, any, any, any>
  scope: 'core' | string
  fullPath: string
  operationId: string
  params: Record<string, string>
}

// ---------------------------------------------------------------------------
// Path segments + matching
// ---------------------------------------------------------------------------

type Segment =
  | { kind: 'literal'; value: string }
  | { kind: 'param'; name: string }
  | { kind: 'wildcard' }                 // matches the rest of the path

function parseSegments(path: string): Segment[] {
  return path
    .split('/')
    .filter(Boolean)
    .map(seg => {
      if (seg === '*' || seg.startsWith('...')) return { kind: 'wildcard' as const }
      if (seg.startsWith(':')) return { kind: 'param' as const, name: seg.slice(1) }
      if (seg.startsWith('{') && seg.endsWith('}')) {
        return { kind: 'param' as const, name: seg.slice(1, -1) }
      }
      return { kind: 'literal' as const, value: seg }
    })
}

interface IndexedRoute {
  registered: RegisteredRoute
  segments: Segment[]
  /** Specificity score: literal segments add 2 points, params 1, wildcards 0. */
  score: number
}

function specificityScore(segments: Segment[]): number {
  let score = 0
  for (const seg of segments) {
    if (seg.kind === 'literal') score += 2
    else if (seg.kind === 'param') score += 1
  }
  return score
}

function matchSegments(
  pathSegments: string[],
  routeSegments: Segment[],
): Record<string, string> | null {
  // Wildcards consume remaining segments. Otherwise lengths must match.
  const lastIsWildcard = routeSegments.length > 0 && routeSegments[routeSegments.length - 1].kind === 'wildcard'
  if (!lastIsWildcard && pathSegments.length !== routeSegments.length) return null
  if (lastIsWildcard && pathSegments.length < routeSegments.length - 1) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < routeSegments.length; i++) {
    const rseg = routeSegments[i]
    if (rseg.kind === 'wildcard') return params           // matched everything left
    const pseg = pathSegments[i]
    if (rseg.kind === 'literal') {
      if (rseg.value !== pseg) return null
    } else {
      params[rseg.name] = pseg
    }
  }
  return params
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class RouteRegistry {
  private byMethod: Map<HttpMethod, IndexedRoute[]> = new Map()
  private operationIds: Set<string> = new Set()
  private fullPaths: Set<string> = new Set()

  /**
   * Register a route. Throws on duplicate <method, fullPath> or operationId.
   */
  register(input: RouteScope): RegisteredRoute {
    const { route } = input
    const pluginId = input.scope === 'plugin' ? input.pluginId : null
    const fullPath = pluginId !== null
      ? `/api/plugins/${pluginId}${route.path}`
      : route.path
    const operationId = route.operationId
      ?? operationIdFor(pluginId ?? 'core', route.method, route.path)

    const dupKey = `${route.method} ${fullPath}`
    if (this.fullPaths.has(dupKey)) {
      throw new Error(`duplicate route registration: ${dupKey}`)
    }
    if (this.operationIds.has(operationId)) {
      throw new Error(`duplicate operationId: ${operationId} (route: ${dupKey})`)
    }
    this.fullPaths.add(dupKey)
    this.operationIds.add(operationId)

    const segments = parseSegments(fullPath)
    const indexed: IndexedRoute = {
      registered: {
        route: route as APIRoute<RouteContext, any, any, any>,
        scope: pluginId ?? 'core',
        fullPath,
        operationId,
      },
      segments,
      score: specificityScore(segments),
    }

    let bucket = this.byMethod.get(route.method)
    if (!bucket) {
      bucket = []
      this.byMethod.set(route.method, bucket)
    }
    bucket.push(indexed)
    // Most-specific first so match() returns the right route.
    bucket.sort((a, b) => b.score - a.score)

    return indexed.registered
  }

  /**
   * Match a request against the registered routes. Returns the most specific
   * match or null. Path is the full URL pathname (e.g., `/api/plugins/tasks/abc`).
   */
  match(method: string, path: string): RouteMatch | null {
    const bucket = this.byMethod.get(method as HttpMethod)
    if (!bucket) return null
    const normalized = path.replace(/\/+$/, '') || '/'
    const pathSegments = normalized.split('/').filter(Boolean)
    for (const indexed of bucket) {
      const params = matchSegments(pathSegments, indexed.segments)
      if (params !== null) {
        return {
          ...indexed.registered,
          params,
        }
      }
    }
    return null
  }

  /** Return every registered route. Used by docs generation. */
  all(): RegisteredRoute[] {
    const out: RegisteredRoute[] = []
    for (const bucket of this.byMethod.values()) {
      for (const entry of bucket) out.push(entry.registered)
    }
    return out
  }

  /** Reset state. Tests must call this in beforeEach when reusing the registry. */
  clear(): void {
    this.byMethod.clear()
    this.operationIds.clear()
    this.fullPaths.clear()
  }
}
