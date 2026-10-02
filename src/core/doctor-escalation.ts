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
 * Cover is per incident: a request whose task sits in blocked or review
 * covers its incidents indefinitely (a human owns it); todo/inProgress cover
 * until `escalationStaleAfterMs`; done/archived/missing never cover; and any
 * request younger than `escalationCooldownMs` covers (no one-task-per-cycle
 * churn). Manual diagnostics never create tasks through this module.
 */
import type { HealthIncident, HealthRepairPlan, HealthReport } from '../../packages/core/src/plugin-types'
import { createLogger } from './logger'
import { getSettings } from './settings'

const log = createLogger('doctor-escalation')
const DEFAULT_ESCALATION_COOLDOWN_MS = 6 * 60 * 60_000
const DEFAULT_ESCALATION_STALE_AFTER_MS = 12 * 60 * 60_000
/** Task columns where a human owns the next step — cover never expires. */
const HUMAN_OWNED_COLUMNS = new Set(['blocked', 'review'])
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

/** Incident ids some open or recent repair request still covers. */
export async function coveredIncidentIds(
  contentDir: string,
  now: number,
  cooldownMs: number,
  staleAfterMs: number,
): Promise<Set<string>> {
  const { listDoctorRepairRequests } = await import('./doctor-repair-store')
  const { getTaskDetails } = await import('./task-service')
  const covered = new Set<string>()
  for (const request of listDoctorRepairRequests(contentDir)) {
    const ageMs = now - Date.parse(request.createdAt)
    let covers = ageMs < cooldownMs
    if (!covers && request.taskId) {
      const details = await getTaskDetails(request.taskId).catch(() => null)
      const column = details?.column ?? null
      if (column && HUMAN_OWNED_COLUMNS.has(column)) covers = true
      else if (column && !CLOSED_COLUMNS.has(column)) covers = ageMs < staleAfterMs
    }
    if (covers) for (const id of request.incidentIds) covered.add(id)
  }
  return covered
}

export interface EscalationOutcome {
  autoApplied: string[]
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

  const outcome: EscalationOutcome = { autoApplied: [], repairApprovalTaskId: null, navigateApprovalTaskIds: [], delegatedIncidentIds: [] }
  try {
    const covered = await coveredIncidentIds(contentDir, Date.now(), escalationCooldownMs, escalationStaleAfterMs)
    let remaining = fresh.filter((incident) => !covered.has(incident.id))
    if (remaining.length === 0) return outcome

    // 1. Plan once for everything uncovered; apply the safe items now.
    const { planDoctorRepair, applyDoctorRepair } = await import('./doctor-repair')
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
      const applied = await applyDoctorRepair({
        contentDir,
        projectRoot,
        planId: plan.planId,
        itemIds: safeItems.map((item) => item.id),
        confirmedItemIds: [],
      })
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
