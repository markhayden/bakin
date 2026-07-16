/** Targeted canonical Health repair planning, application, and verification. */
import type {
  HealthObservation,
  HealthRepairApplyResult,
  HealthRepairPlan,
  HealthRepairPlanItem,
  HealthRepairTarget,
  HealthReport,
} from '../../packages/core/src/plugin-types'
import { appendAudit } from './audit'
import { getHealthReport } from './doctor-report-cache'
import { runTargetedDiagnostics } from './doctor-execution'
import { getHealthRepairAction } from './health-check-registry'
import {
  HealthContractError,
  parseHealthRepairApplyOutput,
  parseHealthRepairPlanOutput,
} from './health-contract'
import {
  claimRepairApplication,
  createStoredRepairPlan,
} from './doctor-repair-plans'

type IncidentObservation = Exclude<HealthObservation, { status: 'healthy' }>

function hasIncident(observation: HealthObservation): observation is IncidentObservation {
  return observation.status !== 'healthy'
}

export interface DoctorRepairOptions {
  contentDir: string
  projectRoot: string
}

export interface DoctorRepairPlanOptions extends DoctorRepairOptions {
  target: HealthRepairTarget
}

export interface DoctorRepairApplyOptions extends DoctorRepairOptions {
  planId: string
  itemIds: string[]
  confirmedItemIds: string[]
}

export interface DoctorRepairApplyReport {
  planId: string
  basedOnReportId: string
  results: HealthRepairApplyResult[]
  affectedCheckIds: string[]
  verifiedReportId: string
  verifiedIncidentIds: string[]
  report: HealthReport
}

function targetObservationIds(report: HealthReport, target: HealthRepairTarget): string[] {
  if (target.reportId !== report.id) {
    throw new Error('Repair planning requires the current Health report.')
  }
  if (target.type === 'observations') return [...new Set(target.ids)]
  const incidentIds = target.type === 'incidents'
    ? new Set(target.ids)
    : new Set(report.incidents.filter((incident) => incident.disposition === 'action_required').map((incident) => incident.id))
  return [...new Set(report.incidents
    .filter((incident) => incidentIds.has(incident.id))
    .flatMap((incident) => incident.observationIds))]
}

function executionId(report: HealthReport, observationId: string): string | null {
  for (const check of report.checks) {
    if (check.latestValidSnapshot?.observations.some((row) => row.id === observationId)) {
      return check.latestValidSnapshot.executionId
    }
  }
  return null
}

function repairObservations(report: HealthReport, target: HealthRepairTarget): IncidentObservation[] {
  const ids = new Set(targetObservationIds(report, target))
  return report.observations
    .filter(hasIncident)
    .filter((observation) => ids.has(observation.id) && observation.incident.resolution.type === 'repair')
}

function canonicalizeItem(
  item: HealthRepairPlanItem,
  actionId: string,
  eligible: readonly IncidentObservation[],
  report: HealthReport,
): HealthRepairPlanItem {
  const requested = item.observationIds.length > 0 ? new Set(item.observationIds) : new Set(eligible.map((row) => row.id))
  const observations = eligible.filter((row) => requested.has(row.id))
  if (observations.length === 0) throw new Error(`Repair plan item ${item.id} did not target eligible observations.`)
  const observationIds = observations.map((row) => row.id).sort()
  const incidentIds = [...new Set(observations.map((row) => row.incidentId))].sort()
  return {
    ...structuredClone(item),
    id: `${actionId}:${item.id}`,
    actionId,
    observationIds,
    incidentIds,
    preconditions: observations.map((observation) => {
      const sourceExecutionId = executionId(report, observation.id)
      if (!sourceExecutionId) throw new Error(`Repair observation ${observation.id} has no source execution.`)
      return {
        observationId: observation.id,
        executionId: sourceExecutionId,
        status: observation.status,
        resolutionKey: observation.incident.resolution.key,
      }
    }),
  }
}

function planOutput(
  raw: unknown,
  actionId: string,
  localActionId: string,
): HealthRepairPlanItem[] {
  const items = parseHealthRepairPlanOutput(raw)
  const ids = new Set<string>()
  for (const item of items) {
    if ((item.actionId !== localActionId && item.actionId !== actionId) || ids.has(item.id)) {
      throw new HealthContractError(
        'INVALID_HEALTH_REPAIR_PLAN_OUTPUT',
        'Health repair plan output failed contract validation.',
        [{ code: 'repair_output_identity', path: '$', message: 'Repair plan identities do not match the invoked action.' }],
      )
    }
    ids.add(item.id)
  }
  return items
}

