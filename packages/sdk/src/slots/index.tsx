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

import { useSyncExternalStore, type ComponentType, type JSX } from 'react'
import { subscribeRegistry, getRegistryVersion } from '../register'

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
 * Render all components registered for the named slot, in order. Extra props
 * are passed through to every registered component unchanged. Returns `null`
 * if nothing is registered.
 */
export function Slot({ name, ...props }: SlotProps): JSX.Element | null {
  // Subscribe to registry mutations so hot-swap (v2) re-renders the
  // slot with the new module's components. Without this, PluginHost's
  // useSyncExternalStore re-renders PluginHost itself but consumers
  // below (<Slot>, <AppSidebar>) keep reading the pre-swap registry.
  useSyncExternalStore(subscribeRegistry, getRegistryVersion, getRegistryVersion)
  const entries = getSlotEntries(name)
  if (entries.length === 0) return null
  return (
    <>
      {entries.map((entry, i) => {
        const C = entry.component
        return <C key={`${name}-${i}`} {...props} />
      })}
    </>
  )
}
