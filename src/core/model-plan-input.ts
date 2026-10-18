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
import { readUsageByAgentModelDaySince, toLocalDayKey } from '@bakin/core/usage-history/store'

import { listModelProbeSuccessesSince } from './execution-ledger'
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

/** How far back a model must have run (or passed a probe) to count as proven here. */
export const PROOF_WINDOW_DAYS = 7

/**
 * Models with POSITIVE evidence of running here in the proof window: tokens
 * observed in usage history (every turn, inherited-model ones included), or
 * a passing probe. A runtime listing is not proof — margo's stale listing
 * still offered a model retired upstream (2026-10-18). Each source fails
 * closed: unreadable evidence proves nothing, it never proves everything.
 */
export interface ProvenModels {
  /** Proven for the install: any agent ran it, or a probe passed. */
  any: Set<string>
  /** Proven for ONE agent: that agent produced tokens on it (its own credentials). */
  byAgent: Map<string, Set<string>>
}

export function provenModels(now: number = Date.now()): ProvenModels {
  const proven: ProvenModels = { any: new Set(), byAgent: new Map() }
  try {
    for (const cell of readUsageByAgentModelDaySince(toLocalDayKey(now - PROOF_WINDOW_DAYS * 86_400_000))) {
      if (!cell.model || cell.tokens.total <= 0) continue
      const id = normalizeModelId(cell.model)
      proven.any.add(id)
      let mine = proven.byAgent.get(cell.agent)
      if (!mine) proven.byAgent.set(cell.agent, mine = new Set())
      mine.add(id)
    }
  } catch (err) {
    log.warn('Usage history unreadable; no model is proven by usage', { err: err instanceof Error ? err.message : String(err) })
  }
  try {
    for (const model of listModelProbeSuccessesSince(now - PROOF_WINDOW_DAYS * 86_400_000)) proven.any.add(normalizeModelId(model))
  } catch (err) {
    log.warn('Probe evidence unreadable; no model is proven by probe', { err: err instanceof Error ? err.message : String(err) })
  }
  return proven
}

/** Install-wide proof (the plan's lanes are install-wide). */
export function provenModelIds(now: number = Date.now()): Set<string> {
  return provenModels(now).any
}

/**
 * Whether `model` is proven for a selection `ref`. An `agent:<id>:*` pin runs
 * under THAT agent's credentials, so only that agent's own usage proves it
 * (a probe or another agent's run says nothing about its access); every
 * other ref is install-wide.
 */
export function provenForRef(proven: ProvenModels, model: string, ref: string): boolean {
  const agent = /^agent:([^:]+):/.exec(ref)?.[1]
  return agent ? proven.byAgent.get(agent)?.has(model) === true : proven.any.has(model)
}

const RESOLVED_PROOF_TTL_MS = 30_000
let resolvedProof = new WeakMap<object, { at: number; value: Promise<ProvenModels> }>()

/** Forget memoized proof — new evidence landed (a probe pass) within the TTL. */
export function invalidateResolvedProof(): void {
  resolvedProof = new WeakMap()
}

/**
 * `provenModels` resolved to catalog ids: usage history records whatever the
 * runtime transcript said (a bare `gpt-5.5` on Pi), so bare ids go through
 * the runtime's own `models.resolveId` (each distinct id once). Memoized per
 * runtime for a few seconds — one page load computes the plan AND the
 * selection proposals, and Pi refreshes its registry on every resolve.
 */
export function resolveProvenModels(runtime: AgentRuntimeAdapter, now: number = Date.now()): Promise<ProvenModels> {
  const hit = resolvedProof.get(runtime)
  if (hit && now - hit.at < RESOLVED_PROOF_TTL_MS) return hit.value
  const value = (async () => {
    const raw = provenModels(now)
    const resolveId = runtime.models.resolveId?.bind(runtime.models)
    if (!resolveId) return raw
    const bare = [...raw.any].filter((id) => !id.includes('/'))
    const canonical = new Map<string, string>()
    await Promise.all(bare.map(async (id) => {
      try {
        const resolved = await resolveId(id)
        if (resolved) canonical.set(id, normalizeModelId(resolved))
      } catch (err) {
        log.warn('Could not resolve a proven model id', { id, err: err instanceof Error ? err.message : String(err) })
      }
    }))
    const widen = (set: Set<string>) => {
      for (const id of [...set]) {
        const resolved = canonical.get(id)
        if (resolved) set.add(resolved)
      }
    }
    widen(raw.any)
    for (const set of raw.byAgent.values()) widen(set)
    return raw
  })()
  resolvedProof.set(runtime, { at: now, value })
  value.catch(() => { resolvedProof.delete(runtime) })
  return value
}

/** Install-wide resolved proof. */
export async function resolveProvenModelIds(runtime: AgentRuntimeAdapter, now: number = Date.now()): Promise<Set<string>> {
  return (await resolveProvenModels(runtime, now)).any
}

export interface AssemblePlanInputOptions {
  runtime: AgentRuntimeAdapter
  rows: PlanCatalogRow[]
  routing: RoutingConfig
  enrichmentEnabled: boolean
  /** Operator lane overrides (the spend plugin's `billing.overrides`); provider-level entries apply. */
  billingOverrides?: BillingOverride[]
  /** Positive-evidence model ids (defaults to `resolveProvenModelIds(runtime)`). */
  proven?: Set<string>
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
  const proven = opts.proven ?? await resolveProvenModelIds(opts.runtime)
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
      proven: proven.has(row.id),
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