function applyOutput(
  raw: unknown,
  actionId: string,
  items: readonly HealthRepairPlanItem[],
): HealthRepairApplyResult[] {
  const results = parseHealthRepairApplyOutput(raw)
  const expected = new Set(items.map((item) => item.id))
  const seen = new Set<string>()
  const identitiesMatch = results.length === expected.size && results.every((result) => {
    if (result.actionId !== actionId || !expected.has(result.itemId) || seen.has(result.itemId)) return false
    seen.add(result.itemId)
    return true
  })
  if (!identitiesMatch) {
    throw new HealthContractError(
      'INVALID_HEALTH_REPAIR_APPLY_OUTPUT',
      'Health repair apply output failed contract validation.',
      [{ code: 'repair_output_identity', path: '$', message: 'Repair apply identities do not match the selected plan items.' }],
    )
  }
  return results
}

export async function planDoctorRepair(options: DoctorRepairPlanOptions): Promise<HealthRepairPlan> {
  void options.projectRoot
  const report = getHealthReport()
  const observations = repairObservations(report, options.target)
  const byAction = new Map<string, IncidentObservation[]>()
  for (const observation of observations) {
    const resolution = observation.incident.resolution
    if (resolution.type !== 'repair') continue
    const rows = byAction.get(resolution.actionId) ?? []
    rows.push(observation)
    byAction.set(resolution.actionId, rows)
  }

  const items: HealthRepairPlanItem[] = []
  const dedupe = new Set<string>()
  for (const [actionId, eligible] of byAction) {
    const action = getHealthRepairAction(actionId)
    if (!action) throw new Error(`Repair action ${actionId} is no longer registered.`)
    const planned = planOutput(await action.plan(options.target), action.id, action.localId)
    for (const item of planned) {
      const canonical = canonicalizeItem(item, actionId, eligible, report)
      if (dedupe.has(canonical.id)) continue
      dedupe.add(canonical.id)
      items.push(canonical)
    }
  }
  items.sort((a, b) => a.actionId.localeCompare(b.actionId) || a.id.localeCompare(b.id))

  const plan = createStoredRepairPlan({
    basedOnReportId: report.id,
    target: { ...options.target, reportId: report.id } as HealthRepairTarget,
    items,
  })
  appendAudit(options.contentDir, 'doctor.fix.planned', 'system', {
    planId: plan.planId,
    reportId: report.id,
    items: plan.items.length,
    safe: plan.items.filter((item) => item.safety === 'safe').length,
    nonSafe: plan.items.filter((item) => item.safety !== 'safe').length,
  })
  return plan
}

function failedResult(item: HealthRepairPlanItem, error: unknown): HealthRepairApplyResult {
  return {
    itemId: item.id,
    actionId: item.actionId,
    status: 'failed',
    message: error instanceof Error ? error.message : String(error),
    affectedCheckIds: [],
    changes: item.changes,
  }
}

export async function applyDoctorRepair(options: DoctorRepairApplyOptions): Promise<DoctorRepairApplyReport> {
  void options.projectRoot
  const current = getHealthReport()
  const validated = claimRepairApplication({
    planId: options.planId,
    itemIds: options.itemIds,
    confirmedItemIds: options.confirmedItemIds,
    report: current,
  })

  const byAction = new Map<string, HealthRepairPlanItem[]>()
  for (const item of validated.items) {
    const rows = byAction.get(item.actionId) ?? []
    rows.push(item)
    byAction.set(item.actionId, rows)
  }

  const results: HealthRepairApplyResult[] = []
  for (const [actionId, items] of byAction) {
    const action = getHealthRepairAction(actionId)
    if (!action) {
      results.push(...items.map((item) => failedResult(item, new Error(`Repair action ${actionId} is no longer registered.`))))
      continue
    }
    try {
      results.push(...applyOutput(await action.apply(items), actionId, items))
    } catch (error) {
      results.push(...items.map((item) => failedResult(item, error)))
    }
  }

  const selectedObservationIds = new Set(validated.items.flatMap((item) => item.observationIds))
  const inferredCheckIds = current.observations
    .filter((observation) => selectedObservationIds.has(observation.id))
    .map((observation) => observation.checkId)
  const affectedCheckIds = [...new Set([...inferredCheckIds, ...results.flatMap((result) => result.affectedCheckIds)])].sort()
  const report = await runTargetedDiagnostics(affectedCheckIds)
  const verifiedIncidentIds = report.incidents
    .filter((incident) => incident.observationIds.some((id) => selectedObservationIds.has(id)))
    .map((incident) => incident.id)
    .sort()

  appendAudit(options.contentDir, results.some((result) => result.status === 'failed') ? 'doctor.fix.failed' : 'doctor.fix.applied', 'system', {
    planId: options.planId,
    reportId: report.id,
    applied: results.filter((result) => result.status === 'applied').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    failed: results.filter((result) => result.status === 'failed').length,
  })
  appendAudit(options.contentDir, 'doctor.fix.verified', 'system', {
    planId: options.planId,
    reportId: report.id,
    affectedCheckIds,
    remainingIncidentIds: verifiedIncidentIds,
  })

  return {
    planId: options.planId,
    basedOnReportId: validated.plan.basedOnReportId,
    results,
    affectedCheckIds,
    verifiedReportId: report.id,
    verifiedIncidentIds,
    report,
  }
}
