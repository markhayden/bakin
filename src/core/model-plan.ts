/**
 * The model plan — ONE recommender behind the Models page's "Use recommended
 * plan", onboarding's `models` step, `bakin models plan`, and the routing
 * health check's proposals (spec §3.4, D1–D3, D10–D16).
 *
 * Two lanes: the AGENT model (chat, `send`, the five dispatch classes — the
 * runtime's default model) and the CHORES model (`auto-title`, `enrichment`,
 * `relay`, `team-routing`, `skill-mapping`). Pure over a plain input the
 * caller assembles (eligible candidates with merged metadata, the current
 * default, the routing config, whether enrichment is on) — no I/O, no
 * curated vision table import (the caller pre-resolves `vision` from the
 * runtime's `input` modalities, then the curated list, else `null`).
 *
 * Nothing here writes: the result carries the ops a caller may stage or
 * apply through the ONE write path (`POST /selections`). Never auto-applied
 * outside the two carve-outs (onboarding `--yes` on a fresh install; roster
 * carry on a runtime switch).
 */
import { WORK_CLASSES, type RoutingConfig, type WorkClass } from './model-routing'
import type { MutationOp } from './model-mutations'

export type PlanTier = 'budget' | 'standard' | 'premium'
const TIER_RANK: Record<PlanTier, number> = { budget: 0, standard: 1, premium: 2 }

/** An ELIGIBLE model with the metadata the ranking needs (caller-merged; the assembler always resolves a tier). */
export interface PlanCandidate {
  id: string
  tier: PlanTier
  /** Billing lane for the model's provider — decides which ranking applies. */
  lane: 'metered' | 'subscription'
  /** Whole USD per 1M tokens (input + output), when the catalog prices it. */
  pricePer1M?: number
  contextWindow?: number
  /** true/false when known (runtime `input` modalities, then the curated list); null = unknown. */
  vision: boolean | null
}

export interface PlanInput {
  candidates: PlanCandidate[]
  /** The runtime's current default model (qualified id), if any. */
  currentDefaultModel: string | null
  routing: RoutingConfig
  /** Whether asset enrichment runs (the chores lane then needs vision). */
  enrichmentEnabled: boolean
}

/** The five chores classes, in the order the UI lists them. */
export const CHORES_CLASSES: readonly WorkClass[] = WORK_CLASSES
  .filter((cls) => cls.routable && cls.recommendedTier !== undefined)
  .map((cls) => cls.id)

/** Agent-lane routable classes: the five dispatch classes + `send`. */
export const AGENT_CLASSES: readonly WorkClass[] = WORK_CLASSES
  .filter((cls) => cls.routable && cls.recommendedTier === undefined)
  .map((cls) => cls.id)

export interface LanePick {
  model: string | null
  /** Plain-words reason shown next to the pick. */
  why: string
  /** `known` = every requirement verified; `unknown` = ranked below known-suitable and disclosed. */
  suitability: 'known' | 'unknown' | 'none'
}

/** The desired route for one chores class: a model, or null = inherit (unset). */
export interface ChoresRoute {
  workClass: WorkClass
  model: string | null
  /** Plain words for the proposal row or the skip. */
  reason: string
}

export interface PlanRecommendation {
  agent: LanePick
  chores: LanePick
  /** One row per chores class — what the plan wants each route to be. */
  routes: ChoresRoute[]
  /**
   * Where enrichment goes: `chores` (the chores model can see), `agent` (only
   * the agent model can — `route:enrichment → agentModel`), `unset` (no
   * eligible model has vision — enrichment will fail until one is), or
   * `disabled` (enrichment is off; no vision requirement).
   */
  enrichment: 'chores' | 'agent' | 'unset' | 'disabled'
  /** Ops that move the persisted state to this plan (empty = already there). Derived from `routes` + the agent pick. */
  ops: MutationOp[]
  /** Anything the plan could not satisfy or had to assume, in plain words. */
  notes: string[]
}

function tierRank(candidate: PlanCandidate): number {
  return TIER_RANK[candidate.tier]
}

function byId(a: PlanCandidate, b: PlanCandidate): number {
  return a.id.localeCompare(b.id)
}

/**
 * Deterministic within-lane ranking, lightest first (a subscription model
 * sorts before a metered one). Subscription: tier asc, context desc, id.
 * Metered: price asc (unknown price LAST), tier asc, id. Suitability is
 * not a sort key: callers filter known-suitable first, then unknown.
 */
