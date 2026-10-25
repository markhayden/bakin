import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import type { HealthIncident, HealthRepairTarget } from '../../packages/core/src/plugin-types'
import { getAppServices } from './app-services'
import { dispatchSingleTask } from './dispatch'
import { getHealthReport } from './doctor-report-cache'
import { runDiagnostics } from './doctor-execution'
import { planDoctorRepair } from './doctor-repair'
import {
  DoctorRepairRequestNotFoundError,
  createDoctorRepairRequest,
  getDoctorRepairRequest,
  openRepairWorkByIncident,
  updateDoctorRepairRequest,
  type DoctorRepairRequest,
  type OpenRepairWork,
} from './doctor-repair-store'
import { buildRepairBrief, type FallbackBriefInput } from './doctor-brief'
import { createTaskWithEffects, getTaskDetails } from './task-service'
import { randomUUID } from 'crypto'
import { incidentHolder, releaseIncidents, reserveIncidents, transferIncidents } from './doctor-reservations'

export interface DoctorDelegateOptions {
  contentDir: string
  projectRoot: string
  accepted: boolean
  target?: HealthRepairTarget
  /**
   * The caller's incident-reservation token (#896 D3.2): escalation hands the
   * incidents it already holds over, so the delegation transfers them to its
   * own token instead of reserving afresh, keeps them through request + task
   * persistence, and releases them once the request file is written.
   */
  reservation?: string
  /**
   * The fallback-investigation sections of the brief (`core.diagnose`,
   * self-healing 1.5): engine attempts, hand-back contract, verbs, Terminal
   * convention, turn budget. Absent = today's delegated-repair brief.
   */
  fallback?: FallbackBriefInput
}

export type DoctorDelegateReport = DoctorDelegateOutcome | DoctorDelegateRefusal

export interface DoctorDelegateOutcome {
  /** `already_delegated`: every targeted incident already has an open repair task (`request` is that work). */
  status: 'confirmation_required' | 'sent' | 'no_unresolved' | 'already_delegated'
  request: DoctorRepairRequest
  incidents: HealthIncident[]
}

/**
 * Admission refused (#896 D3.3): a repair or another delegation already
 * holds at least one targeted incident. Nothing was written — no request,
 * no task. `overlapping` names the held incidents, `heldBy` the owner token.
 */
export interface DoctorDelegateRefusal {
  status: 'repair_in_flight'
  incidents: HealthIncident[]
  overlapping: string[]
  heldBy: string
}

export interface DoctorDelegateVerificationReport {
  request: DoctorRepairRequest
  remainingIncidentIds: string[]
  verified: boolean
  reportId: string
}

function summarize(incidents: readonly HealthIncident[]): string {
  return `${incidents.length} incident${incidents.length === 1 ? '' : 's'} need attention`
}

/**
 * Delegations run one at a time: the open-work check and the task it
 * records are separated by awaits (agent lookup, task creation), so two
 * concurrent calls would both pass the check and open duplicate tasks.
 */
let delegationChain: Promise<unknown> = Promise.resolve()

export function delegateDoctorRepair(options: DoctorDelegateOptions): Promise<DoctorDelegateReport> {
  const run = delegationChain.then(() => delegateOnce(options))
  delegationChain = run.catch(() => undefined)
  return run
}

