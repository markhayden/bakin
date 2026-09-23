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

import type { HealthCheckRunInput, HealthRepairActionDefinition } from '@bakin/core/plugin-types'
import { healthError, healthHealthy, healthObserved, healthUnknown } from '@makinbakin/sdk/utils'
import type { HealthObservationInput, HealthRepairPlanItem, HealthRepairTarget, ModelEligibilitySummary } from '@makinbakin/sdk/types'
import type { EvidenceStatus } from '../../../src/core/model-eligibility'
import type { MutateResult } from '../../../src/core/model-mutations'
import type { Proposal, SelectionState } from '../../../src/core/model-selections'

export const DEAD_SELECTION_REPAIR_ID = 'apply-model-proposal'
export const DEAD_SELECTIONS_CHECK_ID = 'models.dead-selections'
const INCIDENT_KEY_PREFIX = 'dead-selection:'

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
    observations.push(healthUnknown({
      key: `evidence:${source}`,
      summary: status === 'partial'
        ? `Could only partly read ${EVIDENCE_LABEL[source]} — some models cannot be verified.`
        : `Could not read ${EVIDENCE_LABEL[source]} — models that depend on it cannot be verified.`,
      evidence: { source, status },
      incident: {
        key: `evidence:${source}`,
        title: `Model verification incomplete (${EVIDENCE_LABEL[source]})`,
        impact: 'Selections that depend on this evidence show as unverified rather than dead; nothing is refused or repaired on missing evidence.',
        disposition: 'watch',
        class: 'evidence_gap',
        resources: [{ kind: 'runtime', id: 'active', label: 'Active runtime' }],
        resolution: { key: 'view-models', type: 'navigate', label: 'Open Models', href: '/models' },
      },
    }))
  }

  const proposalByRef = new Map(desc.proposals.map((p) => [p.ref, p]))
  for (const state of desc.states) {
    if (state.ref === 'ui:mode' || !state.model || state.eligibility?.status !== 'ineligible') continue
    const proposal = proposalByRef.get(state.ref)
    const key = `${INCIDENT_KEY_PREFIX}${state.ref}`
    const href = `/models?ref=${encodeURIComponent(state.ref)}`
    observations.push(healthError({
      key,
      summary: `${state.label} uses ${state.model} — ${state.eligibility.detail}.`,
      evidence: {
        ref: state.ref,
        from: state.model,
        to: proposal?.to ?? null,
        reason: state.eligibility.reason,
        source: proposal?.source ?? 'none',
        revision: desc.revision,
      },
      incident: {
        key,
        title: `${state.label} points at a model that cannot run (${state.eligibility.reason.replace(/_/g, ' ')})`,
        impact: 'Every turn that resolves to this selection fails at the provider until it is repointed.',
        disposition: 'action_required',
        class: 'service_failure',
        resources: [{ kind: 'model_selection', id: state.ref, label: state.label }],
        resolution: proposal?.to
          ? { key: 'apply-proposal', type: 'repair', actionId: DEAD_SELECTION_REPAIR_ID, label: `Use ${proposal.to}` }
          : { key: 'choose-model', type: 'navigate', label: 'Choose another model', href },
      },
    }))
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
    async plan(target: HealthRepairTarget): Promise<HealthRepairPlanItem[]> {
      if (target.type !== 'incidents') return []
      const desc = await deps.describe()
      const proposalByRef = new Map(desc.proposals.map((p) => [p.ref, p]))
      const items: HealthRepairPlanItem[] = []
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
          safety: 'safe',
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
    async apply(items) {
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
      for (const batch of byRevision.values()) {
        try {
          const result = await deps.apply(batch.map((b) => b.proposal))
          for (const { item, plannedId, ref, proposal } of batch) {
            planned.delete(plannedId)
            const ok = result.applied.includes(ref)
            const pending = result.pending.some((p) => p.ref === ref)
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
          for (const { item } of batch) results.push(failure(item, message))
        }
      }
      return results
    },
  }
}
