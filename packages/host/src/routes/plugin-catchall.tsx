/**
 * Catch-all host route for plugin-declared pages.
 *
 * Static core routes stay registered explicitly. This leaf handles paths
 * claimed by installed plugins through `registerPlugin({ routes })`, which
 * lets extracted plugins render real pages without Bakin adding one route
 * file per plugin page.
 */
import { createRoute, useLocation } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'
import {
  getPluginRoute,
  getRegistryVersion,
  subscribeRegistry,
} from '@makinbakin/sdk'
import { Route as RootRoute } from './__root'

function PluginCatchAllPage() {
  useSyncExternalStore(subscribeRegistry, getRegistryVersion, getRegistryVersion)
  const location = useLocation()
  const match = getPluginRoute(location.pathname)

  if (!match) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Page not found.
      </div>
    )
  }

  const Component = match.component
  return (
    <Component
      params={match.params}
      pathname={location.pathname}
      {...match.params}
    />
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '$',
  component: PluginCatchAllPage,
})
