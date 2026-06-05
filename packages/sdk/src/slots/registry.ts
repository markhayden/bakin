/**
 * Slot registry core — the react-free half of `@makinbakin/sdk/slots`.
 *
 * Split out of `index.tsx` so the SDK root barrel stays server-safe: the
 * barrel re-exports `./register`, which needs `registerSlot`/
 * `clearSlotsOwnedBy` — pulling them from `index.tsx` dragged the `<Slot>`
 * rendering layer (runtime react + JSX) into every server bundle that
 * inlined the root, which only resolves inside a repo checkout and dies at
 * activation on binary installs (#267 residual; see
 * `assertServerBundleExternalsClean` in src/core/whiskit/build.ts).
 *
 * `ComponentType` here is a type-only import — erased at build, never
 * retained in emitted bundles. The public plugin-facing surface is
 * unchanged: `@makinbakin/sdk/slots` re-exports everything below.
 */
import type { ComponentType } from 'react'

export interface SlotEntry {
  component: ComponentType<Record<string, unknown>>
  order: number
  owner?: string
}

export function getRegistry(): Map<string, SlotEntry[]> {
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
 * Slot names that currently have at least one entry owned by the given
 * plugin. Used by the host's drift validation check to compare runtime
 * slot registrations against the manifest's `contributes.slots`.
 */
export function getSlotNamesOwnedBy(pluginId: string): string[] {
  const names: string[] = []
  for (const [name, entries] of getRegistry().entries()) {
    if (entries.some((e) => e.owner === pluginId)) names.push(name)
  }
  return names
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
