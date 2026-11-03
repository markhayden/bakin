/**
 * models.dead-selections — the doctor check for persisted model selections
 * that cannot run on this install (#907), plus its one-click repair.
 *
 * One finding PER SELECTION (agent pin, route, tag, policy field), never per
 * failed asset or turn. Each finding carries the proposal the page shows;
 * the repair applies EXACTLY that {ref, from, to, revision} through the ONE
 * write path, so a stale proposal is refused rather than silently redirected.
 * Missing evidence (credential inventory, catalog, rejections) is ONE
 * unknown finding per source — selections whose verdict depends on it are
 * `unknown`, not dead, and produce no per-selection noise.
 */
import { createHash } from 'crypto'

import type { HealthCheckRunInput, HealthIncidentDeclaration, HealthRepairActionDefinition } from '@bakin/core/plugin-types'
import { healthError, healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthObservationInput, HealthRepairPlanItem, HealthRepairPlanItemInput, HealthRepairTarget, ModelEligibilitySummary } from '@makinbakin/sdk/types'
import type { EvidenceStatus } from '../../../src/core/model-eligibility'
import type { MutateResult } from '../../../src/core/model-mutations'
import type { Proposal, SelectionState } from '../../../src/core/model-selections'

export const DEAD_SELECTION_REPAIR_ID = 'apply-model-proposal'
export const DEAD_SELECTIONS_CHECK_ID = 'models.dead-selections'
const INCIDENT_KEY_PREFIX = 'dead-selection:'

/**
 * models.dead-selections incident families (re-homing rows 157–159): a
 * failed evidence source is an observation; a dead selection with a
 * proposal is the one-click repoint, without one the operator chooses.
 * Both are required only while the selection is IN USE (rows 158/159 "AR
 * while in use"): defaults, fallbacks, routes with a model and live agents'
 * pins are resolved by turns by construction; a tag override is in use
 * while an open task carries its tag; an alias while another selection
 * names it. (Selections are enumerated from the LIVE roster — a removed
 * agent's pin never appears here.)
 */
export const MODELS_DEAD_SELECTIONS_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'dead-selection', subjectKind: 'setting', resolution: { type: 'repair', actionId: DEAD_SELECTION_REPAIR_ID }, required: 'owner-decides' },
  { id: 'dead-selection-manual', subjectKind: 'setting', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
]

export interface SelectionsDescription {
  revision: string
  states: Array<SelectionState & { eligibility?: ModelEligibilitySummary }>
  proposals: Proposal[]
  pending: unknown[]
  evidence: { catalog: EvidenceStatus; runtimeAvailability: EvidenceStatus; credentials: EvidenceStatus; rejections: EvidenceStatus }
}

export interface DeadSelectionDeps {
  /** The same payload GET /selections serves. */
  describe(): Promise<SelectionsDescription>
  /**
   * Apply proposals through the validated mutation path in ONE call under
   * their shared revision (every proposal of a plan carries the same one;
   * applying them one by one would make the second stale). Throws
   * MutationRefused on stale/pending.
   */
  apply(proposals: Proposal[]): Promise<MutateResult>
  /** The tags carried by OPEN tasks (every column but done/archived): the usage fact for tag overrides. */
  openTaskTags(): Promise<ReadonlySet<string>>
}

/**
 * Whether turns resolve to this selection today. `usage` null = the task
 * fact could not be read: a tag override is then NOT presumed in use
 * (never red on a guess) and the check says so in its own observation.
 */
export function selectionInUse(state: SelectionState, states: readonly SelectionState[], usage: ReadonlySet<string> | null): boolean {
  if (state.ref.startsWith('tag:')) return usage !== null && usage.has(state.ref.slice('tag:'.length))
  if (state.ref.startsWith('policy:alias:')) {
    const alias = state.ref.slice('policy:alias:'.length)
    return states.some((other) => other.ref !== state.ref && other.model === alias)
  }
  return true
}

const EVIDENCE_LABEL: Record<keyof SelectionsDescription['evidence'], string> = {
  catalog: 'the runtime model catalog',
  runtimeAvailability: 'runtime model availability',
  credentials: 'provider credentials',
  rejections: 'account rejection history',
}

