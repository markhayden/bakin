/**
 * Assembles the model plan's input (spec §3.4) from catalog rows + runtime
 * facts — the ONE place candidate metadata is resolved, so the Models page,
 * `bakin models plan`, the routing health check and onboarding (which runs
 * without plugins loaded) rank the same models the same way.
 *
 * Rows arrive already eligibility-overlaid (the models plugin's cached
 * catalog, or a live listing folded through `getModelEligibility`).
 * Vision resolves runtime `input` modalities first (Pi reports them), then
 * the curated vision list (which only ever says yes), else unknown.
 * Lanes resolve per PROVIDER: an operator override wins, then the
 * runtime's credential shapes (`@bakin/core/llm/billing-lane`), else
 * metered.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { detectLanesFromCredentials, resolveLaneFor, type BillingLane, type BillingOverride } from '@bakin/core/llm/billing-lane'
import { getKnownModel } from '@bakin/core/llm/model-catalog'
import { normalizeModelId, providerFromId, tierFromId } from '@bakin/core/llm/model-id'
import { VISION_MODELS } from '@bakin/core/llm/vision-models'

import { createLogger } from './logger'
import { getModelEligibility } from './model-eligibility'
import type { PlanCandidate, PlanInput, PlanRecommendation, PlanTier } from './model-plan'
import { CHORES_CLASSES } from './model-plan'
import type { RoutingConfig } from './model-routing'

const log = createLogger('model-plan-input')
const VISION_IDS = new Set(VISION_MODELS.map((m) => m.id))

/** A catalog row with the fields the plan needs; eligibility already overlaid. */
export interface PlanCatalogRow {
  id: string
  tier?: PlanTier
  input?: string
  contextWindow?: number
  kind?: 'llm' | 'image' | 'video'
  available?: boolean
  eligibility?: { status: 'eligible' | 'ineligible' | 'unknown' }
}

export function visionOf(model: { id: string; input?: string }): boolean | null {
  if (model.input) return model.input.split(',').map((s) => s.trim()).includes('image')
  return VISION_IDS.has(model.id) ? true : null
}

function eligible(row: PlanCatalogRow): boolean {
  if (row.available === false) return false
  if (row.eligibility?.status === 'ineligible') return false
  return row.kind === undefined || row.kind === 'llm'
}

export interface AssemblePlanInputOptions {
  runtime: AgentRuntimeAdapter
  rows: PlanCatalogRow[]
  routing: RoutingConfig
  enrichmentEnabled: boolean
  /** Operator lane overrides (the spend plugin's `billing.overrides`); provider-level entries apply. */
  billingOverrides?: BillingOverride[]
}

/** Best-effort: a runtime that cannot report credentials leaves every lane metered (conservative), never blocks the plan. */
async function detectLanes(runtime: AgentRuntimeAdapter): Promise<Record<string, BillingLane>> {
  try {
    return detectLanesFromCredentials((await runtime.credentialStatus()).llmCredentials)
  } catch (err) {
    log.warn('Billing-lane detection failed; plan lanes default to metered', { err: err instanceof Error ? err.message : String(err) })
    return {}
  }
}

export async function assemblePlanInput(opts: AssemblePlanInputOptions): Promise<PlanInput> {
  const [policy, detected] = await Promise.all([opts.runtime.models.routingPolicy(), detectLanes(opts.runtime)])
  const overrides = opts.billingOverrides ?? []
  const candidates: PlanCandidate[] = opts.rows.filter(eligible).map((row) => {
    const pricing = getKnownModel(row.id)?.pricing
    const { lane } = resolveLaneFor({ provider: providerFromId(row.id), overrides, detected })
    return {
      id: row.id,
      tier: row.tier ?? getKnownModel(row.id)?.tier ?? tierFromId(row.id),
      lane,
      ...(pricing ? { pricePer1M: pricing.inputPer1M + pricing.outputPer1M } : {}),
      ...(row.contextWindow !== undefined ? { contextWindow: row.contextWindow } : {}),
      vision: visionOf(row),
    }
  })
  return {
    candidates,
    currentDefaultModel: policy.defaultModel ? normalizeModelId(policy.defaultModel) : null,
    routing: opts.routing,
    enrichmentEnabled: opts.enrichmentEnabled,
  }
}

/**
 * Catalog rows straight from the runtime, eligibility-overlaid — for callers
 * without the models plugin's cache (onboarding). Runtime-unavailable rows
 * are kept flagged (never silently dropped) so the overlay can explain them.
 */
export async function listPlanCatalogRows(runtime: AgentRuntimeAdapter): Promise<PlanCatalogRow[]> {
  const listed = await runtime.models.listAvailable({ includeUnavailable: true })
  const rows = listed.filter((m) => Boolean(m.id)).map((m) => ({
    id: normalizeModelId(m.id),
    available: m.available ?? true,
    ...(m.unavailableReason ? { unavailableReason: m.unavailableReason } : {}),
    ...(m.local ? { local: true } : {}),
    ...(m.input ? { input: m.input } : {}),
    ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
  }))
  const report = await getModelEligibility(runtime, { catalog: rows })
  return rows.map((row) => {
    const entry = report.byModel.get(row.id)
    return {
      id: row.id,
      available: row.available,
      ...(row.input ? { input: row.input } : {}),
      ...(row.contextWindow !== undefined ? { contextWindow: row.contextWindow } : {}),
      ...(entry ? { eligibility: { status: entry.eligibility.status } } : {}),
    }
  })
}

/** The plan's answer for a dead selection ref: chores routes get the chores lane, everything else the agent model. */
export function recommendForRef(plan: PlanRecommendation, ref: string): string | null {
  const [kind, name] = ref.split(':')
  if (kind === 'route' && name && (CHORES_CLASSES as readonly string[]).includes(name)) {
    const route = plan.routes.find((r) => r.workClass === name)
    if (route?.model) return route.model
    // Inherit ⇒ the chores model reads through — except enrichment when only
    // the agent model can see; an unset enrichment (nobody sees) has no honest answer.
    if (name === 'enrichment' && plan.enrichment === 'unset') return null
    if (name === 'enrichment' && plan.enrichment === 'agent') return plan.agent.model
    return plan.chores.model ?? plan.agent.model
  }
  return plan.agent.model
}
