/**
 * Runtime `/api/docs` builder (T5).
 *
 * Returns the current OpenAPI 3.1 document for the live process. Built
 * lazily on first request, cached for the process lifetime, and
 * invalidated on `dev:plugin:reload` SSE events (hot reload). Plugins
 * that haven't migrated to the declarative `routes` field yet show up
 * with their legacy `input`/`output` schemas via the buildOperation
 * adapter mapping (input → body, output → responses[200]).
 */

import { buildOperation, type OpenApiOperation } from '@bakin/core/openapi'
import { normalizeOpenApiPath } from '@bakin/core/openapi'
import { APP_VERSION } from '@bakin/core/constants'

export interface OpenApiDocument {
  openapi: '3.1.0'
  info: { title: string; version: string; description: string }
  servers: Array<{ url: string; description?: string }>
  tags: Array<{ name: string; description?: string }>
  paths: Record<string, Record<string, OpenApiOperation>>
  components: {
    securitySchemes: Record<string, unknown>
  }
}

interface RouteSource {
  scope: 'core' | string
  fullPath: string
  route: {
    path: string
    method: string
    summary?: string
    description?: string
    [key: string]: unknown
  }
  manifestDescription?: string
}

let cached: OpenApiDocument | null = null

export function invalidateDocsCache(): void {
  cached = null
}

export function buildOpenApiDocument(sources: ReadonlyArray<RouteSource>, port?: number): OpenApiDocument {
  const paths: Record<string, Record<string, OpenApiOperation>> = {}
  const tags = new Map<string, string | undefined>()

  for (const entry of sources) {
    const tag = entry.scope === 'core' ? 'Core' : (entry.scope.charAt(0).toUpperCase() + entry.scope.slice(1))
    tags.set(tag, entry.manifestDescription)

    const operation = buildOperation(entry.route as unknown as Parameters<typeof buildOperation>[0], {
      scope: entry.scope,
      fullPath: entry.fullPath,
      tag,
    })
    const openApiPath = normalizeOpenApiPath(entry.fullPath)
    paths[openApiPath] ??= {}
    paths[openApiPath][entry.route.method.toLowerCase()] = operation
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Bakin API',
      version: APP_VERSION,
      description: 'Live OpenAPI contract for this Bakin instance, built from the runtime route registry.',
    },
    servers: [
      { url: port ? `http://localhost:${port}` : 'http://localhost:3737', description: 'Local Bakin server' },
    ],
    tags: [...tags.entries()].map(([name, description]) => ({ name, ...(description ? { description } : {}) })),
    paths,
    components: {
      securitySchemes: {
        pluginPermissions: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Bakin-Plugin-Permission',
          description: 'Plugin permission marker. Bakin enforces these via the plugin registry.',
        },
      },
    },
  }
}

export function getCachedOrBuild(
  sources: () => ReadonlyArray<RouteSource>,
  port?: number,
): OpenApiDocument {
  if (cached) return cached
  cached = buildOpenApiDocument(sources(), port)
  return cached
}