export async function checkDeadSelections(deps: DeadSelectionDeps): Promise<HealthCheckRunInput> {
  const desc = await deps.describe()
  const observations: HealthObservationInput[] = []

  for (const [source, status] of Object.entries(desc.evidence) as Array<[keyof SelectionsDescription['evidence'], EvidenceStatus]>) {
    if (status === 'ok') continue
    // Row 157: an observation — nothing is refused or repaired on missing evidence.
    observations.push(healthUnknown({
      key: `evidence:${source}`,
      summary: status === 'partial'
        ? `Could only partly read ${EVIDENCE_LABEL[source]} — some models cannot be verified.`
        : `Could not read ${EVIDENCE_LABEL[source]} — models that depend on it cannot be verified.`,
      detail: 'Selections that depend on this evidence show as unverified rather than dead; nothing is refused or repaired on missing evidence.',
      evidence: { source, status },
    }))
  }

  // The usage fact for tag overrides; unreadable = its own observation, and
  // dead tag overrides read advisory rather than presumed required.
  let openTags: ReadonlySet<string> | null = null
  if (desc.states.some((state) => state.ref.startsWith('tag:') && state.model && state.eligibility?.status === 'ineligible')) {
    try {
      openTags = await deps.openTaskTags()
    } catch (err) {
      observations.push(healthUnknown({
        key: 'evidence:open-tasks',
        summary: 'Could not read open tasks — whether a dead tag override is in use cannot be verified.',
        detail: `${err instanceof Error ? err.message : String(err)} Dead tag overrides are listed as advisory until the task board can be read.`,
        evidence: { source: 'open-tasks' },
      }))
    }
  }

  const proposalByRef = new Map(desc.proposals.map((p) => [p.ref, p]))
  for (const state of desc.states) {
    if (state.ref === 'ui:mode' || !state.model || state.eligibility?.status !== 'ineligible') continue
    const proposal = proposalByRef.get(state.ref)
    const key = `${INCIDENT_KEY_PREFIX}${state.ref}`
    const href = `/models?ref=${encodeURIComponent(state.ref)}`
    const inUse = selectionInUse(state, desc.states, openTags)
    // A tag override's usage is the task board's fact; when the board could not be read, absence is NOT established (Codex r4 R4-4).
    const usageKnown = !(state.ref.startsWith('tag:') && openTags === null)
    const incident = {
      key,
      title: `${state.label} points at a model that cannot run (${state.eligibility.reason.replace(/_/g, ' ')})`,
      impact: inUse
        ? 'Every turn that resolves to this selection fails at the provider until it is repointed.'
        : usageKnown
          ? 'Nothing resolves to this selection today; the first turn that does will fail at the provider until it is repointed.'
          : 'Whether an open task carries this tag could not be read (see the open-tasks evidence row), so who resolves to this selection is unknown; any turn that does will fail at the provider until it is repointed.',
      class: 'service_failure' as const,
      subject: { kind: 'setting' as const, id: `models.selection.${state.ref}`, label: state.label },
      declarationId: proposal?.to ? 'dead-selection' : 'dead-selection-manual',
      required: inUse,
      resources: [{ kind: 'model_selection' as const, id: state.ref, label: state.label }],
      resolution: proposal?.to
        ? { key: 'apply-proposal', type: 'repair' as const, actionId: DEAD_SELECTION_REPAIR_ID, label: `Use ${proposal.to}` }
        : { key: 'choose-model', type: 'human' as const, needs: 'decision' as const, label: 'Choose another model', href },
    }
    const evidence = {
      ref: state.ref,
      from: state.model,
      to: proposal?.to ?? null,
      reason: state.eligibility.reason,
      source: proposal?.source ?? 'none',
      revision: desc.revision,
      inUse,
      ...(state.ref.startsWith('tag:') ? { usageFact: openTags === null ? 'unavailable' : 'open-tasks' } : {}),
    }
    const summary = `${state.label} uses ${state.model} — ${state.eligibility.detail}.`
    observations.push(inUse
      ? healthError({ key, summary, evidence, incident: { ...incident, disposition: 'action_required' as const } })
      : healthWarning({ key, summary, evidence, incident: { ...incident, disposition: 'advisory' as const } }))
  }

  if (observations.length === 0) {
    observations.push(healthHealthy({ key: 'selections', summary: 'Every persisted model selection can run on this install.' }))
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

/** `models:models:dead-selection:agent:enrich:model` → `agent:enrich:model`. */
function refFromIncidentId(id: string): string | null {
  const idx = id.indexOf(INCIDENT_KEY_PREFIX)
  return idx === -1 ? null : id.slice(idx + INCIDENT_KEY_PREFIX.length)
}

/**
 * A plan item's identity IS the proposal it displayed: {ref, from, to,
 * revision} hashed into the id, so two previews that propose different
 * things for one ref are two different items — applying the first can
 * never pick up what the second planned. The ref rides along for humans.
 */
function planItemId(proposal: Proposal): string {
  const token = createHash('sha256').update(JSON.stringify([proposal.ref, proposal.from, proposal.to, proposal.revision])).digest('hex').slice(0, 16)
  return `${DEAD_SELECTION_REPAIR_ID}:${token}:${proposal.ref}`
}

/** Bounded memory of planned proposals — previews are cheap and repeated; the oldest fall off. */
const PLANNED_LIMIT = 256

export function deadSelectionRepair(deps: DeadSelectionDeps): HealthRepairActionDefinition {
  // What was PLANNED is what gets applied: the proposal (incl. its revision)
  // is held from plan() to apply() under its item id so a change in between
  // is refused by the mutator's revision check instead of being silently
  // re-targeted — and a later preview cannot overwrite an earlier one.
  const planned = new Map<string, Proposal>()
  return {
    id: DEAD_SELECTION_REPAIR_ID,
    name: 'Repoint a dead model selection to the proposed model',
    // Row 158: a routing change widens what the operator authorized (spec D2) — one-click, a policy write.
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: true },
    mutation: 'policy',
    operationPlan: () => ({
      stages: [{ id: 'repoint', kind: 'committing', label: 'Repoint the selections' }],
      pointOfNoReturn: 'repoint',
    }),
    async plan(target: HealthRepairTarget): Promise<HealthRepairPlanItemInput[]> {
      if (target.type !== 'incidents') return []
      const desc = await deps.describe()
      const proposalByRef = new Map(desc.proposals.map((p) => [p.ref, p]))
      const items: HealthRepairPlanItemInput[] = []
      for (const incidentId of target.ids) {
        const ref = refFromIncidentId(incidentId)
        const proposal = ref ? proposalByRef.get(ref) : undefined
        if (!ref || !proposal?.to) continue
        const id = planItemId(proposal)
        planned.delete(id)
        planned.set(id, proposal)
        while (planned.size > PLANNED_LIMIT) planned.delete(planned.keys().next().value!)
        items.push({
          id,
          actionId: DEAD_SELECTION_REPAIR_ID,
          title: `Repoint ${ref} to ${proposal.to}`,
          reason: proposal.reason,
          incidentIds: [incidentId],
          observationIds: [],
          preconditions: [],
          changes: [{
            kind: 'setting',
            target: ref,
            action: 'update',
            description: `${proposal.from} → ${proposal.to} (${proposal.source === 'same-id-credentialed-provider' ? 'same model, credentialed provider' : 'recommended'}; revision ${proposal.revision})`,
          }],
        })
      }
      return items
    },
    async apply(items, op) {
      // The registry namespaces item ids with the owning action id
      // (`models.apply-model-proposal:apply-model-proposal:<token>:<ref>`),
      // so the planned id is whatever follows the LAST marker.
      const marker = `${DEAD_SELECTION_REPAIR_ID}:`
      const plannedIdOf = (item: HealthRepairPlanItem) => item.id.slice(item.id.lastIndexOf(marker))
      const failure = (item: HealthRepairPlanItem, message: string) => ({
        itemId: item.id, actionId: item.actionId, status: 'failed' as const, message, affectedCheckIds: [DEAD_SELECTIONS_CHECK_ID], changes: [],
      })

      // Every proposal of one plan carries the same revision; the first
      // successful write moves it, so the batch goes out as ONE mutation
      // under that shared revision — never one call per selection.
      const live: Array<{ item: HealthRepairPlanItem; plannedId: string; ref: string; proposal: Proposal }> = []
      const results: Array<{ itemId: string; actionId: string; status: 'applied' | 'failed'; message: string; affectedCheckIds: string[]; changes: HealthRepairPlanItem['changes'] }> = []
      for (const item of items) {
        const plannedId = plannedIdOf(item)
        const proposal = planned.get(plannedId)
        if (!proposal?.to) results.push(failure(item, `the repair plan for ${item.title} expired — run the check again`))
        else live.push({ item, plannedId, ref: proposal.ref, proposal })
      }
      const byRevision = new Map<string, typeof live>()
      for (const entry of live) byRevision.set(entry.proposal.revision, [...(byRevision.get(entry.proposal.revision) ?? []), entry])
      if (live.length > 0) op.stage('repoint')
      for (const batch of byRevision.values()) {
        for (const { ref, proposal } of batch) op.item('repoint', { id: ref, label: `${ref} → ${proposal.to}`, status: 'active' })
        try {
          const result = await deps.apply(batch.map((b) => b.proposal))
          for (const { item, plannedId, ref, proposal } of batch) {
            planned.delete(plannedId)
            const ok = result.applied.includes(ref)
            const pending = result.pending.some((p) => p.ref === ref)
            op.item('repoint', { id: ref, label: `${ref} → ${proposal.to}`, status: ok || pending ? 'done' : 'failed', ...(pending ? { message: 'pending runtime confirmation' } : {}) })
            results.push({
              itemId: item.id,
              actionId: item.actionId,
              status: ok || pending ? 'applied' as const : 'failed' as const,
              message: ok
                ? `${ref} now uses ${proposal.to}.`
                : pending
                  ? `${ref} → ${proposal.to} is pending — the runtime has not confirmed the write yet.`
                  : result.failed.find((f) => f.ref === ref)?.error.message ?? 'write did not apply',
              affectedCheckIds: [DEAD_SELECTIONS_CHECK_ID],
              changes: item.changes,
            })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          for (const { item, ref, proposal } of batch) {
            op.item('repoint', { id: ref, label: `${ref} → ${proposal.to}`, status: 'failed', message })
            results.push(failure(item, message))
          }
        }
      }
      return results
    },
  }
}
