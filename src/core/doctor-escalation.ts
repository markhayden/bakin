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
 * still fails, the request RESURFACES its existing task (moved to Review
 * unless it already sits in Review/Blocked, the approval re-announced or
 * attached) and keeps covering — never a duplicate task. An `applying`
 * request always covers; a verified request or a missing task covers
 * nothing. Cycles are serialized.
 * Manual diagnostics never create tasks through this module.
 */
import { randomUUID } from 'crypto'
import type { HealthIncident, HealthRepairPlan, HealthReport } from '../../packages/core/src/plugin-types'
import type { DoctorRepairRequest } from './doctor-repair-store'
import { createLogger } from './logger'
import { heldIncidentIds, incidentHolder, releaseIncidents, reserveIncidents, transferIncidents } from './doctor-reservations'
import type { RepairFailure } from '@bakin/core/approvals'
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

/**
 * The window mark: the last VALID `resurfaced` event (a parseable time not
 * in the future), else the request's creation. An invalid or future mark
 * never extends cover — it is ignored, not trusted.
 */
function windowMark(request: DoctorRepairRequest, now: number): number {
  for (const event of [...request.events].reverse()) {
    if (event.type !== 'resurfaced') continue
    const at = Date.parse(event.ts)
    if (Number.isFinite(at) && at <= now) return at
  }
  return Date.parse(request.createdAt)
}

type Verdict = { kind: 'skip' } | { kind: 'cover' } | { kind: 'resurface'; reason: ResurfaceReason }

/**
 * One request's verdict this cycle (spec D-G3). `column` is its task's
 * current column (null = no task or task gone). Shared by the assessment and
 * the pre-mutation recheck, so a resurface only acts on CURRENT state.
 */
function judgeCoverage(
  request: DoctorRepairRequest,
  column: string | null,
  fresh: ReadonlySet<string>,
  now: number,
  cooldownMs: number,
  staleAfterMs: number,
): Verdict {
  const ageMs = now - Date.parse(request.createdAt)
  // A request dated in the future (or undated) covers nothing — no
  // clamping: a negative age would read as fresh forever (#898).
  if (!Number.isFinite(ageMs) || ageMs < 0) return { kind: 'skip' }
  if (request.status === 'verified' || request.status === 'dismissed') return { kind: 'skip' }
  // A repair operation is running: covered until it settles, never handed
  // back (a navigate approval would make it dismissable mid-run).
  if (request.status === 'applying' || ageMs < cooldownMs) return { kind: 'cover' }
  if (!column) return { kind: 'skip' } // task gone — a new request may open
  const stillFailing = request.incidentIds.some((id) => fresh.has(id))
  if (CLOSED_COLUMNS.has(column)) return stillFailing ? { kind: 'resurface', reason: 'closed-unfixed' } : { kind: 'skip' }
  const sinceMark = now - windowMark(request, now)
  if (!Number.isFinite(sinceMark) || sinceMark < staleAfterMs || !stillFailing) return { kind: 'cover' }
  return { kind: 'resurface', reason: 'stale' }
}

async function taskColumn(taskId: string | undefined): Promise<string | null> {
  if (!taskId) return null
  const { getTaskWithColumn } = await import('./task-store')
  return getTaskWithColumn(taskId)?.column ?? null
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
  const coverage: RepairCoverage = { covered: new Set(), resurface: [] }
  for (const request of listDoctorRepairRequests(contentDir)) {
    const needsTask = request.status !== 'verified' && request.status !== 'dismissed'
    const column = needsTask ? await taskColumn(request.taskId) : null
    const verdict = judgeCoverage(request, column, fresh, now, cooldownMs, staleAfterMs)
    if (verdict.kind === 'skip') continue
    for (const id of request.incidentIds) coverage.covered.add(id)
    if (verdict.kind === 'resurface') coverage.resurface.push({ request, reason: verdict.reason })
  }
  return coverage
}

