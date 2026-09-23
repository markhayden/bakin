/**
 * Plugin-side composition of the model plan (spec §3.4): feeds the core
 * assembler (`src/core/model-plan-input.ts`) this plugin's cached,
 * eligibility-overlaid catalog + routing settings and the spend/assets
 * plugins' facts (lane overrides, enrichment toggle) via hooks, remembers
 * the last plan for dead-selection proposals, and derives the route-only
 * proposal view the routing health check + repair consume.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import type { BillingOverride } from '@bakin/core/llm/billing-lane'

import { createLogger } from '../../../src/core/logger'
import { assemblePlanInput } from '../../../src/core/model-plan-input'
import {
  choresLaneState,
  recommendPlan,
  type PlanInput,
  type PlanRecommendation,
} from '../../../src/core/model-plan'
import type { RoutingConfig, WorkClass } from '../../../src/core/model-routing'
import { fetchAvailableModels } from './available-models'
import { readRoutingSettings } from './routing-settings'

const log = createLogger('models:plan')

/** Cross-plugin reads with honest defaults: absent hook or a throw never blocks a plan (a throw is logged — it changes the ranking). */
async function hookOr<T>(ctx: PluginContext, name: string, fallback: T): Promise<T> {
  if (!ctx.hooks.has(name)) return fallback
  try {
    return (await ctx.hooks.invoke<T>(name, {})) ?? fallback
  } catch (err) {
    log.warn('Plan input hook failed; using its fallback', { hook: name, err: err instanceof Error ? err.message : String(err) })
    return fallback
  }
}

/** The recommender's input over the cached, eligibility-overlaid catalog + the spend/assets plugins' facts. */
export async function buildPlanInput(ctx: PluginContext): Promise<PlanInput> {
  const [{ models }, enrichmentEnabled, billingOverrides] = await Promise.all([
    fetchAvailableModels(ctx),
    hookOr<boolean>(ctx, 'assets.enrichmentEnabled', true),
    hookOr<BillingOverride[]>(ctx, 'spend.listBillingOverrides', []),
  ])
  return assemblePlanInput({
    runtime: ctx.runtime,
    rows: models,
    routing: readRoutingSettings(ctx).routing,
    enrichmentEnabled: enrichmentEnabled !== false,
    billingOverrides,
  })
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
 * plan" shows the full diff instead). A plan row that names the AGENT model
 * (enrichment when only the agent model can see) is a skip: unrouted already
 * inherits it, and proposing it would be a standing false finding whose
 * repair routes background work to the premium model.
 */
export function routeProposals(plan: PlanRecommendation, routing: RoutingConfig): { proposals: RouteProposal[]; skipped: RouteSkip[] } {
  const routed = new Set(routing.routes.filter((r) => r.model).map((r) => r.workClass))
  const proposals: RouteProposal[] = []
  const skipped: RouteSkip[] = []
  for (const route of plan.routes) {
    if (routed.has(route.workClass)) continue
    if (route.model && route.model === plan.agent.model) skipped.push({ workClass: route.workClass, reason: `inherits the agent model (${route.reason})` })
    else if (route.model) proposals.push({ workClass: route.workClass, model: route.model, reason: route.reason })
    else skipped.push({ workClass: route.workClass, reason: route.reason })
  }
  return { proposals, skipped }
}

const holder = globalThis as typeof globalThis & { __bakinLastModelPlan?: PlanRecommendation }

/** The most recent plan computed in this process — dead-selection proposals read it (stale-tolerant: every proposal is re-checked for eligibility). */
export function lastPlan(): PlanRecommendation | null {
  return holder.__bakinLastModelPlan ?? null
}

/** Compute the plan over live state and remember it. */
export async function currentPlan(ctx: PluginContext): Promise<PlanRecommendation> {
  const plan = recommendPlan(await buildPlanInput(ctx))
  holder.__bakinLastModelPlan = plan
  return plan
}

/** GET /plan payload: current state, the recommendation, and the revision an apply must carry (the caller reads it off the mutator). */
export async function describePlan(ctx: PluginContext, revision: string) {
  const input = await buildPlanInput(ctx)
  const recommended = recommendPlan(input)
  holder.__bakinLastModelPlan = recommended
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
