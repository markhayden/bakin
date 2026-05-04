import { coreRoutes } from '../core-routes'
import type { buildOpenApiDocument } from './docs-runtime'

type OpenApiSource = Parameters<typeof buildOpenApiDocument>[0][number]

export interface PluginRouteSource {
  pluginId: string
  route: OpenApiSource['route']
}

export function collectOpenApiSources(pluginRoutes: ReadonlyArray<PluginRouteSource>): OpenApiSource[] {
  return [
    ...pluginRoutes.map(({ pluginId, route }) => ({
      scope: pluginId,
      fullPath: `/api/plugins/${pluginId}${route.path}`,
      route,
    })),
    ...coreRoutes.map(route => ({
      scope: 'core' as const,
      fullPath: route.path,
      route,
    })),
  ]
}