interface ResurfaceContext {
  contentDir: string
  fresh: ReadonlySet<string>
  incidents: readonly HealthIncident[]
  cooldownMs: number
  staleAfterMs: number
}

/**
 * Hand a repair task back to the operator (spec D-G3). Every module is
 * loaded first; then ONE synchronous block re-reads the request and its
 * task, re-judges them, and mutates — nothing (auto-close verifying it, an
 * approval resolving) can interleave between the check and the writes.
 * Skips while a run is in flight (the agent is working). Otherwise moves the
 * task to Review (audited reopen when it leaves Done), re-announces its
 * pending approval or attaches one (delegated), and records the `resurfaced`
 * window mark. Never creates a task.
 */
async function resurfaceRequest(requestId: string, ctx: ResurfaceContext): Promise<string | null> {
  const { getDoctorRepairRequest, updateDoctorRepairRequest } = await import('./doctor-repair-store')
  const { getTaskWithColumn, escalateTaskToReview } = await import('./task-store')
  const { reopenIfLeavingDone } = await import('./task-service')
  const { getLiveRun } = await import('./execution-ledger')
  const { reannounceApproval } = await import('./approvals')
  const { attachResurfaceApproval } = await import('./doctor-approvals')

  // ── synchronous from here: check and mutate as one step ──
  const request = getDoctorRepairRequest(ctx.contentDir, requestId)
  if (!request?.taskId) return null
  const taskId = request.taskId
  const column = getTaskWithColumn(taskId)?.column ?? null
  const verdict = judgeCoverage(request, column, ctx.fresh, Date.now(), ctx.cooldownMs, ctx.staleAfterMs)
  if (verdict.kind !== 'resurface') return null
  if (getLiveRun(taskId)) return null
  const hours = Math.round(ctx.staleAfterMs / 3_600_000)
  // An operator-review request has nothing to approve or delegate: the SAME
  // task comes back to Review with its own copy — never a navigate approval
  // that would read "the delegated repair did not fix this" (#896 D3.4).
  const operatorReview = request.kind === 'operator-review'
  const message = operatorReview
    ? (verdict.reason === 'closed-unfixed'
      ? 'Health: this task was closed, but the repair it needs you for still fails — reopened in Review.'
      : `Health: still failing after ${hours}h — the repair could not be automated and still needs you.`)
    : verdict.reason === 'closed-unfixed'
      ? 'Health: this task was closed, but its incident still fails — reopened in Review for you.'
      : `Health: not fixed after ${hours}h — handed back to you.`
  // Only a task leaving Done or Archived has a completion row to unfreeze
  // (archiving a done task keeps its row — lifecycle, not reopen); Blocked,
  // To Do and In Progress move without touching the ledger.
  const left = escalateTaskToReview(taskId, message)
  if (left === 'done' || left === 'archived') reopenIfLeavingDone(taskId, 'review', 'health', 'system')
  if (!operatorReview) {
    const announced = request.approvalId ? reannounceApproval(request.approvalId) : false
    if (!announced) attachResurfaceApproval({ contentDir: ctx.contentDir, request, incidents: ctx.incidents })
  }
  updateDoctorRepairRequest(ctx.contentDir, request.id, (current) => ({
    ...current,
    events: [...current.events, { ts: new Date().toISOString(), type: 'resurfaced', message, data: { reason: verdict.reason } }],
  }))
  log.info('Resurfaced a Health repair task', { requestId: request.id, taskId, reason: verdict.reason })
  return taskId
}

/**
 * Reserve these incidents for the cycle; an overlap that appeared between the
 * held-set read and this reservation (a repair started meanwhile) is dropped
 * from the cycle rather than raced — the next cycle re-judges it.
 */
