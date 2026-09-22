/**
 * Persisted model selections — the ONE inventory of every place a model id
 * is stored on this install (#907): the runtime's routing policy (default,
 * fallbacks, subagent default, aliases), each agent's pins, and the models
 * plugin's work-class routes / tag overrides / UI mode.
 *
 * Three jobs live here, all read-only:
 *   - enumerateSelections: refs → current state, tagged with the DOCUMENT a
 *     write to that ref lands in (policy / agent:<id> / routing) — the real
 *     write boundary the mutation path reserves.
 *   - computeRevision: one hash over everything a mutation can change, so a
 *     write can be refused when it was planned against stale state.
 *   - proposeRepairs: for each dead selection, the same model id under a
 *     credentialed provider (the #907 fix), else the lane recommender's pick,
 *     else an honest `to: null`. Never applied here.
 *
 * mapModelToCatalog is the shared same-id rule — roster-reconcile imports it
 * so the runtime switch and these proposals can never disagree.
 */
import { createHash } from 'crypto'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { getModelEligibility, type Eligibility, type EligibilityDeps, type EligibilityOptions, type EligibilityReport, type EvidenceStatus } from '@/core/model-eligibility'
import { mapModelToCatalog } from '@/core/model-id-map'
import { ROUTABLE_WORK_CLASSES, type RoutingConfig, type ThinkingSetting, type WorkClass } from '@/core/model-routing'

export type SelectionDocument = 'policy' | `agent:${string}` | 'routing'

export interface SelectionState {
  ref: string
  /** Qualified model id, or null when unset / inheriting. For `ui:mode` the mode string. */
  model: string | null
  thinking?: ThinkingSetting
  document: SelectionDocument
  /** Human label for callouts ("H'enrich", "Relay", "Default model"). */
  label: string
}

export type UiMode = 'simple' | 'advanced'

export interface EnumerateOptions {
  routing: RoutingConfig
  uiMode?: UiMode | null
}

/** Which write boundary a ref belongs to. Unknown families throw — a ref is never guessed. */
export function documentOf(ref: string): SelectionDocument {
  if (ref.startsWith('policy:')) return 'policy'
  if (ref.startsWith('agent:')) {
    const [, agentId] = ref.split(':')
    if (!agentId) throw new Error(`malformed agent ref: ${ref}`)
    return `agent:${agentId}`
  }
  if (ref.startsWith('route:') || ref.startsWith('tag:') || ref === 'ui:mode') return 'routing'
  throw new Error(`unknown selection ref family: ${ref}`)
}

export async function enumerateSelections(runtime: AgentRuntimeAdapter, opts: EnumerateOptions): Promise<SelectionState[]> {
  const [policy, agents] = await Promise.all([runtime.models.routingPolicy(), runtime.agents.list()])
  const states: SelectionState[] = []

  states.push({ ref: 'policy:defaultModel', model: policy.defaultModel || null, document: 'policy', label: 'Default model' })
  states.push({ ref: 'policy:defaultSubagentModel', model: policy.defaultSubagentModel ?? null, document: 'policy', label: 'Default subagent model' })
  policy.fallbackModels.forEach((model, n) => {
    states.push({ ref: `policy:fallback:${n}`, model, document: 'policy', label: `Fallback ${n + 1}` })
  })
  for (const [name, target] of Object.entries(policy.aliases ?? {})) {
    states.push({ ref: `policy:alias:${name}`, model: target, document: 'policy', label: `Alias ${name}` })
  }

  for (const agent of agents) {
    states.push({ ref: `agent:${agent.id}:model`, model: agent.model ?? null, document: `agent:${agent.id}`, label: agent.name || agent.id })
    states.push({ ref: `agent:${agent.id}:subagentModel`, model: agent.subagentModel ?? null, document: `agent:${agent.id}`, label: `${agent.name || agent.id} subagents` })
  }

  const routeByClass = new Map(opts.routing.routes.map((r) => [r.workClass, r]))
  for (const workClass of ROUTABLE_WORK_CLASSES as readonly WorkClass[]) {
    const route = routeByClass.get(workClass)
    states.push({
      ref: `route:${workClass}`,
      model: route?.model ?? null,
      ...(route?.thinking ? { thinking: route.thinking } : {}),
      document: 'routing',
      label: workClass,
    })
  }
  for (const tag of opts.routing.tagOverrides) {
    states.push({
      ref: `tag:${tag.tag}`,
      model: tag.model ?? null,
      ...(tag.thinking ? { thinking: tag.thinking } : {}),
      document: 'routing',
      label: tag.tag,
    })
  }

  states.push({ ref: 'ui:mode', model: opts.uiMode ?? null, document: 'routing', label: 'Models page mode' })
  return states
}

/**
 * Stable hash over every (ref, model, thinking) — fallback ORDER rides the
 * indexed refs, alias targets ride their named refs, the page mode rides
 * `ui:mode`. Order-independent input; any change any mutation can make
 * changes the hash.
 */
