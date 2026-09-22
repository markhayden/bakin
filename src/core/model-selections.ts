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
import type { EligibilityReport } from '@/core/model-eligibility'
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

/**
 * Map a source model id onto a target catalog:
 *   1. exact id match → as-is
 *   2. UNIQUE bare-model match (`anything/<model>` present exactly once) →
 *      the target's qualified id (catalogs differ per runtime/provider:
 *      `openai/gpt-5.5` ↔ `openai-codex/gpt-5.5`)
 *   3. otherwise null — reported, never guessed.
 */
export function mapModelToCatalog(sourceModel: string, targetCatalog: readonly string[]): string | null {
  if (targetCatalog.includes(sourceModel)) return sourceModel
  const bare = sourceModel.includes('/') ? sourceModel.slice(sourceModel.indexOf('/') + 1) : sourceModel
  const matches = targetCatalog.filter((id) => id === bare || id.endsWith(`/${bare}`))
  return matches.length === 1 ? matches[0]! : null
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

/** One proposal per DEAD selection (ineligible). Unknown eligibility ⇒ no proposal (missing evidence is not a defect). */
export function proposeRepairs(states: readonly SelectionState[], report: EligibilityReport, opts: ProposeOptions): Proposal[] {
  const eligibleIds = [...report.byModel.entries()].filter(([, e]) => e.eligibility.status === 'eligible').map(([id]) => id)
  const proposals: Proposal[] = []
  for (const state of states) {
    if (state.ref === 'ui:mode' || !state.model) continue
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
