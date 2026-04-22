'use client'

/**
 * `@bakin/sdk/slots` — client-side slot registry + `<Slot>` primitive.
 *
 * The slot system lets a plugin render components contributed by other
 * plugins at a named extension point. Today it's used for:
 *   - `asset-preview`  — renderer for an asset (images/video/audio/pdf/...)
 *   - `task-sidebar`   — side panels on the task detail dialog
 *   - `home-widget`    — dashboard tiles
 *
 * Design:
 *   - `registerSlot(name, Component, order?)` mutates a browser-global Map.
 *     Namespaced under `__bakinSlotRegistry` so HMR / module dedup doesn't
 *     wipe the registrations.
 *   - `<Slot name="..." {...props} />` reads the registry at render time and
 *     renders every matched component in `order` sequence.
 *
 * Registration happens at plugin client-module load time (import side effect).
 * For core plugins this runs during Bakin's boot; for user plugins it'll run
 * when the Phase 4 client loader dynamic-imports the plugin's `client.mjs`.
 */

import type { ComponentType, JSX } from 'react'

interface SlotEntry {
  component: ComponentType<Record<string, unknown>>
  order: number
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
 */
export function registerSlot<TProps>(
  name: string,
  component: ComponentType<TProps>,
  order = 100,
): void {
  const reg = getRegistry()
  const entries = reg.get(name) ?? []
  entries.push({ component: component as ComponentType<Record<string, unknown>>, order })
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
 * Clear a slot's registrations. Intended for test teardown only.
 */
export function __clearSlot(name: string): void {
  getRegistry().delete(name)
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