export function computeRevision(states: readonly SelectionState[]): string {
  const rows = [...states]
    .map((s) => `${s.ref}\u0000${s.model ?? ''}\u0000${s.thinking ?? ''}`)
    .sort()
  return createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 24)
}

export { mapModelToCatalog }

/** The agent a ref belongs to (`agent:<id>:model` / `agent:<id>:subagentModel`), else null. */
function agentOfRef(ref: string): string | null {
  const m = /^agent:([^:]+):/.exec(ref)
  return m ? m[1]! : null
}

const EVIDENCE_RANK: Record<EvidenceStatus, number> = { ok: 0, partial: 1, failed: 2 }
function worst(a: EvidenceStatus, b: EvidenceStatus): EvidenceStatus {
  return EVIDENCE_RANK[b] > EVIDENCE_RANK[a] ? b : a
}

export interface SelectionEvaluation {
  /** The report for refs that are not agent-scoped (runtime policy, routing, page mode). */
  report: EligibilityReport
  /** The report a selection is judged by: an agent pin uses THAT agent's credentials (OpenClaw keys them per agent). */
  reportFor(state: Pick<SelectionState, 'ref'>): EligibilityReport
  eligibilityOf(state: Pick<SelectionState, 'ref' | 'model'>): Eligibility | undefined
  /** Worst evidence across every report consulted. */
  evidence: EligibilityReport['evidence']
}

/**
 * Evaluate every selection under the RIGHT credentials: one unscoped report
 * for policy/routing refs, plus one per agent that holds a pin — an
 * unscoped read condemns a pin the agent can run (or admits one it cannot)
 * whenever credentials differ per agent.
 */
export async function evaluateSelections(
  runtime: AgentRuntimeAdapter,
  states: readonly SelectionState[],
  deps?: EligibilityDeps,
  opts: Pick<EligibilityOptions, 'catalog' | 'epoch'> = {},
): Promise<SelectionEvaluation> {
  const modelOf = (s: SelectionState) => (s.ref !== 'ui:mode' && typeof s.model === 'string' && s.model.length > 0 ? s.model : null)
  const unscopedIds = states.filter((s) => agentOfRef(s.ref) === null).map(modelOf).filter((m): m is string => m !== null)
  const byAgent = new Map<string, string[]>()
  for (const s of states) {
    const agentId = agentOfRef(s.ref)
    const model = modelOf(s)
    if (!agentId || !model) continue
    byAgent.set(agentId, [...(byAgent.get(agentId) ?? []), model])
  }
  const [report, ...agentReports] = await Promise.all([
    getModelEligibility(runtime, { ...opts, extraIds: unscopedIds }, deps),
    ...[...byAgent].map(([agentId, ids]) => getModelEligibility(runtime, { ...opts, agentId, extraIds: ids }, deps).then((r) => [agentId, r] as const)),
  ])
  const perAgent = new Map(agentReports)
  const reportFor = (state: Pick<SelectionState, 'ref'>) => {
    const agentId = agentOfRef(state.ref)
    return (agentId ? perAgent.get(agentId) : undefined) ?? report
  }
  let evidence = report.evidence
  for (const r of perAgent.values()) {
    evidence = {
      catalog: worst(evidence.catalog, r.evidence.catalog),
      runtimeAvailability: worst(evidence.runtimeAvailability, r.evidence.runtimeAvailability),
      credentials: worst(evidence.credentials, r.evidence.credentials),
      rejections: worst(evidence.rejections, r.evidence.rejections),
    }
  }
  return {
    report,
    reportFor,
    eligibilityOf: (state) => (state.model ? reportFor(state).byModel.get(state.model)?.eligibility : undefined),
    evidence,
  }
}

export type ProposalSource = 'same-id-credentialed-provider' | 'recommender' | 'none'

export interface Proposal {
  ref: string
  from: string
  to: string | null
  /** The eligibility detail of the dead selection, in plain words. */
  reason: string
  source: ProposalSource
  /** Revision the proposal was computed against; applying under another revision is refused. */
  revision: string
}

export interface ProposeOptions {
  /** Lane recommender hook: the best eligible model for this ref, or null. */
  recommendFor: (ref: string) => string | null
  revision: string
}

/**
 * One proposal per DEAD selection (ineligible). Unknown eligibility ⇒ no
 * proposal (missing evidence is not a defect). `report` is one report for
 * every state, or a per-state resolver (`evaluateSelections().reportFor`) so
 * an agent pin is judged — and repaired — under its own credentials.
 */