export function rankCandidates(candidates: PlanCandidate[]): PlanCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.lane !== b.lane) return a.lane === 'subscription' ? -1 : 1
    if (a.lane === 'metered') {
      const pa = a.pricePer1M ?? null
      const pb = b.pricePer1M ?? null
      if (pa !== null && pb !== null && pa !== pb) return pa - pb
      if (pa !== null && pb === null) return -1
      if (pa === null && pb !== null) return 1
      if (tierRank(a) !== tierRank(b)) return tierRank(a) - tierRank(b)
      return byId(a, b)
    }
    if (tierRank(a) !== tierRank(b)) return tierRank(a) - tierRank(b)
    const ca = a.contextWindow ?? 0
    const cb = b.contextWindow ?? 0
    if (ca !== cb) return cb - ca
    return byId(a, b)
  })
}

/** Agent pick: the current default if eligible, else the highest-tier eligible model. */
export function pickAgentModel(input: PlanInput): LanePick {
  const current = input.currentDefaultModel
    ? input.candidates.find((c) => c.id === input.currentDefaultModel) ?? null
    : null
  if (current) {
    return { model: current.id, why: 'Your current default model — it can run here.', suitability: 'known' }
  }
  if (input.candidates.length === 0) {
    return { model: null, why: 'No model can run here yet — add credentials for a provider first.', suitability: 'none' }
  }
  const strongest = [...input.candidates].sort((a, b) => {
    if (tierRank(a) !== tierRank(b)) return tierRank(b) - tierRank(a)
    const ca = a.contextWindow ?? 0
    const cb = b.contextWindow ?? 0
    if (ca !== cb) return cb - ca
    return byId(a, b)
  })[0]!
  const why = input.currentDefaultModel
    ? `Your current default (${input.currentDefaultModel}) cannot run here; this is the strongest model that can.`
    : 'The strongest model that can run here.'
  return { model: strongest.id, why, suitability: 'known' }
}

function priceWhy(pick: PlanCandidate, agent: PlanCandidate | null): string {
  if (pick.lane === 'subscription') return 'included in your plan · lightest tier that can do these jobs'
  const own = pick.pricePer1M !== undefined ? `~$${pick.pricePer1M} per 1M tokens` : 'price unknown'
  const versus = agent && agent.id !== pick.id
    ? agent.pricePer1M !== undefined ? ` vs ~$${agent.pricePer1M} for ${agent.id}` : ` vs ${agent.id}`
    : ''
  return `${own}${versus}`
}

/**
 * Chores pick: the lightest suitable candidate LIGHTER than the agent model
 * — not heavier by tier AND ranked before it, so a paid same-tier model never
 * displaces a free subscription agent model; nothing lighter ⇒ the agent
 * model takes the chores too (routes inherit). With enrichment on,
 * "suitable" needs vision: known-capable first, unknown ranked after and
 * disclosed; none of the lighter models can see but the agent model can ⇒
 * the lightest still takes every other chore and enrichment routes to the
 * agent model; nothing eligible can see ⇒ enrichment stays unset and the
 * plan says so.
 */
