/**
 * Auto-close for Health repair requests (spec D2, plan review R4).
 *
 * A repair task closes only on FRESH SUCCESSFUL verification: the checks
 * behind the request's observations are re-run (targeted), every one of them
 * must evaluate healthy on that run (observed outcome, current snapshot, no
 * non-healthy observation — unknown, failed, timed out, stale or unregistered
 * all keep the task open), and none of the request's incidents may remain.
 * Then: request `verified`, task log + done, pending approval withdrawn.
 *
 * Runs after every doctor cycle and, debounced, when the report's incident
 * set changes. The manual verify route shares the same judgement.
 */
import type { HealthReport } from '../../packages/core/src/plugin-types'
import { getHealthReport, onHealthReportChanged } from './doctor-report-cache'
import { runTargetedDiagnostics } from './doctor-execution'
import { listDoctorRepairRequests, updateDoctorRepairRequest, type DoctorRepairRequest } from './doctor-repair-store'
import { createLogger } from './logger'

const log = createLogger('doctor-autoclose')

/** Requests younger than this are not re-verified yet — their incidents were just observed. */
const MIN_REQUEST_AGE_MS = 60_000
const DEFAULT_DEBOUNCE_MS = 30_000

/** A check counts as healthy only when ITS OWN fresh run says so. */
export function checkEvaluatedHealthy(report: HealthReport, checkId: string): boolean {
  const state = report.checks.find((row) => row.checkId === checkId)
  if (!state) return false
  if (state.latestExecution.outcome !== 'observed') return false
  if (!state.latestValidSnapshot || state.latestValidSnapshot.executionId !== state.latestExecution.id) return false
  const observations = report.observations.filter((row) => row.checkId === checkId)
  return observations.length > 0 && observations.every((row) => row.status === 'healthy' && row.snapshot === 'current')
}

export interface RequestVerification {
  verified: boolean
  checkIds: string[]
  unhealthyCheckIds: string[]
  remainingIncidentIds: string[]
}

/** Fresh-verification target: stored check ids, else derived from observation ids. */
export function originatingCheckIds(request: Pick<DoctorRepairRequest, 'checkIds' | 'observationIds'>, report: HealthReport): string[] {
  if (request.checkIds.length > 0) return [...request.checkIds]
  const wanted = new Set(request.observationIds)
  const fromReport = [...new Set(report.observations.filter((row) => wanted.has(row.id)).map((row) => row.checkId))]
  if (fromReport.length > 0) return fromReport.sort()
  // Observation ids are `${checkId}:${key}`; keys never contain ':'.
  return [...new Set(request.observationIds.map((id) => id.slice(0, id.lastIndexOf(':'))).filter(Boolean))].sort()
}

export function judgeRequest(request: DoctorRepairRequest, fresh: HealthReport, checkIds: string[]): RequestVerification {
  const unhealthyCheckIds = checkIds.filter((id) => !checkEvaluatedHealthy(fresh, id))
  const open = new Set(fresh.incidents.map((incident) => incident.id))
  const remainingIncidentIds = request.incidentIds.filter((id) => open.has(id))
  return {
    verified: checkIds.length > 0 && unhealthyCheckIds.length === 0 && remainingIncidentIds.length === 0,
    checkIds,
    unhealthyCheckIds,
    remainingIncidentIds,
  }
}

/**
 * Record a verification on the request; when it passes, complete the task,
 * withdraw any pending approval and mark the request verified. Shared by the
 * cycle auto-close and the manual verify route.
 */
export async function recordVerification(contentDir: string, request: DoctorRepairRequest, fresh: HealthReport, checkIds: string[]): Promise<{ request: DoctorRepairRequest; verification: RequestVerification }> {
  const verification = judgeRequest(request, fresh, checkIds)
  const ts = new Date().toISOString()
  if (!verification.verified) {
    const why = verification.unhealthyCheckIds.length > 0
      ? `${verification.unhealthyCheckIds.length} originating check(s) did not evaluate healthy: ${verification.unhealthyCheckIds.join(', ')}`
      : `${verification.remainingIncidentIds.length} original incident(s) still reproduce.`
    const updated = updateDoctorRepairRequest(contentDir, request.id, (current) => ({
      ...current,
      events: [...current.events, { ts, type: 'verified', message: why, data: { reportId: fresh.id, ...verification } }],
    }))
    return { request: updated, verification }
  }
  const updated = updateDoctorRepairRequest(contentDir, request.id, (current) => ({
    ...current,
    status: 'verified',
    events: [...current.events, { ts, type: 'verified', message: 'Fresh targeted checks pass and the original incidents no longer reproduce.', data: { reportId: fresh.id, checkIds } }],
  }))
  if (request.approvalId) {
    const { cancelApproval } = await import('./approvals')
    await cancelApproval(request.approvalId, 'resolved').catch((err) => log.warn('Approval withdraw failed', err, { approvalId: request.approvalId }))
  }
  if (request.taskId) {
    const { addTaskLog } = await import('./task-store')
    const { moveTaskWithEffects } = await import('./task-service')
    await addTaskLog(request.taskId, 'system', `Verified by Health: ${checkIds.join(', ')} evaluated healthy and the incidents no longer reproduce. Closing.`)
      .catch((err) => log.warn('Task log write failed', err, { taskId: request.taskId }))
    await moveTaskWithEffects(request.taskId, 'done', 'system', { skipDoneGuard: true, channel: 'system' })
  }
  log.info('Health repair request verified and closed', { requestId: request.id, taskId: request.taskId, checkIds })
  return { request: updated, verification }
}

