/**
 * Models plugin cross-plugin hooks — "which model": effective-model /
 * roster / available-models RPCs, catalog cache control, and the routing
 * policy read core dispatch consults. Pricing, billing lanes and limits are
 * the spend plugin's (`spend.*`). Hook names and payload shapes are
 * cross-plugin contracts. (Catalog changes ride the `models.catalog_changed`
 * plugin event, not a hook.)
 */
import type { PluginContext } from '@bakin/core/plugin-types'

import { resolveAgents } from './config-io'
import { resetModelsCache } from './available-models'
import { readRoutingSettings } from './routing-settings'
import { fetchAvailableModels } from './available-models'

export function registerModelsHooks(ctx: PluginContext): void {
  ctx.hooks.register('models.getEffectiveModel', async (data: Record<string, unknown>) => {
    const agentId = data.agentId as string
    if (!agentId) return null
    const agents = await resolveAgents(ctx as unknown as PluginContext)
    const agent = agents.find((a) => a.agentId === agentId)
    return agent?.effectiveModel ?? null
  }, { label: 'Get effective model.', summary: 'Resolves the model an agent will actually use after defaults, overrides, and provider settings are applied. Use it when a plugin needs runtime-ready model information for one agent.', hookKind: 'rpc' })

  ctx.hooks.register('models.listAgentModels', async () => {
    return resolveAgents(ctx as unknown as PluginContext)
  }, { label: 'List agent models.', summary: 'Returns every runtime agent with its own/subagent/default/effective model resolved (the roster the Models page shows). Use it when a plugin needs runtime-ready model information for the whole roster — the spend plugin\'s per-agent billing map reads it.', hookKind: 'rpc' })



  ctx.hooks.register('models.getAvailableModels', async () => {
    const result = await fetchAvailableModels(ctx as unknown as PluginContext)
    return result.models
  }, { label: 'List available models.', summary: 'Returns the model catalog available from the currently configured providers. Use it to populate pickers, validate assignments, or compare model options before saving config.', hookKind: 'rpc' })

  ctx.hooks.register('models.resetCatalogCache', () => { resetModelsCache() }, { label: 'Reset the model catalog cache.', summary: 'Drops every catalog cache layer (hot, disk, in-flight) and bumps the runtime epoch so a stale fetch cannot publish. Invoked by the runtime switch.', hookKind: 'event' })
  ctx.hooks.register('models.refreshAvailableModels', async () => {
    const result = await fetchAvailableModels(ctx, { force: true })
    return { count: result.models.length, live: !result.cached, error: result.error ?? null }
  }, { label: 'Refresh the model catalog.', summary: 'Bypasses caches and re-fetches the model catalog (with pricing) live from the configured providers. Use it when pricing is stale or missing — e.g. the spend-evidence repair — instead of waiting on the Models page to trigger a refresh.', hookKind: 'rpc' })

  // Expose the per-turn routing policy to core dispatch, which resolves the
  // model/thinking for each turn before sending. Returns an empty config
  // when none is set → dispatch inherits the agent's configured model.
  ctx.hooks.register('models.getRoutingConfig', () => {
    // The ONE routing read (legacy-migrating on READ: a settings file restored
    // AFTER the one-shot activation migration must never make dispatch
    // silently ignore routes the operator believes exist).
    return readRoutingSettings(ctx).routing
  }, { label: 'Get routing config.', summary: 'Returns the per-turn model/thinking routing policy (work classes + tag overrides) applied before each routable agent turn. Use it to read the current routing rules.', hookKind: 'rpc' })
}
