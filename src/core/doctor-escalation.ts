/**
 * Cron escalation over fresh canonical action-required incidents (spec D2–D5).
 *
 * Policy, per cycle, for every incident no open request covers:
 *   1. plan; safe repair items are applied right away and the incidents they
 *      fix never become tasks;
 *   2. incidents with a NON-SAFE repair proposal → ONE review task holding a
 *      `health-repair` approval (the proposal frozen for R1);
 *   3. operator-only incidents (resolution `navigate`) → one review task +
 *      `health-navigate` approval each;
 *   4. everything else (instructions / rerun / repair without a plan item) →
 *      ONE delegated repair task for the main agent.
 *
 * Cover is per incident and BOUNDED (spec D-G1/D-G3): a request younger than
 * `escalationCooldownMs` covers (no one-task-per-cycle churn); an open task
 * covers for one window (`escalationStaleAfterMs`, measured from the
 * request's last `resurfaced` event, else its creation — column moves never
 * reset it); past the window, or when the task was closed while its incident
 * still fails, the request RESURFACES its existing task (moved to Review,
 * the approval re-announced or attached) and keeps covering — never a
 * duplicate task. A verified request or a missing task covers nothing.
 * Manual diagnostics never create tasks through this module.
 */
import type { HealthIncident, HealthRepairPlan, HealthReport } from '../../packages/core/src/plugin-types'
import type { DoctorRepairRequest } from './doctor-repair-store'
import { createLogger } from './logger'
import { getSettings } from './settings'

const log = createLogger('doctor-escalation')
const DEFAULT_ESCALATION_COOLDOWN_MS = 6 * 60 * 60_000
const DEFAULT_ESCALATION_STALE_AFTER_MS = 12 * 60 * 60_000
const CLOSED_COLUMNS = new Set(['done', 'archived'])

/**
 * Escalation acts on EFFECTIVE disposition (#690): a sensitivity-demoted
 * incident never spawns a repair task — the report projection is the one
 * place urgency is decided. Acked/snoozed incidents never escalate — the user
 * said "I know", and re-fire rules own bringing them back.
 */
export function freshActionRequiredIncidents(report: HealthReport): HealthIncident[] {
  return report.incidents.filter((incident) =>
    incident.effectiveDisposition === 'action_required' && !incident.stale && incident.ackState === undefined,
  )
}

function onboardingOnly(incidents: readonly HealthIncident[]): boolean {
  return incidents.length > 0 && incidents.every((incident) => incident.id === 'core:system:onboarding-required')
}

export type ResurfaceReason = 'stale' | 'closed-unfixed'

export interface RepairCoverage {
  /** Incident ids an open or recent request covers this cycle. */
  covered: Set<string>
  /** Requests whose existing task must resurface (their incidents are covered too). */
  resurface: Array<{ request: DoctorRepairRequest; reason: ResurfaceReason }>
}

/** The window mark: the last time this request resurfaced, else its creation. */
function windowMark(request: DoctorRepairRequest): number {
  const last = [...request.events].reverse().find((event) => event.type === 'resurfaced')
  return Date.parse(last?.ts ?? request.createdAt)
}

/**
 * Which incidents open or recent repair requests cover, and which requests
 * must resurface their task (spec D-G3). `fresh` = this cycle's fresh
 * action-required incident ids: only a request whose incidents are still
 * failing can resurface.
 */
