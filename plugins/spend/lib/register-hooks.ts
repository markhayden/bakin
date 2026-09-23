/**
 * The spend plugin's hook surface — the ONE way core (dispatch gate, spend
 * engine, turn/image metering, media gate) and other plugins reach limits,
 * billing lanes and pricing. "Which model an agent runs" stays a models
 * question (`models.getEffectiveModel`); everything about what it costs is
 * answered here.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import { getKnownModel, computeCostUsdMicros, computeImageCostUsdMicros } from '@bakin/core/llm/model-catalog'
import { normalizeModelId } from '@bakin/core/llm/model-id'
import { toLocalDayKey } from '@bakin/core/usage-history/store'
import { resolveBilling } from './billing'
import { readLimits, SpendSettingsSchema } from './settings'

async function effectiveModelFor(ctx: PluginContext, agentId: string): Promise<string | null> {
  try {
    const model = await ctx.hooks.invoke<string | null>('models.getEffectiveModel', { agentId })
    return typeof model === 'string' ? normalizeModelId(model) : null
  } catch {
    // The models plugin is unreachable — price/attribute without a model
    // rather than fail the turn that already happened.
    return null
  }
}

export function registerSpendHooks(ctx: PluginContext): void {
  // Expose the limits policy to core dispatch, which consults it before
  // claiming a run. Empty when none is set → no gating. Absent hook = the
  // gate FAILS CLOSED (budget_policy_unavailable) — never runs uncapped.
  ctx.hooks.register('spend.getBudgetPolicy', () => readLimits(ctx), {
    label: 'Get the limits policy.',
    summary: 'Returns the spend-limit rule list (with ids) that dispatch consults before each turn, plus the accept-unattributed cutoff. Use it to read the current limits.',
    hookKind: 'rpc',
  })

  ctx.hooks.register('spend.updateBudgetPolicy', async (data: Record<string, unknown>) => {
    // Narrow, explicit patch surface: today only the write-off cutoff
    // (accept-unattributed-history repair). Full limit edits stay on
    // PUT /limits with schema validation.
    const value = typeof data?.acceptUnattributedBefore === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(data.acceptUnattributedBefore)
      ? data.acceptUnattributedBefore
      : null
    if (!value) return { ok: false, error: 'acceptUnattributedBefore must be a YYYY-MM-DD day key' }
    // Future cutoffs would pre-silence current and future usage — money
    // never pre-silences (the spend engine also clamps at read).
    if (value > toLocalDayKey(Date.now())) {
      return { ok: false, error: 'acceptUnattributedBefore cannot be in the future' }
    }
    const current = SpendSettingsSchema.safeParse(ctx.getSettings<unknown>())
    const limits = current.success ? current.data.limits : { rules: [] }
    await ctx.updateSettings({ limits: { ...limits, acceptUnattributedBefore: value } })
    return { ok: true }
  }, {
    label: 'Update the limits policy.',
    summary: 'Applies a narrow limits patch — currently the accept-unattributed-history cutoff written by the Health repair. Money policy never changes without an explicit, validated write.',
    hookKind: 'rpc',
  })

  // Price one completed agent turn: resolve the model that ran (explicit
  // override → agent's effective model), look up catalog pricing, and
  // return an estimated micro-dollar cost. Cost is null when the model has
  // no catalog pricing (unmetered) — never fabricated. Core calls this on
  // settle so it stays pricing-agnostic.
  ctx.hooks.register('spend.priceTurn', async (data: Record<string, unknown>) => {
    const agentId = data.agentId as string | undefined
    const explicit = data.model as string | undefined
    const input = typeof data.input === 'number' ? data.input : undefined
    const output = typeof data.output === 'number' ? data.output : undefined
    const cacheRead = typeof data.cacheRead === 'number' ? data.cacheRead : undefined
    const cacheWrite = typeof data.cacheWrite === 'number' ? data.cacheWrite : undefined

    let model = explicit ? normalizeModelId(explicit) : null
    if (!model && agentId) model = await effectiveModelFor(ctx, agentId)
    const pricing = model ? getKnownModel(model)?.pricing : undefined
    const costUsdMicros = computeCostUsdMicros({ input, output, cacheRead, cacheWrite }, pricing)
    const billing = await resolveBilling(ctx, { agentId, model })
    // A subscription turn has no marginal dollar cost — tokens are its unit
    // (unit-per-lane). Suppress the estimate rather than book fiction.
    return {
      model,
      provider: billing.provider,
      lane: billing.lane,
      costUsdMicros: billing.lane === 'subscription' ? null : costUsdMicros,
    }
  }, {
    label: 'Price a turn.',
    summary: 'Resolves the model an agent turn ran on and returns billing attribution (provider, metered/subscription lane) plus an estimated micro-dollar cost from the catalog pricing. Cost is null when the model is unpriced or the lane is subscription (tokens are the unit there).',
    hookKind: 'rpc',
  })

  // Price an image generation by flat per-image rate (count × imagePerUsd).
  // Null when the model has no flat rate (provider-priced/ranged) — the run
  // is still recorded, just unpriced.
  ctx.hooks.register('spend.priceImage', async (data: Record<string, unknown>) => {
    const model = typeof data.model === 'string' ? normalizeModelId(data.model) : undefined
    const count = typeof data.count === 'number' ? data.count : 1
    const imagePerUsd = model ? getKnownModel(model)?.imagePerUsd : undefined
    // Image generation bills through PROVIDER credentials — the AGENT's
    // chat auth lane must never suppress a billed image's dollars. Lane
    // resolves from provider-level overrides only (no agentId → detection
    // skipped); default metered.
    const billing = await resolveBilling(ctx, { model })
    return {
      model: model ?? null,
      provider: billing.provider,
      lane: billing.lane,
      costUsdMicros: billing.lane === 'subscription' ? null : computeImageCostUsdMicros(count, imagePerUsd),
    }
  }, {
    label: 'Price an image.',
    summary: 'Returns billing attribution plus an estimated cost in micro-dollars for an image generation (count × the model’s flat per-image rate), or null cost when the model is provider-priced or the provider is overridden to the subscription lane. The agent’s chat auth never affects image billing.',
    hookKind: 'rpc',
  })

  // Billing attribution for a prospective turn (provider + metered vs
  // subscription lane) — the budget gate and billed-media gate consult this
  // before spending. Detection: overrides → auth-profile shape → metered.
  ctx.hooks.register('spend.resolveBilling', async (data: Record<string, unknown>) => {
    const agentId = data.agentId as string | undefined
    let model = typeof data.model === 'string' ? normalizeModelId(data.model) : undefined
    // No explicit model = the turn will run on the agent's effective model —
    // resolve it so provider/model-scoped rules see the real target. Callers
    // attributing PAST usage (`prospective: false`, the spend engine's
    // observed rows) skip this: substituting today's model into history
    // would let provider-scoped overrides match a guessed provider, and it
    // costs runtime round-trips on the budget hot path.
    const prospective = data.prospective !== false
    if (!model && agentId && prospective) model = (await effectiveModelFor(ctx, agentId)) ?? undefined
    const billing = await resolveBilling(ctx, { agentId, model })
    return { ...billing, model: model ?? null }
  }, {
    label: 'Resolve billing.',
    summary: 'Returns the provider, billing lane (metered vs subscription), lane source, and normalized model for an agent/model pair — falling back to the agent’s effective model when none is given, unless prospective:false marks the attribution as historical. Use it to attribute or gate spend before a turn or billed media call.',
    hookKind: 'rpc',
  })
}