function claimForCycle(incidents: HealthIncident[], cycleToken: string): HealthIncident[] {
  if (incidents.length === 0) return incidents
  const first = reserveIncidents(incidents.map((incident) => incident.id), cycleToken)
  if (first.status !== 'refused') return incidents
  const rest = incidents.filter((incident) => !first.overlapping.includes(incident.id))
  log.info('Escalation drops incidents that became held while it judged', { overlapping: first.overlapping, heldBy: first.heldBy })
  if (rest.length > 0) reserveIncidents(rest.map((incident) => incident.id), cycleToken)
  return rest
}

export interface EscalationOutcome {
  autoApplied: string[]
  /** Existing repair tasks handed back to the operator this cycle (spec D-G3). */
  resurfacedTaskIds: string[]
  repairApprovalTaskId: string | null
  /** The ONE review task for repair incidents nothing could fix automatically (#896 D3.4). */
  operatorReviewTaskId: string | null
  navigateApprovalTaskIds: string[]
  delegatedIncidentIds: string[]
}

/**
 * Escalation cycles run one at a time: two overlapping cycles would each
 * assess the same expired window and resurface (announce) twice. Each cycle
 * assesses after the previous one recorded its window marks.
 */
let escalationChain: Promise<unknown> = Promise.resolve()

export function escalateCronIncidents(
  report: HealthReport,
  contentDir: string,
  projectRoot: string,
): Promise<EscalationOutcome | null> {
  const run = escalationChain.then(() => escalateOnce(report, contentDir, projectRoot))
  escalationChain = run.catch(() => undefined)
  return run
}