export function proposeRepairs(
  states: readonly SelectionState[],
  report: EligibilityReport | ((state: SelectionState) => EligibilityReport),
  opts: ProposeOptions,
): Proposal[] {
  const reportOf = typeof report === 'function' ? report : () => report
  const eligibleCache = new Map<EligibilityReport, string[]>()
  const eligibleIn = (r: EligibilityReport) => {
    let ids = eligibleCache.get(r)
    if (!ids) {
      ids = [...r.byModel.entries()].filter(([, e]) => e.eligibility.status === 'eligible').map(([id]) => id)
      eligibleCache.set(r, ids)
    }
    return ids
  }
  const proposals: Proposal[] = []
  for (const state of states) {
    if (state.ref === 'ui:mode' || !state.model) continue
    const report = reportOf(state)
    const eligibleIds = eligibleIn(report)
    const entry = report.byModel.get(state.model)
    if (!entry || entry.eligibility.status !== 'ineligible') continue
    const sameId = mapModelToCatalog(state.model, eligibleIds)
    if (sameId && sameId !== state.model) {
      proposals.push({ ref: state.ref, from: state.model, to: sameId, reason: entry.eligibility.detail, source: 'same-id-credentialed-provider', revision: opts.revision })
      continue
    }
    const recommended = opts.recommendFor(state.ref)
    if (recommended && recommended !== state.model && report.byModel.get(recommended)?.eligibility.status === 'eligible') {
      proposals.push({ ref: state.ref, from: state.model, to: recommended, reason: entry.eligibility.detail, source: 'recommender', revision: opts.revision })
      continue
    }
    proposals.push({ ref: state.ref, from: state.model, to: null, reason: entry.eligibility.detail, source: 'none', revision: opts.revision })
  }
  return proposals
}

// ---------------------------------------------------------------------------
// Reset to this plan (spec §3.4, S6)
// ---------------------------------------------------------------------------

/** The routing knobs the active runtime persists — a knob it cannot is skipped and DISCLOSED, never silently attempted. */
export interface ResetSupport {
  fallbackModels: boolean
  defaultSubagentModel: boolean
  aliases: boolean
  perAgentSubagentModel: boolean
}

export interface ResetOp {
  ref: string
  set: { model?: string | null; thinking?: ThinkingSetting | null }
}

export interface ResetPlan {
  ops: ResetOp[]
  /** Customizations the reset leaves in place because the runtime cannot clear them. */
  skipped: Array<{ ref: string; label: string; reason: string }>
}

const CHORES_CLASSES: readonly string[] = ['auto-title', 'enrichment', 'relay', 'team-routing', 'skill-mapping']

/**
 * Everything Simple cannot express goes back to the two lanes: agent pins
 * cleared, subagent pins / fallbacks / default subagent / aliases cleared
 * where the runtime supports them, dispatch + send routes and tag
 * overrides cleared, chores-route thinking cleared, and the five chores
 * routes set to `plan.chores` (null = inherit the agent model). The agent
 * lane (`policy:defaultModel`) is "this plan" and stays as it is.
 */
/** The fields the reset reads — the core state or its wire twin (`document` is irrelevant here). */
export type ResetInputState = Pick<SelectionState, 'ref' | 'model' | 'label'> & { thinking?: string }

export function buildResetOps(states: readonly ResetInputState[], support: ResetSupport, plan: { chores: string | null }): ResetPlan {
  const ops: ResetOp[] = []
  const skipped: ResetPlan['skipped'] = []
  for (const s of states) {
    const [family, second, third] = s.ref.split(':')
    if (family === 'agent' && second) {
      if (third === 'model' && s.model) ops.push({ ref: s.ref, set: { model: null } })
      if (third === 'subagentModel' && s.model) {
        if (support.perAgentSubagentModel) ops.push({ ref: s.ref, set: { model: null } })
        else skipped.push({ ref: s.ref, label: s.label, reason: 'the active runtime does not manage per-agent subagent models' })
      }
      continue
    }
    if (family === 'policy') {
      if (second === 'defaultSubagentModel' && s.model) {
        if (support.defaultSubagentModel) ops.push({ ref: s.ref, set: { model: null } })
        else skipped.push({ ref: s.ref, label: s.label, reason: 'the active runtime does not manage a default subagent model' })
      }
      if (second === 'fallback' && s.model) {
        if (support.fallbackModels) ops.push({ ref: s.ref, set: { model: null } })
        else skipped.push({ ref: s.ref, label: s.label, reason: 'the active runtime does not manage fallback models' })
      }
      if (second === 'alias' && s.model) {
        if (support.aliases) ops.push({ ref: s.ref, set: { model: null } })
        else skipped.push({ ref: s.ref, label: s.label, reason: 'the active runtime does not manage aliases' })
      }
      continue
    }
    if (family === 'route' && second) {
      const thinkingSet = s.thinking !== undefined && s.thinking !== 'inherit'
      if (CHORES_CLASSES.includes(second)) {
        const set: ResetOp['set'] = {}
        if ((s.model ?? null) !== plan.chores) set.model = plan.chores
        if (thinkingSet) set.thinking = null
        if (Object.keys(set).length > 0) ops.push({ ref: s.ref, set })
      } else if (s.model || thinkingSet) {
        ops.push({ ref: s.ref, set: { ...(s.model ? { model: null } : {}), ...(thinkingSet ? { thinking: null } : {}) } })
      }
      continue
    }
    if (family === 'tag') {
      ops.push({ ref: s.ref, set: { model: null, thinking: null } })
    }
  }
  return { ops, skipped }
}
