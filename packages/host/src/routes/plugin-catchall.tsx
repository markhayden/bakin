/**
 * Catch-all host route for plugin-declared pages.
 *
 * Static core routes stay registered explicitly. This leaf handles paths
 * claimed by installed plugins through `registerPlugin({ routes })`, which
 * lets extracted plugins render real pages without Bakin adding one route
 * file per plugin page.
 *
 * Lazy loading: navigating here is a demand signal. If no runtime route
 * matches yet but a plugin's manifest `contributes.routes` claims the path,
 * we request its client bundle and render a loading state until the
 * module's `registerPlugin` side effect fills the registry. A failed
 * import renders an inline error with retry instead of a false 404.
 */
import { createRoute, useLocation } from '@tanstack/react-router'
import { Component, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import {
  getLazyPluginsVersion,
  getPluginLoadError,
  getPluginLoadState,
  getPluginRoute,
  getRegistryVersion,
  getRouteOwners,
  PluginOwnershipRoot,
  requestRoutePlugins,
  retryPluginLoad,
  subscribeLazyPlugins,
  subscribeRegistry,
} from '@makinbakin/sdk/internal'
import { NotFoundPage } from '../components/not-found'
import { Route as RootRoute } from './__root'

/** Boundary so a crashing lazily-loaded page can't white-screen the shell. */
class PluginPageBoundary extends Component<
  { pluginId: string; pathname: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error(`[bakin] plugin "${this.props.pluginId}" page crashed at ${this.props.pathname}:`, error)
  }

  componentDidUpdate(prevProps: { pathname: string }): void {
    // Navigating away resets the boundary so the next page renders fresh.
    if (prevProps.pathname !== this.props.pathname && this.state.error) {
      this.setState({ error: null })
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="p-6 text-sm text-destructive" role="alert">
          Plugin &quot;{this.props.pluginId}&quot; failed to render this page.
        </div>
      )
    }
    return this.props.children
  }
}

function PluginLoadingPage() {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
      <span className="size-6 animate-spin rounded-full border-[3px] border-[#ff4d94]/20 border-t-[#ff4d94]" aria-hidden="true" />
      <span className="sr-only">Loading plugin</span>
    </div>
  )
}

function PluginLoadErrorPage({ pluginIds }: { pluginIds: string[] }) {
  const detail = getPluginLoadError(pluginIds[0])
  return (
    <div className="flex flex-col items-start gap-3 p-6 text-sm" role="alert">
      <span className="text-destructive">
        {pluginIds.length === 1 ? `Plugin "${pluginIds[0]}" failed to load` : `Plugins ${pluginIds.map((id) => `"${id}"`).join(', ')} failed to load`}
        {detail ? ` — ${detail}` : ''}
      </span>
      <button
        type="button"
        className="rounded border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
        onClick={() => pluginIds.forEach(retryPluginLoad)}
      >
        Retry
      </button>
    </div>
  )
}

function PluginCatchAllPage() {
  useSyncExternalStore(subscribeRegistry, getRegistryVersion, getRegistryVersion)
  useSyncExternalStore(subscribeLazyPlugins, getLazyPluginsVersion, getLazyPluginsVersion)
  const location = useLocation()

  useEffect(() => {
    requestRoutePlugins(location.pathname)
  }, [location.pathname])

  const match = getPluginRoute(location.pathname)

  if (!match) {
    const owners = getRouteOwners(location.pathname)
    if (owners.length > 0) {
      const failed = owners.filter((id) => getPluginLoadState(id) === 'error')
      if (failed.length > 0) return <PluginLoadErrorPage pluginIds={[...failed]} />
      // idle (demand fires in the effect above) or loading — either way the
      // registry fills in when the client's registerPlugin runs.
      return <PluginLoadingPage />
    }
    return <NotFoundPage />
  }

  const Page = match.component
  return (
    <PluginOwnershipRoot pluginId={match.pluginId}>
      <PluginPageBoundary pluginId={match.pluginId} pathname={location.pathname}>
        <Page
          params={match.params}
          pathname={location.pathname}
          {...match.params}
        />
      </PluginPageBoundary>
    </PluginOwnershipRoot>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '$',
  component: PluginCatchAllPage,
})
