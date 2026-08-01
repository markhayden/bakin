'use client'

import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useLocation,
} from '@tanstack/react-router'
import {
  Component,
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Button, SystemState, ToastRegion, TooltipProvider } from '@bakin/ui'
import type { SystemStateKind } from '@bakin/ui'

import {
  getPluginRoute,
  getRegistryVersion,
  registerPlugin,
  subscribeRegistry,
  unregisterPlugin,
  type PluginRegistration,
} from '../../register'
import { PluginOwnershipRoot } from '../../internal/plugin-ownership'
import { parseSearchPlain, stringifySearchPlain } from '../../navigation/search-params'
import { Slot } from '../../slots'
import {
  DEFAULT_PLUGIN_UI_FIXTURE,
  installPluginUiFixture,
  normalizePluginUiFixtureRoute,
  type PluginUiRuntimeFixture,
} from './runtime'

/** Ready content or one canonical replacement-state kind. */
export type PluginUiFixtureSurfaceState = 'ready' | SystemStateKind
/** Public test registration shape; identical to a real plugin client registration. */
export type PluginUiFixtureRegistration = PluginRegistration

/** One production slot mount rendered by the fixture host. */
export interface PluginUiFixtureSlot {
  /** Registered slot name to render. */
  name: string
  /** Accessible fixture-only label around the rendered contributions. */
  label?: string
  /** Props passed unchanged to every registered contribution. */
  props?: Record<string, unknown>
}

/** Browser-only fixture host inputs for real plugin client registrations. */
export interface PluginUiFixtureHostProps {
  /** Real plugin client registrations. Keep this array stable across renders. */
  registrations: readonly PluginRegistration[]
  /** Deterministic browser runtime. The route also seeds the memory router. */
  fixture?: PluginUiRuntimeFixture
  /** Optional registered slots rendered beside the active page contribution. */
  slots?: readonly PluginUiFixtureSlot[]
  /** Replace the active plugin page with one canonical system state. */
  surfaceState?: PluginUiFixtureSurfaceState
  /** Invoked by the deterministic no-results and recoverable-error actions. */
  onStateAction?: () => void
  className?: string
}

interface FixtureContextValue {
  slots: readonly PluginUiFixtureSlot[]
  surfaceState: PluginUiFixtureSurfaceState
  onStateAction?: () => void
}

const FixtureContext = createContext<FixtureContextValue | null>(null)

function useFixtureContext(): FixtureContextValue {
  const value = useContext(FixtureContext)
  if (!value) throw new Error('Plugin UI fixture route rendered outside PluginUiFixtureHost')
  return value
}

class PluginFixturePageBoundary extends Component<
  { pluginId: string; pathname: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error(
      `[bakin] plugin UI fixture page "${this.props.pluginId}" crashed at ${this.props.pathname}:`,
      error,
    )
  }

  componentDidUpdate(previous: { pathname: string }): void {
    if (previous.pathname !== this.props.pathname && this.state.error) {
      this.setState({ error: null })
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <SystemState
        kind="error"
        recovery="unavailable"
        scope="section"
        title="Plugin fixture crashed"
        description={`Plugin ${this.props.pluginId} failed while rendering ${this.props.pathname}.`}
      />
    )
  }
}

function FixtureSystemState({ kind, onAction }: {
  kind: Exclude<PluginUiFixtureSurfaceState, 'ready'>
  onAction?: () => void
}) {
  if (kind === 'no-results') {
    return (
      <SystemState
        kind="no-results"
        scope="section"
        action={<Button variant="outline" onClick={onAction}>Clear fixture filters</Button>}
      />
    )
  }
  if (kind === 'error') {
    return (
      <SystemState
        kind="error"
        recovery="available"
        scope="section"
        action={<Button variant="outline" onClick={onAction}>Retry fixture</Button>}
      />
    )
  }
  return <SystemState kind={kind} scope="section" />
}