export async function assessRepairCoverage(
  contentDir: string,
  fresh: ReadonlySet<string>,
  now: number,
  cooldownMs: number,
  staleAfterMs: number,
): Promise<RepairCoverage> {
  const { listDoctorRepairRequests } = await import('./doctor-repair-store')
  const { getTaskDetails } = await import('./task-service')
  const coverage: RepairCoverage = { covered: new Set(), resurface: [] }
  for (const request of listDoctorRepairRequests(contentDir)) {
    const ageMs = now - Date.parse(request.createdAt)
    // A request dated in the future (or undated) covers nothing — no
    // clamping: a negative age would read as fresh forever (#898).
    if (!Number.isFinite(ageMs) || ageMs < 0) continue
    if (request.status === 'verified' || request.status === 'dismissed') continue
    const cover = () => { for (const id of request.incidentIds) coverage.covered.add(id) }
    if (ageMs < cooldownMs) { cover(); continue }
    if (!request.taskId) continue
    const details = await getTaskDetails(request.taskId).catch(() => null)
    const column = details?.column ?? null
    if (!column) continue // task gone — a new request may open
    const stillFailing = request.incidentIds.some((id) => fresh.has(id))
    if (CLOSED_COLUMNS.has(column)) {
      if (!stillFailing) continue
      coverage.resurface.push({ request, reason: 'closed-unfixed' })
      cover()
      continue
    }
    const sinceMark = now - windowMark(request)
    if (!Number.isFinite(sinceMark) || sinceMark < staleAfterMs || !stillFailing) { cover(); continue }
    coverage.resurface.push({ request, reason: 'stale' })
    cover()
  }
  return coverage
}

/**
 * Hand a repair task back to the operator (spec D-G3): skip while a run is
 * in flight (the agent is working); otherwise move it to Review with a log
 * line, re-announce its pending approval or attach one (delegated), and
 * record the `resurfaced` window mark. Never creates a task.
 */
async function resurfaceRequest(
  contentDir: string,
  request: DoctorRepairRequest,
  reason: ResurfaceReason,
  incidents: readonly HealthIncident[],
  staleAfterMs: number,
): Promise<boolean> {
  const { getLiveRun } = await import('./execution-ledger')
  if (getLiveRun(request.taskId!)) return false
  const hours = Math.round(staleAfterMs / 3_600_000)
  const message = reason === 'closed-unfixed'
    ? 'Health: this task was closed, but its incident still fails — reopened in Review for you.'
    : `Health: not fixed after ${hours}h — moved to Review for you.`
  const { escalateTaskToReview } = await import('./task-store')
  await escalateTaskToReview(request.taskId!, message)
  const { reannounceApproval } = await import('./approvals')
  const announced = request.approvalId ? reannounceApproval(request.approvalId) : false
  if (!announced) {
    const { attachResurfaceApproval } = await import('./doctor-approvals')
    attachResurfaceApproval({ contentDir, request, incidents })
  }
  const { updateDoctorRepairRequest } = await import('./doctor-repair-store')
  updateDoctorRepairRequest(contentDir, request.id, (current) => ({
    ...current,
    events: [...current.events, { ts: new Date().toISOString(), type: 'resurfaced', message, data: { reason } }],
  }))
  log.info('Resurfaced a Health repair task', { requestId: request.id, taskId: request.taskId, reason })
  return true
}

export interface EscalationOutcome {
  autoApplied: string[]
  /** Existing repair tasks handed back to the operator this cycle (spec D-G3). */
  resurfacedTaskIds: string[]
  repairApprovalTaskId: string | null
  navigateApprovalTaskIds: string[]
  delegatedIncidentIds: string[]
}

