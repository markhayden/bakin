'use client'

/**
 * `@makinbakin/sdk/slots` — client-side slot registry + `<Slot>` primitive.
 *
 * The slot system lets a plugin render components contributed by other
 * plugins at a named extension point. Today it's used for:
 *   - `asset-preview`  — renderer for an asset (images/video/audio/pdf/...)
 *   - `task-sidebar`   — side panels on the task detail dialog
 *   - `home-widget`    — dashboard tiles
 *
 * Design:
 *   - `registerSlot(name, Component, order?, owner?)` mutates a browser-
 *     global Map. Namespaced under `__bakinSlotRegistry` so HMR / module
 *     dedup doesn't wipe the registrations. `owner` is the pluginId that
 *     registered the entry — used by `unregisterPlugin` to clean up only
 *     that plugin's entries during hot-swap.
 *   - `<Slot name="..." {...props} />` reads the registry at render time and
 *     renders every matched component in `order` sequence.
 *
 * Registration happens at plugin client-module load time (import side effect).
 * Test-only helpers are not exported — tests use the public unregister path.
 */

import { Component, Fragment, useEffect, useSyncExternalStore, type JSX, type ReactNode } from 'react'
import { PluginOwnershipRoot } from '../internal/plugin-ownership'
import { subscribeRegistry, getRegistryVersion } from '../register'
import {
  getLazyPluginsVersion,
  getPluginLoadError,
  getPluginLoadState,
  getSlotOwners,
  requestSlotPlugins,
  retryPluginLoad,
  subscribeLazyPlugins,
} from '../internal/lazy'

// The registry core lives in ./registry (react-free) so the SDK root
// barrel — which re-exports ../register → registerSlot/clearSlotsOwnedBy —
// stays server-safe. Re-exported here so the public `@makinbakin/sdk/slots`
// surface is unchanged.

/** Register a component for a named slot. Lower `order` renders first; default `order` is 100. */
export { registerSlot } from './registry'
/** Read the registered entries for a slot. Exported for tooling / tests. */
export { getSlotEntries } from './registry'
/** Slot names with at least one entry owned by the given plugin (manifest drift checks). */
export { getSlotNamesOwnedBy } from './registry'
/** Remove every slot entry owned by the given plugin (hot-swap teardown). */
export { clearSlotsOwnedBy } from './registry'

import { getSlotEntries } from './registry'

interface SlotProps {
  name: string
  [key: string]: unknown
}

/**
 * Per-entry error boundary so one plugin's crashing slot component (or a
 * component from a half-loaded lazy bundle) can't unmount the shell or the
 * other entries rendered in the same slot.
 */
class SlotEntryBoundary extends Component<
  { owner?: string; slotName: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error(
      `[bakin] slot "${this.props.slotName}" entry${this.props.owner ? ` from plugin "${this.props.owner}"` : ''} crashed:`,
      error,
    )
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="rounded-bakin-control border border-bakin-signal-danger/40 bg-bakin-signal-danger/10 px-bakin-3 py-bakin-2 text-[length:var(--bakin-typography-size-meta)] text-bakin-signal-danger" role="alert">
          {this.props.owner ? `Plugin "${this.props.owner}"` : 'A plugin'} failed to render this section.
        </div>
      )
    }
    return this.props.children
  }
}

/** Fallback shown in place of slot content when an owning plugin's client bundle failed to load. */
function SlotLoadError({ slotName, pluginIds }: { slotName: string; pluginIds: string[] }): JSX.Element {
  return (
    <div className="flex flex-col items-start gap-bakin-2 rounded-bakin-control border border-bakin-signal-danger/40 bg-bakin-signal-danger/10 px-bakin-4 py-bakin-3 text-[length:var(--bakin-typography-size-body)] text-bakin-signal-danger" role="alert">
      <span>
        {pluginIds.length === 1 ? `Plugin "${pluginIds[0]}" failed to load` : `Plugins ${pluginIds.map((id) => `"${id}"`).join(', ')} failed to load`}
        {getPluginLoadError(pluginIds[0]) ? ` — ${getPluginLoadError(pluginIds[0])}` : ''}
      </span>
      <button
        type="button"
        className="rounded-bakin-control border border-bakin-signal-danger/40 px-bakin-2 py-bakin-1 text-[length:var(--bakin-typography-size-meta)] hover:bg-bakin-signal-danger/20"
        onClick={() => pluginIds.forEach(retryPluginLoad)}
        aria-label={`Retry loading ${slotName}`}
      >
        Retry
      </button>
    </div>
  )
}

/**
 * Render all components registered for the named slot, in order. Extra props
 * are passed through to every registered component unchanged. Returns `null`
 * if nothing is registered.
 *
 * Lazy loading: rendering a slot is a demand signal — if a manifest declares
 * an owner for this slot whose client bundle hasn't loaded yet, the host's
 * loader fires and the slot re-renders once `registerPlugin` runs. While an
 * owner is loading the slot renders nothing (page slots resolve in one
 * paint on the LAN); if an owner's bundle failed to import, an inline error
 * with a retry button renders instead of silent emptiness.
 */
export function Slot({ name, ...props }: SlotProps): JSX.Element | null {
  // Subscribe to registry mutations so hot-swap (v2) re-renders the
  // slot with the new module's components. Without this, PluginHost's
  // useSyncExternalStore re-renders PluginHost itself but consumers
  // below (<Slot>, <AppSidebar>) keep reading the pre-swap registry.
  useSyncExternalStore(subscribeRegistry, getRegistryVersion, getRegistryVersion)
  // Lazy load-state subscription: re-render when an owning plugin's client
  // starts/finishes loading so the loading/error fallbacks stay current.
  useSyncExternalStore(subscribeLazyPlugins, getLazyPluginsVersion, getLazyPluginsVersion)
  useEffect(() => {
    requestSlotPlugins(name)
  }, [name])
  const entries = getSlotEntries(name)
  if (entries.length === 0) {
    const failed = getSlotOwners(name).filter((id) => getPluginLoadState(id) === 'error')
    if (failed.length > 0) return <SlotLoadError slotName={name} pluginIds={[...failed]} />
    return null
  }
  return (
    <>
      {entries.map((entry, i) => {
        const C = entry.component
        const contribution = (
          <SlotEntryBoundary owner={entry.owner} slotName={name}>
            <C {...props} />
          </SlotEntryBoundary>
        )
        return entry.owner ? (
          <PluginOwnershipRoot key={`${name}-${i}`} pluginId={entry.owner}>
            {contribution}
          </PluginOwnershipRoot>
        ) : (
          <Fragment key={`${name}-${i}`}>{contribution}</Fragment>
        )
      })}
    </>
  )
}