async function escalateOnce(
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

  const cycleToken = `escalation:${randomUUID()}`

  const outcome: EscalationOutcome = { autoApplied: [], resurfacedTaskIds: [], repairApprovalTaskId: null, operatorReviewTaskId: null,
    navigateApprovalTaskIds: [], delegatedIncidentIds: [] }
  try {
    const freshIds = new Set(fresh.map((incident) => incident.id))
    const coverage = await assessRepairCoverage(contentDir, freshIds, Date.now(), escalationCooldownMs, escalationStaleAfterMs)
    for (const { request } of coverage.resurface) {
      try {
        const incidents = fresh.filter((incident) => request.incidentIds.includes(incident.id))
        const taskId = await resurfaceRequest(request.id, { contentDir, fresh: freshIds, incidents, cooldownMs: escalationCooldownMs, staleAfterMs: escalationStaleAfterMs })
        if (taskId) outcome.resurfacedTaskIds.push(taskId)
      } catch (err) {
        log.warn('Could not resurface a Health repair task', err, { requestId: request.id, taskId: request.taskId })
      }
    }
    // Admission (#896 D3.2): incidents a repair or delegation already holds
    // are not judged this cycle; everything this cycle judges is held under
    // its own token until each incident's disposition is written — a UI
    // repair or manual delegation that starts mid-await is refused instead
    // of racing. The safe subset is handed to the auto-repair operation
    // (released at its settle), the delegated subset to the delegation.
    const held = heldIncidentIds()
    if (held.size > 0) log.info('Escalation skips incidents already under repair or delegation', { held: [...held] })
    let remaining = claimForCycle(fresh.filter((incident) => !coverage.covered.has(incident.id) && !held.has(incident.id)), cycleToken)
    if (remaining.length === 0) return outcome

    try {
      // 1. Plan once for everything uncovered; apply the safe items now.
      const { planDoctorRepair, startDoctorRepair, awaitDoctorRepair, repairFingerprint } = await import('./doctor-repair')
      let working = report
      let plan: HealthRepairPlan | null = null
      let plannerError: string | null = null
      try {
        plan = await planDoctorRepair({
          contentDir,
          projectRoot,
          target: { type: 'incidents', reportId: report.id, ids: remaining.map((incident) => incident.id) as [string, ...string[]] },
        })
      } catch (err) {
        plannerError = err instanceof Error ? err.message : String(err)
        log.warn('Health repair planning failed; escalating without auto-repair', err, { incidentIds: remaining.map((incident) => incident.id) })
      }
      const safeItems = plan?.items.filter((item) => item.safety === 'safe') ?? []
      /** incidentId → the failed safe attempt that led to the operator (#896 D3.4). */
      const failures = new Map<string, RepairFailure>()
      /** Incidents whose auto-repair settled WITHOUT a report: operator-review, whatever was proposed (D3.4b). */
      const noReport = new Set<string>()
      if (plan && safeItems.length > 0) {
        // The same repair operation every surface runs (#895), started by the
        // system and awaited in-process — it shows in the tray like any other.
        // Hand the safe subset to the operation under ITS token (the repair
        // fingerprint) so startDoctorRepair attaches instead of being refused;
        // the operation releases them when it settles.
        const safeItemIds = safeItems.map((item) => item.id)
        const safeIncidentIds = [...new Set(safeItems.flatMap((item) => item.incidentIds))].filter((id) => incidentHolder(id) === cycleToken)
        const fingerprint = repairFingerprint(plan.planId, safeItemIds)
        transferIncidents(safeIncidentIds, cycleToken, fingerprint)
        let started: Awaited<ReturnType<typeof startDoctorRepair>>
        try {
          started = await startDoctorRepair({
            contentDir,
            projectRoot,
            planId: plan.planId,
            itemIds: safeItemIds,
            confirmedItemIds: [],
            origin: 'system',
            releaseTo: cycleToken, // the incidents come straight back here at settle — no window
          })
        } catch (err) {
          transferIncidents(safeIncidentIds, fingerprint, cycleToken) // never started — take them back
          throw err
        }
        const { view, report: applied } = await awaitDoctorRepair(started.operationId)
        // Settled: the operation handed the incidents back (releaseTo). A twin
        // that attached to someone else's run may have released them instead —
        // take back whatever is still under the fingerprint, then re-claim.
        transferIncidents(safeIncidentIds.filter((id) => incidentHolder(id) === fingerprint), fingerprint, cycleToken)
        const at = new Date().toISOString()
        if (!applied) {
          // The attempt itself died (cancelled, crashed, no report): nothing
          // was applied — record the receipt and let the partition hand these
          // incidents to the operator instead of ending the cycle (#896 D3.4b).
          const error = view.outcome?.message ?? `auto-repair ${view.status} without a report`
          for (const id of safeIncidentIds) {
            failures.set(id, { operationId: started.operationId, stage: view.status, error, at })
            noReport.add(id)
          }
          log.warn('Auto-repair settled without a report; handing its incidents to the operator', { operationId: started.operationId, status: view.status, incidentIds: safeIncidentIds })
          remaining = claimForCycle(remaining, cycleToken)
        } else {
          working = applied.report
          for (const result of applied.results) {
            if (result.status !== 'failed') continue
            for (const item of safeItems.filter((row) => row.id === result.itemId)) {
              for (const id of item.incidentIds) failures.set(id, { operationId: started.operationId, stage: result.actionId, error: result.message, at })
            }
          }
          const stillOpen = new Set(freshActionRequiredIncidents(working).map((incident) => incident.id))
          outcome.autoApplied = remaining.filter((incident) => !stillOpen.has(incident.id)).map((incident) => incident.id)
          // What still burns after the apply is judged next — hold it again.
          remaining = claimForCycle(working.incidents.filter((incident) => stillOpen.has(incident.id) && remaining.some((row) => row.id === incident.id)), cycleToken)
          // Applied cleanly, yet still reproducing: that is a failure too.
          for (const incident of remaining) {
            if (safeIncidentIds.includes(incident.id) && !failures.has(incident.id)) {
              failures.set(incident.id, { operationId: started.operationId, stage: 'verify', error: 'applied, but the incident still reproduces', at })
            }
          }
          log.info('Auto-applied safe Health repairs', {
            items: safeItemIds,
            resolved: outcome.autoApplied,
            remaining: remaining.map((incident) => incident.id),
          })
        }
        if (remaining.length === 0) return outcome
      }

      // 2.–4. Partition what is left.
      const nonSafeItems = plan?.items.filter((item) => item.safety !== 'safe') ?? []
      const proposedIncidentIds = new Set(nonSafeItems.flatMap((item) => item.incidentIds))
      // No-report incidents take precedence over any proposal: an attempt
      // that died says nothing about what the next one would do (D3.4b).
      const repairIncidents = remaining.filter((incident) => incident.resolution.type === 'repair' && proposedIncidentIds.has(incident.id) && !noReport.has(incident.id))
      const navigateIncidents = remaining.filter((incident) => incident.resolution.type === 'navigate')
      // A repair-type incident with no executable proposal — its safe repair
      // failed, planning threw, nothing was proposed, or the attempt settled
      // without a report — goes to the OPERATOR, never to an agent that would
      // re-run the same installer (#896 D3.4).
      const operatorIncidents = remaining.filter((incident) => incident.resolution.type === 'repair' && (!proposedIncidentIds.has(incident.id) || noReport.has(incident.id)))
      const delegateIncidents = remaining.filter((incident) => !repairIncidents.includes(incident) && !navigateIncidents.includes(incident) && !operatorIncidents.includes(incident))

      if (plan && repairIncidents.length > 0) {
        const { openRepairApproval } = await import('./doctor-approvals')
        const repairIds = new Set(repairIncidents.map((incident) => incident.id))
        const receipt = repairIncidents.map((incident) => failures.get(incident.id)).find((row): row is RepairFailure => row !== undefined)
        const opened = await openRepairApproval({
          contentDir,
          report: working,
          incidents: repairIncidents,
          items: nonSafeItems.filter((item) => item.incidentIds.some((id) => repairIds.has(id))),
          plan,
          ...(receipt ? { failure: receipt } : {}),
        })
        outcome.repairApprovalTaskId = opened.taskId
        releaseIncidents(cycleToken, repairIncidents.map((incident) => incident.id)) // the approval task covers them now
      }
      if (navigateIncidents.length > 0) {
        const { openNavigateApproval } = await import('./doctor-approvals')
        for (const incident of navigateIncidents) {
          const opened = await openNavigateApproval({ contentDir, report: working, incident })
          outcome.navigateApprovalTaskIds.push(opened.taskId)
          releaseIncidents(cycleToken, [incident.id])
        }
      }
      if (operatorIncidents.length > 0) {
        const { openOperatorReview } = await import('./doctor-approvals')
        const withReceipt = operatorIncidents.find((incident) => failures.has(incident.id))
        const reason = withReceipt
          ? { failure: failures.get(withReceipt.id)! }
          : { plannerError: plannerError ?? 'no repair action was proposed for this incident' }
        const opened = await openOperatorReview({ contentDir, report: working, incidents: operatorIncidents, reason })
        outcome.operatorReviewTaskId = opened.taskId
        releaseIncidents(cycleToken, operatorIncidents.map((incident) => incident.id))
      }
      if (delegateIncidents.length > 0) {
        const { delegateDoctorRepair } = await import('./doctor-delegate')
        const ids = delegateIncidents.map((incident) => incident.id).sort() as [string, ...string[]]
        // The delegation takes the hand-off (transfer, not a fresh reservation)
        // and releases once its request is written.
        await delegateDoctorRepair({ contentDir, projectRoot, accepted: true, target: { type: 'incidents', reportId: working.id, ids }, reservation: cycleToken })
        outcome.delegatedIncidentIds = ids
      }
      log.info('Health escalation cycle complete', { ...outcome })
      return outcome
    } finally {
      releaseIncidents(cycleToken)
    }
  } catch (error) {
    log.error('Health escalation failed', error, { incidentIds: fresh.map((incident) => incident.id) })
    return outcome
  }
}