function RegisteredPluginPage() {
  useSyncExternalStore(subscribeRegistry, getRegistryVersion, getRegistryVersion)
  const { slots, surfaceState, onStateAction } = useFixtureContext()
  const location = useLocation()
  const match = getPluginRoute(location.pathname)

  let page: ReactNode
  if (surfaceState !== 'ready') {
    page = <FixtureSystemState kind={surfaceState} onAction={onStateAction} />
  } else if (!match) {
    page = (
      <SystemState
        kind="error"
        recovery="unavailable"
        scope="section"
        title="No fixture page registered"
        description={`No plugin fixture route matches ${location.pathname}.`}
      />
    )
  } else {
    const Page = match.component
    page = (
      <PluginOwnershipRoot pluginId={match.pluginId}>
        <PluginFixturePageBoundary pluginId={match.pluginId} pathname={location.pathname}>
          <Page params={match.params} pathname={location.pathname} {...match.params} />
        </PluginFixturePageBoundary>
      </PluginOwnershipRoot>
    )
  }

  return (
    <>
      <div data-bakin-plugin-fixture-page className="min-w-0">{page}</div>
      {slots.map((slot) => (
        <aside
          key={slot.name}
          aria-label={slot.label ?? `${slot.name} fixture slot`}
          data-bakin-plugin-fixture-slot={slot.name}
          className="mt-bakin-6 min-w-0 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-4"
        >
          <Slot name={slot.name} {...slot.props} />
        </aside>
      ))}
    </>
  )
}

function createFixtureRouter(route: string) {
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: RegisteredPluginPage,
  })
  const catchAllRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$',
    component: RegisteredPluginPage,
  })

  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, catchAllRoute]),
    history: createMemoryHistory({ initialEntries: [route] }),
    parseSearch: parseSearchPlain,
    stringifySearch: stringifySearchPlain,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: RegisteredPluginPage,
  })
}

function RoutedPluginFixture({ route }: { route: string }) {
  const router = useMemo(() => createFixtureRouter(route), [route])
  return <RouterProvider router={router} />
}

/**
 * Browser-safe shell for rendering external-style plugin pages and slots.
 * It uses production registries, route matching, ownership roots, and portals
 * while replacing host accounts, storage, and live services with fixture data.
 */
export function PluginUiFixtureHost({
  registrations,
  fixture = DEFAULT_PLUGIN_UI_FIXTURE,
  slots = [],
  surfaceState = 'ready',
  onStateAction,
  className,
}: PluginUiFixtureHostProps) {
  const route = normalizePluginUiFixtureRoute(fixture.route)
  const [registrationsReady, setRegistrationsReady] = useState(false)

  useLayoutEffect(() => installPluginUiFixture(fixture), [fixture])
  useLayoutEffect(() => {
    setRegistrationsReady(false)
    for (const registration of registrations) {
      unregisterPlugin(registration.id)
      registerPlugin(registration)
    }
    setRegistrationsReady(true)
    return () => {
      for (const registration of registrations) unregisterPlugin(registration.id)
    }
  }, [registrations])

  const context = useMemo<FixtureContextValue>(() => ({
    slots,
    surfaceState,
    onStateAction,
  }), [slots, surfaceState, onStateAction])
  return (
    <FixtureContext.Provider value={context}>
      <TooltipProvider>
        <main
          className={className}
          data-bakin-plugin-fixture-host
          data-bakin-plugin-fixture-state={surfaceState}
          data-bakin-plugin-fixture-viewport={fixture.viewport}
        >
          {registrationsReady ? <RoutedPluginFixture route={route} /> : (
            <SystemState kind="loading" scope="page" title="Preparing plugin fixture" />
          )}
        </main>
        <ToastRegion label="Plugin fixture notifications" data-bakin-plugin-fixture-overlay-root />
      </TooltipProvider>
    </FixtureContext.Provider>
  )
}
