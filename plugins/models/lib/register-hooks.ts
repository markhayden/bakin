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
import { resolveBilling } from './billing'
import { isLegacyBudget, migrateLegacyBudget } from './budget-migration'
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
    const billing = await resolveBilling(ctx as unknown as PluginContext, { agentId, model })
    // A subscription turn has no marginal dollar cost — tokens are its unit
    // (unit-per-lane, V8). Suppress the estimate rather than book fiction.
    return {
      model,
      provider: billing.provider,
      lane: billing.lane,
      costUsdMicros: billing.lane === 'subscription' ? null : costUsdMicros,
    }
  }, { label: 'Price a turn.', summary: 'Resolves the model an agent turn ran on and returns billing attribution (provider, metered/subscription lane) plus an estimated micro-dollar cost from the catalog pricing. Cost is null when the model is unpriced or the lane is subscription (tokens are the unit there).', hookKind: 'rpc' })

  // Price an image generation by flat per-image rate (count × imagePerUsd).
  // Null when the model has no flat rate (provider-priced/ranged) — the run
  // is still recorded, just unpriced.
  ctx.hooks.register('models.priceImage', async (data: Record<string, unknown>) => {
    const model = typeof data.model === 'string' ? normalizeModelId(data.model) : undefined
    const count = typeof data.count === 'number' ? data.count : 1
    const imagePerUsd = model ? getKnownModel(model)?.imagePerUsd : undefined
    // Image generation bills through PROVIDER credentials (API keys / the
    // image service's own plan) — the AGENT's chat auth lane must never
    // suppress a billed image's dollars (a Codex-OAuth agent generating via
    // a metered image key is still spending real money). Lane resolves from
    // provider-level overrides only (no agentId → detection skipped);
    // default metered.
    const billing = await resolveBilling(ctx as unknown as PluginContext, { model })
    return {
      model: model ?? null,
      provider: billing.provider,
      lane: billing.lane,
      costUsdMicros: billing.lane === 'subscription' ? null : computeImageCostUsdMicros(count, imagePerUsd),
    }
  }, { label: 'Price an image.', summary: 'Returns billing attribution plus an estimated cost in micro-dollars for an image generation (count × the model’s flat per-image rate), or null cost when the model is provider-priced or the provider is overridden to the subscription lane. The agent’s chat auth never affects image billing.', hookKind: 'rpc' })

  // Billing attribution for a prospective turn (provider + metered vs
  // subscription lane) — the budget gate and billed-media gate consult this
  // before spending. Detection: settings overrides → auth-profile shape →
  // metered (conservative default).
  ctx.hooks.register('models.resolveBilling', async (data: Record<string, unknown>) => {
    const agentId = data.agentId as string | undefined
    let model = typeof data.model === 'string' ? normalizeModelId(data.model) : undefined
    // No explicit model = the turn will run on the agent's effective model —
    // resolve it so provider/model-scoped rules see the real target.
    if (!model && agentId) {
      const agents = await resolveAgents(ctx as unknown as PluginContext)
      model = agents.find((a) => a.agentId === agentId)?.effectiveModel ?? undefined
    }
    const billing = await resolveBilling(ctx as unknown as PluginContext, { agentId, model })
    return { ...billing, model: model ?? null }
  }, { label: 'Resolve billing.', summary: 'Returns the provider, billing lane (metered vs subscription), and normalized model for an agent/model pair — falling back to the agent’s effective model when none is given. Use it to attribute or gate prospective spend before a turn or billed media call.', hookKind: 'rpc' })

  // Expose the per-turn routing policy to core dispatch, which resolves the
  // model/thinking for each turn before sending. Returns an empty config
  // when none is set → dispatch inherits the agent's configured model.
  ctx.hooks.register('models.getRoutingConfig', () => {
    const settings = ctx.getSettings<ModelsPluginSettings>()
    const routing = settings.routing
    // Legacy origin-shaped configs read as unset until the one-shot
    // migration (routing-migration.ts) rewrites them at activation.
    if (routing && 'routes' in routing) return routing
    return { routes: [], tagOverrides: [] }
  }, { label: 'Get routing config.', summary: 'Returns the per-turn model/thinking routing policy (work classes + tag overrides) applied before each routable agent turn. Use it to read the current routing rules.', hookKind: 'rpc' })

  // Expose the budget policy to core dispatch, which consults it before
  // claiming a run. Empty when none is set → no gating. A legacy-shaped
  // policy (a settings file restored/rewritten AFTER the one-shot activation
  // migration ran) migrates on READ too — the gate must never see a shape it
  // silently ignores while the operator believes caps are enforced.
  ctx.hooks.register('models.getBudgetPolicy', () => {
    const budget = ctx.getSettings<ModelsPluginSettings>().budget
    if (isLegacyBudget(budget)) return migrateLegacyBudget(budget)
    return budget ?? {}
  }, { label: 'Get budget policy.', summary: 'Returns the spend-cap rule list that dispatch consults before each turn (legacy shapes migrate on read). Use it to read the current budget limits.', hookKind: 'rpc' })
}