export async function escalateCronIncidents(
  report: HealthReport,
  contentDir: string,
  projectRoot: string,
): Promise<EscalationOutcome | null> {
  const {
    escalation = true,
    escalationCooldownMs = DEFAULT_ESCALATION_COOLDOWN_MS,
    escalationStaleAfterMs = DEFAULT_ESCALATION_STALE_AFTER_MS,
  } = getSettings().doctor
  if (!escalation) return null
  const fresh = freshActionRequiredIncidents(report)
  if (fresh.length === 0 || onboardingOnly(fresh)) return null

  const outcome: EscalationOutcome = { autoApplied: [], resurfacedTaskIds: [], repairApprovalTaskId: null, navigateApprovalTaskIds: [], delegatedIncidentIds: [] }
  try {
    const freshIds = new Set(fresh.map((incident) => incident.id))
    const coverage = await assessRepairCoverage(contentDir, freshIds, Date.now(), escalationCooldownMs, escalationStaleAfterMs)
    for (const { request, reason } of coverage.resurface) {
      try {
        const incidents = fresh.filter((incident) => request.incidentIds.includes(incident.id))
        if (await resurfaceRequest(contentDir, request, reason, incidents, escalationStaleAfterMs)) outcome.resurfacedTaskIds.push(request.taskId!)
      } catch (err) {
        log.warn('Could not resurface a Health repair task', err, { requestId: request.id, taskId: request.taskId })
      }
    }
    let remaining = fresh.filter((incident) => !coverage.covered.has(incident.id))
    if (remaining.length === 0) return outcome

    // 1. Plan once for everything uncovered; apply the safe items now.
    const { planDoctorRepair, startDoctorRepair, awaitDoctorRepair } = await import('./doctor-repair')
    let working = report
    let plan: HealthRepairPlan | null = null
    try {
      plan = await planDoctorRepair({
        contentDir,
        projectRoot,
        target: { type: 'incidents', reportId: report.id, ids: remaining.map((incident) => incident.id) as [string, ...string[]] },
      })
    } catch (err) {
      log.warn('Health repair planning failed; escalating without auto-repair', err, { incidentIds: remaining.map((incident) => incident.id) })
    }
    const safeItems = plan?.items.filter((item) => item.safety === 'safe') ?? []
    if (plan && safeItems.length > 0) {
      // The same repair operation every surface runs (#895), started by the
      // system and awaited in-process — it shows in the tray like any other.
      const started = await startDoctorRepair({
        contentDir,
        projectRoot,
        planId: plan.planId,
        itemIds: safeItems.map((item) => item.id),
        confirmedItemIds: [],
        origin: 'system',
      })
      const { view, report: applied } = await awaitDoctorRepair(started.operationId)
      if (!applied) throw new Error(`Auto-repair ${view.status}: ${view.outcome?.message ?? 'no report'}`)
      working = applied.report
      const stillOpen = new Set(freshActionRequiredIncidents(working).map((incident) => incident.id))
      outcome.autoApplied = remaining.filter((incident) => !stillOpen.has(incident.id)).map((incident) => incident.id)
      remaining = working.incidents.filter((incident) => stillOpen.has(incident.id) && remaining.some((row) => row.id === incident.id))
      log.info('Auto-applied safe Health repairs', {
        items: safeItems.map((item) => item.id),
        resolved: outcome.autoApplied,
        remaining: remaining.map((incident) => incident.id),
      })
      if (remaining.length === 0) return outcome
    }

    // 2.–4. Partition what is left.
    const nonSafeItems = plan?.items.filter((item) => item.safety !== 'safe') ?? []
    const proposedIncidentIds = new Set(nonSafeItems.flatMap((item) => item.incidentIds))
    const repairIncidents = remaining.filter((incident) => incident.resolution.type === 'repair' && proposedIncidentIds.has(incident.id))
    const navigateIncidents = remaining.filter((incident) => incident.resolution.type === 'navigate')
    const delegateIncidents = remaining.filter((incident) => !repairIncidents.includes(incident) && !navigateIncidents.includes(incident))

    if (plan && repairIncidents.length > 0) {
      const { openRepairApproval } = await import('./doctor-approvals')
      const repairIds = new Set(repairIncidents.map((incident) => incident.id))
      const opened = await openRepairApproval({
        contentDir,
        report: working,
        incidents: repairIncidents,
        items: nonSafeItems.filter((item) => item.incidentIds.some((id) => repairIds.has(id))),
        plan,
      })
      outcome.repairApprovalTaskId = opened.taskId
    }
    if (navigateIncidents.length > 0) {
      const { openNavigateApproval } = await import('./doctor-approvals')
      for (const incident of navigateIncidents) {
        const opened = await openNavigateApproval({ contentDir, report: working, incident })
        outcome.navigateApprovalTaskIds.push(opened.taskId)
      }
    }
    if (delegateIncidents.length > 0) {
      const { delegateDoctorRepair } = await import('./doctor-delegate')
      const ids = delegateIncidents.map((incident) => incident.id).sort() as [string, ...string[]]
      await delegateDoctorRepair({ contentDir, projectRoot, accepted: true, target: { type: 'incidents', reportId: working.id, ids } })
      outcome.delegatedIncidentIds = ids
    }
    log.info('Health escalation cycle complete', { ...outcome })
    return outcome
  } catch (error) {
    log.error('Health escalation failed', error, { incidentIds: fresh.map((incident) => incident.id) })
    return outcome
  }
}
