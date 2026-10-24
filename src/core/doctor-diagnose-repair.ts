/**
 * `core.diagnose` — the ONE engine-owned repair action every check owner may
 * reference for a repair-shaped incident it cannot fix deterministically
 * (spec §3.1, §3.4; self-healing 1.5). Applying it IS the fallback lane:
 * one investigation task for main, briefed by `doctor-brief.ts`, run in a
 * Terminal session when the plugin is there.
 *
 * Until the repair engine (PR5) owns attempts and budgets, the item is
 * `manual` (spec A17: investigations default to ASK — a click, never an
 * unattended agent turn), and the brief carries an empty attempt list.
 * Nothing references this action before the three-outcomes cutover.
 */
import type { HealthIncident, HealthRepairActionDefinition, HealthRepairApplyResult, HealthRepairPlanItem, HealthReport } from '../../packages/core/src/plugin-types'
import { repairTargetSelection } from '@bakin/core/health/repair-support'
import type { FallbackBriefInput } from './doctor-brief'
import type { DoctorDelegateOptions, DoctorDelegateReport } from './doctor-delegate'
import { incidentHolder } from './doctor-reservations'

export const DIAGNOSE_ACTION = 'diagnose'
/** The canonical id (`SHARED_ENGINE_ACTIONS` lists it verbatim). */
export const DIAGNOSE_ACTION_ID = `core.${DIAGNOSE_ACTION}`
/** Spec §3.4: three agent turns per fallback task, every turn counted. */
export const FALLBACK_TURN_BUDGET = 3

export interface DiagnoseRepairDeps {
  delegate(options: DoctorDelegateOptions): Promise<DoctorDelegateReport>
  roots(): { contentDir: string; projectRoot: string }
  report(): HealthReport
  /** The fallback sections of the brief for these incidents (attempts, tools, Terminal availability). */
  fallback(incidents: readonly HealthIncident[]): FallbackBriefInput
}

function affectedCheckIds(report: HealthReport, incidents: readonly HealthIncident[]): string[] {
  const observationIds = new Set(incidents.flatMap((incident) => incident.observationIds))
  return [...new Set(report.observations.filter((observation) => observationIds.has(observation.id)).map((observation) => observation.checkId))]
}

function result(item: HealthRepairPlanItem, status: HealthRepairApplyResult['status'], message: string, checkIds: string[]): HealthRepairApplyResult {
  return { itemId: item.id, actionId: item.actionId, status, message, affectedCheckIds: checkIds, changes: item.changes }
}

export function diagnoseRepair(deps: DiagnoseRepairDeps): HealthRepairActionDefinition {
  return {
    id: DIAGNOSE_ACTION,
    name: 'Investigate with the fallback agent',
    // Spec §3.1: effects all false. The item itself is one-click until the
    // repair engine owns investigations (A17: ask) — see `plan` below.
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false },
    mutation: 'none',
    operationPlan: () => ({ stages: [{ id: 'delegate', kind: 'installing', label: 'Open the investigation task' }], pointOfNoReturn: 'delegate' }),
    async plan(target) {
      return [{
        id: 'investigate',
        actionId: DIAGNOSE_ACTION,
        title: 'Investigate with the fallback agent',
        reason: 'Bakin has no deterministic repair for this incident. Main investigates in a Terminal session and hands back a proposal, a human need, or an upstream block.',
        // A17: investigations ASK — agent turns spend money, so the item is one-click.
        effects: { deletesUserContent: false, spendsMoney: true, widensAuthorization: false },
        ...repairTargetSelection(target),
        changes: [{ kind: 'task', target: 'health-investigation', action: 'create', description: `Open one investigation task for main (the convention is ${FALLBACK_TURN_BUDGET} agent turns; this release does not enforce it).` }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const incidentIds = [...new Set(items.flatMap((item) => item.incidentIds))]
      if (incidentIds.length === 0) return items.map((item) => result(item, 'skipped', 'No incident is targeted — nothing to investigate.', []))
      const report = deps.report()
      const incidents = report.incidents.filter((incident) => incidentIds.includes(incident.id))
      const checkIds = affectedCheckIds(report, incidents)
      // The running repair holds these incidents (#896 D3.2); the delegation
      // takes them over instead of being refused as `repair_in_flight`.
      const reservation = incidentHolder(incidentIds[0]!)
      const [first, ...rest] = incidentIds as [string, ...string[]]
      const outcome = await deps.delegate({
        ...deps.roots(),
        accepted: true,
        target: { type: 'incidents', reportId: report.id, ids: [first, ...rest] },
        ...(reservation ? { reservation } : {}),
        fallback: deps.fallback(incidents),
      })
      switch (outcome.status) {
        case 'sent':
          return items.map((item) => result(item, 'applied', `Opened investigation task ${outcome.request.taskId ?? outcome.request.id} for ${outcome.request.agentId ?? 'main'}; it hands back a proposal, a human need, or an upstream block.`, checkIds))
        case 'already_delegated':
          return items.map((item) => result(item, 'skipped', `Task ${outcome.request.taskId ?? outcome.request.id} is already investigating this.`, checkIds))
        case 'no_unresolved':
          return items.map((item) => result(item, 'skipped', 'Nothing is left to investigate — the incident is no longer open.', checkIds))
        case 'confirmation_required':
          return items.map((item) => result(item, 'failed', 'The investigation task was not opened (confirmation was required).', checkIds))
        case 'repair_in_flight':
          return items.map((item) => result(item, 'failed', `Another repair (${outcome.heldBy}) holds ${outcome.overlapping.join(', ')}; retry when it settles.`, checkIds))
        default:
          return items.map((item) => result(item, 'failed', 'The investigation task could not be opened.', checkIds))
      }
    },
  }
}