export function pickChoresModel(input: PlanInput, agent: LanePick): { pick: LanePick; enrichment: PlanRecommendation['enrichment']; notes: string[] } {
  const notes: string[] = []
  const agentCandidate = agent.model ? input.candidates.find((c) => c.id === agent.model) ?? null : null
  const ceiling = agentCandidate ? tierRank(agentCandidate) : Number.POSITIVE_INFINITY
  const notHeavier = rankCandidates(input.candidates.filter((c) => tierRank(c) <= ceiling))
  const agentAt = agentCandidate ? notHeavier.findIndex((c) => c.id === agentCandidate.id) : -1
  const lighter = agentAt === -1 ? notHeavier : notHeavier.slice(0, agentAt)
  const needsVision = input.enrichmentEnabled
  if (lighter.length === 0) {
    if (!agentCandidate) {
      return { pick: { model: null, why: 'No model can run here yet.', suitability: 'none' }, enrichment: needsVision ? 'unset' : 'disabled', notes }
    }
    // Nothing lighter can run: the agent model does the chores (inherit).
    const pick: LanePick = { model: agentCandidate.id, why: 'the agent model — nothing lighter can run here', suitability: 'known' }
    if (!needsVision) return { pick, enrichment: 'disabled', notes }
    if (agentCandidate.vision === true) return { pick, enrichment: 'chores', notes }
    if (agentCandidate.vision === null) {
      notes.push(`Whether ${agentCandidate.id} can see images is unknown here — enrichment may fail until a vision-capable model is confirmed.`)
      return { pick: { ...pick, suitability: 'unknown' }, enrichment: 'chores', notes }
    }
    notes.push('No eligible model can see images — enrichment will fail until a vision-capable model is available.')
    return { pick, enrichment: 'unset', notes }
  }
  const ranked = lighter
  if (!needsVision) {
    const pick = ranked[0]!
    return { pick: { model: pick.id, why: priceWhy(pick, agentCandidate), suitability: 'known' }, enrichment: 'disabled', notes }
  }
  // Known-capable first; unknown ranks below and is disclosed; a model
  // known NOT to see never carries enrichment.
  const capable = ranked.find((c) => c.vision === true) ?? null
  const unknown = ranked.find((c) => c.vision === null) ?? null
  if (capable) {
    return { pick: { model: capable.id, why: priceWhy(capable, agentCandidate), suitability: 'known' }, enrichment: 'chores', notes }
  }
  if (unknown) {
    notes.push(`Whether ${unknown.id} can see images is unknown here — enrichment may fail until a vision-capable model is confirmed.`)
    return { pick: { model: unknown.id, why: priceWhy(unknown, agentCandidate), suitability: 'unknown' }, enrichment: 'chores', notes }
  }
  // Nothing lighter can see: the lightest model takes every other chore.
  const lightest = ranked[0]!
  if (agentCandidate?.vision === true) {
    notes.push(`${lightest.id} cannot see images, so enrichment (captions, OCR, tags) runs on ${agentCandidate.id} instead.`)
    return { pick: { model: lightest.id, why: priceWhy(lightest, agentCandidate), suitability: 'known' }, enrichment: 'agent', notes }
  }
  notes.push('No eligible model can see images — enrichment will fail until a vision-capable model is available.')
  return { pick: { model: lightest.id, why: priceWhy(lightest, agentCandidate), suitability: 'known' }, enrichment: 'unset', notes }
}

/** The routing model currently set for a class, or null (inherit). */
function routedModel(routing: RoutingConfig, workClass: WorkClass): string | null {
  return routing.routes.find((r) => r.workClass === workClass)?.model ?? null
}

/** The desired chores routes: explicit when the chores model differs from the agent model, inherit when it is the same. */
function planRoutes(agent: LanePick, chores: LanePick, enrichment: PlanRecommendation['enrichment']): ChoresRoute[] {
  return CHORES_CLASSES.map((workClass) => {
    if (workClass === 'enrichment' && enrichment === 'agent') {
      return { workClass, model: agent.model, reason: `${agent.model} is the only eligible model that can see images` }
    }
    if (workClass === 'enrichment' && enrichment === 'unset') {
      return { workClass, model: null, reason: 'No eligible model can see images — enrichment will fail until a vision-capable model is available.' }
    }
    if (!chores.model) return { workClass, model: null, reason: 'No model can run here yet.' }
    if (chores.model === agent.model) return { workClass, model: null, reason: 'inherits the agent model — nothing lighter can run here' }
    return { workClass, model: chores.model, reason: chores.why }
  })
}

/** Recommend the two-lane plan and the ops that reach it from the current state. */
export function recommendPlan(input: PlanInput): PlanRecommendation {
  const agent = pickAgentModel(input)
  const { pick: chores, enrichment, notes } = pickChoresModel(input, agent)
  const routes = planRoutes(agent, chores, enrichment)
  const ops: MutationOp[] = []
  if (agent.model && agent.model !== input.currentDefaultModel) {
    ops.push({ ref: 'policy:defaultModel', set: { model: agent.model } })
  }
  for (const route of routes) {
    if (routedModel(input.routing, route.workClass) !== route.model) {
      ops.push({ ref: `route:${route.workClass}`, set: { model: route.model } })
    }
  }
  return { agent, chores, routes, enrichment, ops, notes }
}

/** What Simple shows for the chores lane today. */
export interface ChoresLaneState {
  /** ONE model when every chores route names the same model and none sets thinking; else null. */
  model: string | null
  /** Distinct models across the five routes (unrouted counts as inherit = the agent model). */
  models: string[]
  mixed: boolean
}

export function choresLaneState(routing: RoutingConfig, defaultModel: string | null): ChoresLaneState {
  const models = new Set<string>()
  let thinkingSet = false
  for (const workClass of CHORES_CLASSES) {
    const route = routing.routes.find((r) => r.workClass === workClass)
    models.add(route?.model ?? defaultModel ?? 'inherit')
    if (route?.thinking && route.thinking !== 'inherit') thinkingSet = true
  }
  const list = [...models]
  const mixed = list.length !== 1 || thinkingSet
  return { model: mixed ? null : list[0]!, models: list, mixed }
}
