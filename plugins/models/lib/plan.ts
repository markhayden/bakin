/**
 * Plugin-side composition of the model plan (spec §3.4): assembles the pure
 * recommender's input from the eligibility-overlaid catalog, the runtime's
 * routing policy, this plugin's routing settings, the spend plugin's billing
 * lanes and the assets plugin's enrichment toggle, and derives the
 * route-only proposal view the routing health check + repair consume.
 *
 * Vision resolves runtime `input` modalities first (Pi reports them),
 * then the curated vision list (which only ever says yes), else unknown —
 * the recommender ranks unknown below known and discloses it.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import { getKnownModel } from '@bakin/core/llm/model-catalog'
import { VISION_MODELS } from '@bakin/core/llm/vision-models'
import { normalizeModelId, providerFromId } from '@bakin/core/llm/model-id'

import {
  choresLaneState,
  recommendPlan,
  type PlanCandidate,
  type PlanInput,
  type PlanRecommendation,
} from '../../../src/core/model-plan'
import type { RoutingConfig, WorkClass } from '../../../src/core/model-routing'
import type { AvailableModel } from '../types'
import { fetchAvailableModels } from './available-models'
import { getSelectionMutator, readRoutingSettings } from './selections'

const VISION_IDS = new Set(VISION_MODELS.map((m) => m.id))

export function visionOf(model: { id: string; input?: string }): boolean | null {
  if (model.input) return model.input.split(',').map((s) => s.trim()).includes('image')
  return VISION_IDS.has(model.id) ? true : null
}

/** Billing lane per provider from the spend plugin; metered when the hook is absent or fails (conservative). */
async function laneOf(ctx: PluginContext, cache: Map<string, PlanCandidate['lane']>, model: string): Promise<PlanCandidate['lane']> {
  const provider = providerFromId(model)
  const cached = cache.get(provider)
  if (cached) return cached
  let lane: PlanCandidate['lane'] = 'metered'
  if (ctx.hooks.has('spend.resolveBilling')) {
    try {
      const billing = await ctx.hooks.invoke<{ lane?: string }>('spend.resolveBilling', { model, prospective: false })
      if (billing?.lane === 'subscription') lane = 'subscription'
    } catch {
      lane = 'metered'
    }
  }
  cache.set(provider, lane)
  return lane
}

async function enrichmentEnabled(ctx: PluginContext): Promise<boolean> {
  if (!ctx.hooks.has('assets.enrichmentEnabled')) return true
  try {
    return (await ctx.hooks.invoke<boolean>('assets.enrichmentEnabled', {})) !== false
  } catch {
    return true
  }
}

function eligible(model: AvailableModel): boolean {
  if (model.available === false) return false
  if (model.eligibility?.status === 'ineligible') return false
  return model.kind === undefined || model.kind === 'llm'
}

/** The recommender's input, assembled from live plugin state. */
export async function buildPlanInput(ctx: PluginContext): Promise<PlanInput> {
  const [{ models }, policy, enrichment] = await Promise.all([
    fetchAvailableModels(ctx),
    ctx.runtime.models.routingPolicy(),
    enrichmentEnabled(ctx),
  ])
  const lanes = new Map<string, PlanCandidate['lane']>()
  const candidates: PlanCandidate[] = []
  for (const model of models.filter(eligible)) {
    const pricing = getKnownModel(model.id)?.pricing
    candidates.push({
      id: model.id,
      tier: model.tier,
      lane: await laneOf(ctx, lanes, model.id),
      ...(pricing ? { pricePer1M: pricing.inputPer1M + pricing.outputPer1M } : {}),
      ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
      vision: visionOf(model),
    })
  }
  return {
    candidates,
    currentDefaultModel: policy.defaultModel ? normalizeModelId(policy.defaultModel) : null,
    routing: readRoutingSettings(ctx).routing,
    enrichmentEnabled: enrichment,
  }
}

export interface RouteProposal {
  workClass: WorkClass
  model: string
  reason: string
}
export interface RouteSkip {
  workClass: WorkClass
  reason: string
}

/**
 * The route-only view of a plan for the UNROUTED chores classes — what the
 * routing health check flags and its repair applies. Routed classes are the
 * operator's choice and never proposed here (Simple's "Use recommended
 * plan" shows the full diff instead).
 */
export function routeProposals(plan: PlanRecommendation, routing: RoutingConfig): { proposals: RouteProposal[]; skipped: RouteSkip[] } {
  const routed = new Set(routing.routes.filter((r) => r.model).map((r) => r.workClass))
  const proposals: RouteProposal[] = []
  const skipped: RouteSkip[] = []
  for (const route of plan.routes) {
    if (routed.has(route.workClass)) continue
    if (route.model) proposals.push({ workClass: route.workClass, model: route.model, reason: route.reason })
    else skipped.push({ workClass: route.workClass, reason: route.reason })
  }
  return { proposals, skipped }
}

/** GET /plan payload: current state, the recommendation, and the revision an apply must carry. */
export async function describePlan(ctx: PluginContext) {
  const input = await buildPlanInput(ctx)
  const recommended = recommendPlan(input)
  const { revision } = await getSelectionMutator(ctx).reconcile()
  return {
    revision,
    current: {
      agent: input.currentDefaultModel,
      chores: choresLaneState(input.routing, input.currentDefaultModel),
      enrichmentEnabled: input.enrichmentEnabled,
    },
    recommended,
    routeProposals: routeProposals(recommended, input.routing),
    candidates: input.candidates.length,
  }
}
