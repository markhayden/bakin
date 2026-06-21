/**
 * Workflow Plugin Context accessor
 *
 * Replaces the former mutable `pluginCtx` module global in index.ts. Route
 * closures are built at module-load time (populateWorkflowRoutes runs at
 * import, before activate), so they can't capture `ctx` directly — they read
 * it lazily through this accessor at request time instead. `activate` sets it
 * once; search-indexing and the start route read it. Null until activate runs,
 * matching the old guard semantics.
 */
import type { PluginContext } from '@bakin/core/plugin-types'

let pluginCtx: PluginContext | null = null

export function setWorkflowPluginContext(ctx: PluginContext): void {
  pluginCtx = ctx
}

export function getWorkflowPluginContext(): PluginContext | null {
  return pluginCtx
}
