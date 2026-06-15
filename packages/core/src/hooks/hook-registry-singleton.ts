import { HookRegistry } from './hook-registry'

/**
 * Process-singleton hook registry, shared across all plugins and core modules.
 *
 * Backed by `globalThis` so one process has exactly one hook map even when this
 * module is reached from both the shell entry and dynamically-imported plugin
 * bundles (and across dev HMR re-evaluation). This is a dependency-free leaf:
 * the exec-tool registry, the plugin loader, the per-request plugin context,
 * and every core consumer import `getHookRegistry` from HERE — not from the
 * plugin loader — so there is no registry ↔ plugin-registry import cycle.
 */
const g = globalThis as typeof globalThis & { __bakinHookRegistry?: HookRegistry }
const hookRegistry: HookRegistry = (g.__bakinHookRegistry ??= new HookRegistry())

/** Access the process-wide hook registry. */
export function getHookRegistry(): HookRegistry {
  return hookRegistry
}