export interface AutoCloseSummary {
  checked: number
  closed: string[]
  kept: Array<{ requestId: string; reason: string }>
}

const OPEN_STATUSES = new Set<DoctorRepairRequest['status']>(['planned', 'sent', 'completed', 'failed'])
const CLOSED_COLUMNS = new Set(['done', 'archived'])

let inFlight: Promise<AutoCloseSummary> | null = null
let rerunRequested = false

async function reconcileOnce(contentDir: string, now: number): Promise<AutoCloseSummary> {
  const summary: AutoCloseSummary = { checked: 0, closed: [], kept: [] }
  const { getTaskDetails } = await import('./task-service')
  for (const request of listDoctorRepairRequests(contentDir)) {
    if (!OPEN_STATUSES.has(request.status) || !request.taskId) continue
    if (now - Date.parse(request.createdAt) < MIN_REQUEST_AGE_MS) continue
    const details = await getTaskDetails(request.taskId).catch(() => null)
    if (!details || CLOSED_COLUMNS.has(details.column)) continue
    summary.checked += 1
    try {
      const checkIds = originatingCheckIds(request, getHealthReport())
      if (checkIds.length === 0) {
        summary.kept.push({ requestId: request.id, reason: 'no originating checks' })
        continue
      }
      const fresh = await runTargetedDiagnostics(checkIds)
      const { verification } = await recordVerification(contentDir, request, fresh, checkIds)
      if (verification.verified) summary.closed.push(request.id)
      else summary.kept.push({ requestId: request.id, reason: verification.unhealthyCheckIds.length > 0 ? `unhealthy: ${verification.unhealthyCheckIds.join(', ')}` : `remaining: ${verification.remainingIncidentIds.join(', ')}` })
    } catch (err) {
      summary.kept.push({ requestId: request.id, reason: err instanceof Error ? err.message : String(err) })
      log.error('Repair request auto-close check failed', err, { requestId: request.id })
    }
  }
  if (summary.closed.length > 0) log.info('Auto-closed verified Health repair tasks', { closed: summary.closed })
  return summary
}

/** Single-flight: a call during a run queues exactly one more run after it. */
export function reconcileRepairRequests(contentDir: string, now = Date.now()): Promise<AutoCloseSummary> {
  if (inFlight) {
    rerunRequested = true
    return inFlight
  }
  inFlight = reconcileOnce(contentDir, now).finally(() => {
    inFlight = null
    if (rerunRequested) {
      rerunRequested = false
      void reconcileRepairRequests(contentDir).catch((err) => log.error('Queued auto-close pass failed', err))
    }
  })
  return inFlight
}

function incidentKey(report: HealthReport): string {
  return report.incidents.map((incident) => incident.id).sort().join('|')
}

/**
 * Debounced reconcile when the report's INCIDENT SET changes (an incident
 * clearing is the signal worth reacting to before the next cycle). Our own
 * targeted runs republish the report; the key comparison keeps that from
 * feeding back into another pass.
 */
export function startAutoCloseWatcher(contentDir: string, options: { debounceMs?: number } = {}): () => void {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  let lastKey = incidentKey(getHealthReport())
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsubscribe = onHealthReportChanged((report) => {
    const key = incidentKey(report)
    if (key === lastKey) return
    lastKey = key
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void reconcileRepairRequests(contentDir).catch((err) => log.error('Debounced auto-close pass failed', err))
    }, debounceMs)
    timer.unref?.()
  })
  return () => {
    unsubscribe()
    if (timer) clearTimeout(timer)
    timer = null
  }
}

/** Test-only: forget in-flight state. */
export function resetAutoCloseForTests(): void {
  inFlight = null
  rerunRequested = false
}
