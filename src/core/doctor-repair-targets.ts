/**
 * Repair targets resolve through the CURRENT Health report (self-healing
 * 1.7, plan review r1 #2): the doctor hands a planner incident ids
 * (`<owner>:<group>:<key>`) or observation ids (`<checkId>:<key>`), and the
 * only honest way to turn either into a domain subject is the report that
 * emitted them — never a hand-rebuilt id. `all_actionable` names every
 * action-required incident whose resolution is the asking action.
 */
import type { HealthIncident, HealthRepairTarget, HealthSubjectKind } from '../../packages/core/src/plugin-types'
import { getHealthReport } from './doctor-report-cache'

export interface SubjectQuery {
  /** The asking action's CANONICAL id (`health.package-sync`) — what `all_actionable` matches against. */
  actionId: string
  /** Only subjects of this kind are returned. */
  subjectKind: HealthSubjectKind
}

/** The incidents a target names in the current report. */
export function incidentsNamedBy(target: HealthRepairTarget, actionId: string): HealthIncident[] {
  const { incidents } = getHealthReport()
  if (target.type === 'all_actionable') {
    return incidents.filter((incident) =>
      incident.effectiveDisposition === 'action_required'
      && incident.resolution.type === 'repair'
      && incident.resolution.actionId === actionId)
  }
  const wanted = new Set(target.ids)
  return target.type === 'incidents'
    ? incidents.filter((incident) => wanted.has(incident.id))
    : incidents.filter((incident) => incident.observationIds.some((id) => wanted.has(id)))
}

/** The subject ids (of one kind) a target names — the planner's domain handles. */
export function subjectIdsNamedBy(target: HealthRepairTarget, query: SubjectQuery): string[] {
  return [...new Set(
    incidentsNamedBy(target, query.actionId)
      .filter((incident) => incident.subject.kind === query.subjectKind)
      .map((incident) => incident.subject.id),
  )]
}