async function delegateOnce(options: DoctorDelegateOptions): Promise<DoctorDelegateReport> {
  const report = getHealthReport()
  const target = options.target ?? { type: 'all_actionable' as const, reportId: report.id }
  const plan = await planDoctorRepair({
    contentDir: options.contentDir,
    projectRoot: options.projectRoot,
    target: { ...target, reportId: report.id } as HealthRepairTarget,
  })
  const incidentIds = target.type === 'incidents'
    ? new Set(target.ids)
    : target.type === 'observations'
      ? new Set(report.incidents.filter((incident) => incident.observationIds.some((id) => target.ids.includes(id))).map((incident) => incident.id))
      // Effective disposition (#690): a sensitivity-demoted incident must not
      // spawn a paid repair task every surface called calm.
      : new Set(report.incidents.filter((incident) => incident.effectiveDisposition === 'action_required').map((incident) => incident.id))
  const targeted = report.incidents.filter((incident) => incidentIds.has(incident.id))
  // An incident an open repair task already works is never delegated twice
  // (spec D-G3): Health resurfaces that task instead.
  // A request whose task was deleted works nothing — the incident may be delegated again.
  const index = openRepairWorkByIncident(options.contentDir)
  const working = new Map<string, OpenRepairWork>()
  for (const incident of targeted) {
    // Newest first; fall back past a request whose task was deleted.
    for (const work of index.get(incident.id) ?? []) {
      if (await getTaskDetails(work.taskId).catch(() => null)) { working.set(incident.id, work); break }
    }
  }
  const incidents = targeted.filter((incident) => !working.has(incident.id))
  if (targeted.length > 0 && incidents.length === 0) {
    const existing = getDoctorRepairRequest(options.contentDir, working.get(targeted[0]!.id)!.requestId)
    if (existing) return { status: 'already_delegated', request: existing, incidents: targeted }
  }
  const observationIds = [...new Set(incidents.flatMap((incident) => incident.observationIds))]
  // Admission (#896 D3.3): hold the incidents under this delegation's own
  // token before anything is written. A caller that already holds them
  // (escalation) hands them over; anyone else reserves afresh and is refused
  // while a repair or another delegation holds any of them.
  const delegationToken = `delegation:${randomUUID()}`
  const delegatedIds = incidents.map((incident) => incident.id)
  if (options.reservation) {
    transferIncidents(delegatedIds.filter((id) => incidentHolder(id) === options.reservation), options.reservation, delegationToken)
  } else if (delegatedIds.length > 0) {
    const admission = reserveIncidents(delegatedIds, delegationToken)
    if (admission.status === 'refused') {
      return { status: 'repair_in_flight', incidents: targeted, overlapping: admission.overlapping, heldBy: admission.heldBy }
    }
  }
  try {
    // Everything from the first write on sits inside the cleanup block: a
    // failed request write (ENOSPC, permissions) must not leak the hold.
    const request = createDoctorRepairRequest(options.contentDir, {
      plan,
      incidentIds: delegatedIds,
      observationIds,
    })
    return await persistDelegation(options, request, incidents)
  } finally {
    releaseIncidents(delegationToken) // the written request (and its task) cover them from here
  }
}

async function persistDelegation(options: DoctorDelegateOptions, request: DoctorRepairRequest, incidents: HealthIncident[]): Promise<DoctorDelegateReport> {
  if (incidents.length === 0) return { status: 'no_unresolved', request, incidents }
  if (!options.accepted) return { status: 'confirmation_required', request, incidents }

  const runtime = getAppServices().runtime
  const agentId = await getRuntimeMainAgentId(runtime)
  const task = await createTaskWithEffects({
    title: `Health repair: ${summarize(incidents)}`,
    column: 'todo',
    assignee: agentId,
    description: buildRepairBrief({ requestId: request.id, incidents, ...(options.fallback ? { fallback: options.fallback } : {}) }),
    createdBy: 'system',
    source: {
      pluginId: 'health',
      entityType: 'doctor-repair',
      entityId: request.id,
      purpose: 'delegated-repair',
    },
    channel: 'system',
  })

  updateDoctorRepairRequest(options.contentDir, request.id, (current) => ({
    ...current,
    status: 'sent',
    taskId: task.id,
    agentId,
    events: [...current.events, {
      ts: new Date().toISOString(),
      type: 'task-created',
      message: `Created linked repair task ${task.id}.`,
      data: { taskId: task.id, agentId },
    }],
  }))
  await dispatchSingleTask(task.id, options.contentDir, Number(process.env.PORT || 3737), 'kick')
  const sent = updateDoctorRepairRequest(options.contentDir, request.id, (current) => ({
    ...current,
    status: 'sent',
    events: [...current.events, {
      ts: new Date().toISOString(),
      type: 'dispatch-kicked',
      message: `Kicked immediate dispatch for linked repair task ${task.id}.`,
      data: { taskId: task.id, agentId },
    }],
  }))
  return { status: 'sent', request: sent, incidents }
}

/**
 * Manual verify (route/CLI): a fresh full sweep, then the SAME judgement the
 * cycle auto-close uses (plan review R4) — verified only when every
 * originating check evaluated healthy and no incident remains; a pass
 * completes the linked task and withdraws any pending approval.
 */
export async function verifyDoctorRepairRequest(
  options: Pick<DoctorDelegateOptions, 'contentDir' | 'projectRoot'> & { requestId: string },
): Promise<DoctorDelegateVerificationReport> {
  const request = getDoctorRepairRequest(options.contentDir, options.requestId)
  if (!request) throw new DoctorRepairRequestNotFoundError(options.requestId)
  const report = await runDiagnostics(options.contentDir, options.projectRoot)
  const { originatingCheckIds, recordVerification } = await import('./doctor-autoclose')
  const checkIds = originatingCheckIds(request, report)
  if (request.status === 'verified' || request.status === 'dismissed' || request.status === 'applying') {
    const open = new Set(report.incidents.map((incident) => incident.id))
    const remainingIncidentIds = request.incidentIds.filter((id) => open.has(id))
    return { request, remainingIncidentIds, verified: request.status === 'verified', reportId: report.id }
  }
  const { request: updated, verification } = await recordVerification(options.contentDir, request, report, checkIds)
  return { request: updated, remainingIncidentIds: verification.remainingIncidentIds, verified: verification.verified, reportId: report.id }
}
