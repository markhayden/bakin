/**
 * Models plugin cross-plugin hooks.
 *
 * Extracted from index.ts. `registerModelsHooks` registers the nine models.*
 * hooks against the plugin context: the configChanged event, effective-model
 * and available-models RPCs, the restart-sync dirty markers, turn/image
 * pricing off the curated catalog, and the routing/budget policy reads that
 * core dispatch consults. Hook names and payload shapes are cross-plugin
 * contracts — bodies moved verbatim.
 */
import type { PluginContext } from '@bakin/core/plugin-types'

import type { ModelsPluginSettings } from '../types'
import { getKnownModel, computeCostUsdMicros, computeImageCostUsdMicros } from '../data/known-models'
import { markConfigDirty, markRuntimeRestarted, resolveAgents } from './config-io'
import { normalizeModelId } from './model-id'
import { fetchAvailableModels } from './available-models'

export function registerModelsHooks(ctx: PluginContext): void {
  ctx.hooks.register('models.configChanged', () => {
    // Notification hook — handlers subscribe externally
  }, { label: 'Model config changed.', summary: 'Notifies listeners after an agent model assignment changes. Use it to refresh dependent state, update UI, or invalidate plugin caches that depend on model routing.', hookKind: 'event' })

  ctx.hooks.register('models.getEffectiveModel', async (data: Record<string, unknown>) => {
    const agentId = data.agentId as string
    if (!agentId) return null
    const agents = await resolveAgents(ctx as unknown as PluginContext)
    const agent = agents.find((a) => a.agentId === agentId)
    return agent?.effectiveModel ?? null
  }, { label: 'Get effective model.', summary: 'Resolves the model an agent will actually use after defaults, overrides, and provider settings are applied. Use it when a plugin needs runtime-ready model information for one agent.', hookKind: 'rpc' })

  ctx.hooks.register('models.markConfigDirty', () => { markConfigDirty() }, { label: 'Mark config dirty.', summary: 'Marks model configuration as changed so the runtime knows a refresh is needed. Use it after writing model settings that should not be treated as live yet.', hookKind: 'event' })

  ctx.hooks.register('models.markRuntimeRestarted', () => { markRuntimeRestarted() }, { label: 'Mark runtime refreshed.', summary: 'Records that the runtime has picked up the latest model configuration. Use it after restart or reload flows so stale dirty-state warnings can clear.', hookKind: 'event' })

  ctx.hooks.register('models.getAvailableModels', async () => {
    const result = await fetchAvailableModels(ctx as unknown as PluginContext)
    return result.models
  }, { label: 'List available models.', summary: 'Returns the model catalog available from the currently configured providers. Use it to populate pickers, validate assignments, or compare model options before saving config.', hookKind: 'rpc' })

  // Price one completed agent turn: resolve the model that ran (explicit
  // override → agent's effective model), look up catalog pricing, and
  // return an estimated micro-dollar cost. Cost is null when the model has
  // no catalog pricing (unmetered) — never fabricated. Core dispatch calls
  // this on settle so it stays pricing-agnostic (the models plugin owns
  // both per-agent model config and pricing).
  ctx.hooks.register('models.priceTurn', async (data: Record<string, unknown>) => {
    const agentId = data.agentId as string | undefined
    const explicit = data.model as string | undefined
    const input = typeof data.input === 'number' ? data.input : undefined
    const output = typeof data.output === 'number' ? data.output : undefined
    const cacheRead = typeof data.cacheRead === 'number' ? data.cacheRead : undefined
    const cacheWrite = typeof data.cacheWrite === 'number' ? data.cacheWrite : undefined

    let model = explicit ? normalizeModelId(explicit) : null
    if (!model && agentId) {
      const agents = await resolveAgents(ctx as unknown as PluginContext)
      model = agents.find((a) => a.agentId === agentId)?.effectiveModel ?? null
    }
    const pricing = model ? getKnownModel(model)?.pricing : undefined
    const costUsdMicros = computeCostUsdMicros({ input, output, cacheRead, cacheWrite }, pricing)
    return { model, costUsdMicros }
  }, { label: 'Price a turn.', summary: 'Resolves the model an agent turn ran on and returns an estimated cost in micro-dollars from the catalog pricing. Use it to attribute spend to a completed turn. Cost is null when the model is unpriced.', hookKind: 'rpc' })

  // Price an image generation by flat per-image rate (count × imagePerUsd).
  // Null when the model has no flat rate (provider-priced/ranged) — the run
  // is still recorded, just unpriced.
  ctx.hooks.register('models.priceImage', (data: Record<string, unknown>) => {
    const model = typeof data.model === 'string' ? normalizeModelId(data.model) : undefined
    const count = typeof data.count === 'number' ? data.count : 1
    const imagePerUsd = model ? getKnownModel(model)?.imagePerUsd : undefined
    return { model: model ?? null, costUsdMicros: computeImageCostUsdMicros(count, imagePerUsd) }
  }, { label: 'Price an image.', summary: 'Returns an estimated cost in micro-dollars for an image generation (count × the model’s flat per-image rate), or null when the model is provider-priced. Use it to attribute image-generation spend.', hookKind: 'rpc' })

  // Expose the per-turn routing policy to core dispatch, which resolves the
  // model/thinking for each turn before sending. Returns an empty config
  // when none is set → dispatch inherits the agent's configured model.
  ctx.hooks.register('models.getRoutingConfig', () => {
    const settings = ctx.getSettings<ModelsPluginSettings>()
    return settings.routing ?? { policies: [], tagOverrides: [] }
  }, { label: 'Get routing config.', summary: 'Returns the per-turn model/thinking routing policy (origins + tag overrides) that dispatch applies before each agent turn. Use it to read the current routing rules.', hookKind: 'rpc' })

  // Expose the budget policy to core dispatch, which consults it before
  // claiming a run. Empty when none is set → no gating.
  ctx.hooks.register('models.getBudgetPolicy', () => {
    const settings = ctx.getSettings<ModelsPluginSettings>()
    return settings.budget ?? {}
  }, { label: 'Get budget policy.', summary: 'Returns the spend-cap policy (global + per-agent daily/monthly limits) that dispatch consults before each turn. Use it to read the current budget limits.', hookKind: 'rpc' })
}
