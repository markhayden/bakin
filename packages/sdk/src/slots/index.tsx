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

import { Component, useEffect, useSyncExternalStore, type ComponentType, type JSX, type ReactNode } from 'react'
import { subscribeRegistry, getRegistryVersion } from '../register'
import {
  getLazyPluginsVersion,
  getPluginLoadError,
  getPluginLoadState,
  getSlotOwners,
  requestSlotPlugins,
  retryPluginLoad,
  subscribeLazyPlugins,
} from '../lazy'

interface SlotEntry {
  component: ComponentType<Record<string, unknown>>
  order: number
  owner?: string
}

function getRegistry(): Map<string, SlotEntry[]> {
  const g = globalThis as Record<string, unknown>
  if (!g.__bakinSlotRegistry) {
    g.__bakinSlotRegistry = new Map<string, SlotEntry[]>()
  }
  return g.__bakinSlotRegistry as Map<string, SlotEntry[]>
}

/**
 * Register a component for a named slot. Lower `order` renders first; entries
 * with the same order render in registration order. Default `order` is 100.
 * `owner` is the pluginId for teardown-on-hot-swap; omit in test setups.
 */
export function registerSlot<TProps>(
  name: string,
  component: ComponentType<TProps>,
  order = 100,
  owner?: string,
): void {
  const reg = getRegistry()
  const entries = reg.get(name) ?? []
  entries.push({ component: component as ComponentType<Record<string, unknown>>, order, owner })
  entries.sort((a, b) => a.order - b.order)
  reg.set(name, entries)
}

/**
 * Read the registered entries for a slot. Exported for tooling / tests.
 */
export function getSlotEntries(name: string): ReadonlyArray<SlotEntry> {
  return getRegistry().get(name) ?? []
}

/**
 * Remove every slot entry owned by the given plugin. Used by
 * `unregisterPlugin` during v2 hot-swap. Entries without an `owner`
 * (test registrations, pre-v2 legacy registrations) survive — callers
 * that want to wipe unowned entries should re-register them after.
 */
export function clearSlotsOwnedBy(pluginId: string): void {
  const reg = getRegistry()
  for (const [name, entries] of reg.entries()) {
    const filtered = entries.filter((e) => e.owner !== pluginId)
    if (filtered.length === 0) reg.delete(name)
    else reg.set(name, filtered)
  }
}

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
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
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
    <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
      <span>
        {pluginIds.length === 1 ? `Plugin "${pluginIds[0]}" failed to load` : `Plugins ${pluginIds.map((id) => `"${id}"`).join(', ')} failed to load`}
        {getPluginLoadError(pluginIds[0]) ? ` — ${getPluginLoadError(pluginIds[0])}` : ''}
      </span>
      <button
        type="button"
        className="rounded border border-destructive/40 px-2 py-1 text-xs hover:bg-destructive/20"
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
        return (
          <SlotEntryBoundary key={`${name}-${i}`} owner={entry.owner} slotName={name}>
            <C {...props} />
          </SlotEntryBoundary>
        )
      })}
    </>
  )
}
