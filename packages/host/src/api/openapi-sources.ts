import { coreRoutes } from '../core-routes'
import type { RouteSource } from './docs-runtime'

type OpenApiSource = RouteSource

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
