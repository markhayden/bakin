/**
 * Health approval kinds (spec D6/D7, plan review R1/R4).
 *
 *   health-repair   — a NON-SAFE repair proposal frozen at escalation time.
 *                     Apply re-plans against fresh evidence and mutates only
 *                     when the fresh change set equals the frozen one; a
 *                     differing set cancels the approval (`plan-changed`) and
 *                     posts a fresh one. `applying` is written before any
 *                     mutation so a crash mid-apply is recoverable.
 *   health-navigate — an operator-only incident (resolution type navigate).
 *                     The one decision is Dismiss.
 *
 * Dismiss = snooze 7 d on action_required incidents (the ack store refuses a
 * permanent ack on that tier), ack on lower tiers; the task completes.
 *
 * Both kinds act on a durable doctor repair request (`doctor-repair-store`)
 * and its review task; every outcome is a request event + a task log line.
 * Task-service/task-store are imported lazily (same as escalation) to keep
 * this module out of their import cycles.
 */
import type { ApprovalRecord, RepairProposal } from '@bakin/core/approvals'
import type { ApprovalActor } from '@bakin/core/plugin-types'
import type {
  HealthIncident,
  HealthRepairChange,
  HealthRepairPlan,
  HealthRepairPlanItem,
  HealthReport,
} from '../../packages/core/src/plugin-types'
import {
  ApprovalResolveError,
  bakinBaseUrl,
  cancelApproval,
  registerApprovalKind,
  requestApproval,
  type ApprovalDecision,
  type ApprovalKindHandler,
  type ApprovalOwnerState,
  type RecordOf,
} from './approvals'
import { acknowledgeHealthIncident, getHealthReport } from './doctor-report-cache'
import { runTargetedDiagnostics } from './doctor-execution'
import { applyDoctorRepair, planDoctorRepair } from './doctor-repair'
import {
  createDoctorRepairRequest,
  getDoctorRepairRequest,
  listDoctorRepairRequests,
  updateDoctorRepairRequest,
  type DoctorRepairRequest,
  type DoctorRepairRequestEvent,
} from './doctor-repair-store'
import { createLogger } from './logger'

const log = createLogger('doctor-approvals')

export const DISMISS_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

export interface DoctorApprovalContext {
  contentDir: string
  projectRoot: string
}

let context: DoctorApprovalContext | null = null

function requireContext(): DoctorApprovalContext {
  if (!context) throw new ApprovalResolveError('Health approvals are not initialized on this server.', 500)
  return context
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** The structural shape shared by plan items and frozen proposal items. */
type ChangeLike = Pick<HealthRepairChange, 'target' | 'description'> & { kind: string; action: string }
type ItemLike = { actionId: string; changes: readonly ChangeLike[] }

/** Order-independent identity of what a set of items would change (R1). */
export function canonicalChangeSet(items: readonly ItemLike[]): string[] {
  return items
    .flatMap((item) => item.changes.map((change) => `${item.actionId}|${change.kind}|${change.target}|${change.action}`))
    .sort()
}

export function sameChangeSet(a: readonly ItemLike[], b: readonly ItemLike[]): boolean {
  const left = canonicalChangeSet(a)
  const right = canonicalChangeSet(b)
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

export function freezeProposal(report: HealthReport, items: readonly HealthRepairPlanItem[]): RepairProposal {
  return {
    reportId: report.id,
    observationIds: [...new Set(items.flatMap((item) => item.observationIds))].sort(),
    items: items.map((item) => ({
      actionId: item.actionId,
      itemId: item.id,
      safety: item.safety,
      changes: item.changes.map((change) => ({ ...change })),
    })),
  }
}

/** Check ids behind a set of observation ids, read from the report that holds them. */
export function checkIdsForObservations(report: HealthReport, observationIds: readonly string[]): string[] {
  const wanted = new Set(observationIds)
  return [...new Set(report.observations.filter((row) => wanted.has(row.id)).map((row) => row.checkId))].sort()
}

export function describeProposedChanges(proposal: RepairProposal): string[] {
  return proposal.items.flatMap((item) =>
    item.changes.map((change) => `- [${item.safety}] ${change.action} ${change.kind} \`${change.target}\` — ${change.description}`))
}

function summarizeIncidents(incidents: readonly HealthIncident[]): string {
  return incidents.length === 1 ? incidents[0]!.title : `${incidents.length} incidents need attention`
}

function incidentLines(incidents: readonly HealthIncident[]): string[] {
  return incidents.flatMap((incident) => [`- ${incident.title} (${incident.id})`, `  Impact: ${incident.impact}`])
}

function actorLabel(actor: ApprovalActor): string {
  return `${actor.displayName ?? actor.id} (${actor.source})`
}

function event(type: string, message: string, data?: Record<string, unknown>): DoctorRepairRequestEvent {
  return { ts: new Date().toISOString(), type, message, ...(data ? { data } : {}) }
}

function appendEvents(contentDir: string, requestId: string, events: DoctorRepairRequestEvent[], patch: Partial<DoctorRepairRequest> = {}): DoctorRepairRequest {
  return updateDoctorRepairRequest(contentDir, requestId, (current) => ({ ...current, ...patch, events: [...current.events, ...events] }))
}

async function taskLog(taskId: string | undefined, message: string): Promise<void> {
  if (!taskId) return
  const { addTaskLog } = await import('./task-store')
  await addTaskLog(taskId, 'system', message).catch((err) => log.warn('Task log write failed', err, { taskId }))
}

async function completeTask(taskId: string | undefined): Promise<void> {
  if (!taskId) return
  const { moveTaskWithEffects } = await import('./task-service')
  await moveTaskWithEffects(taskId, 'done', 'system', { skipDoneGuard: true, channel: 'system' })
}

async function blockTaskWithReason(taskId: string | undefined, reason: string): Promise<void> {
  if (!taskId) return
  const { blockTask } = await import('./task-store')
  await blockTask(taskId, reason, 'system', 'system')
}

// ─── Opening approvals (used by escalation) ──────────────────────────────────

export interface OpenedApproval {
  request: DoctorRepairRequest
  approval: ApprovalRecord
  taskId: string
}

function repairApprovalId(requestId: string, generation: number): string {
  return generation === 0 ? `health-repair:${requestId}` : `health-repair:${requestId}:${generation}`
}

function repairApprovalBody(incidents: readonly HealthIncident[], proposal: RepairProposal): string {
  return [
    'Bakin Health proposes a repair that changes state and needs your approval before it runs.',
    '',
    ...incidentLines(incidents),
    '',
    'Proposed changes:',
    ...describeProposedChanges(proposal),
    '',
    'Apply runs exactly these changes after re-checking that nothing moved; Dismiss snoozes the incidents for 7 days.',
  ].join('\n')
}

function requestRepairApprovalRecord(request: DoctorRepairRequest, taskId: string, incidents: readonly HealthIncident[], proposal: RepairProposal, approvalId: string): ApprovalRecord {
  return requestApproval({
    approvalId,
    owner: { kind: 'health-repair', taskId, requestId: request.id, incidentIds: [...request.incidentIds], proposal },
    request: {
      title: `Repair: ${summarizeIncidents(incidents)}`,
      body: repairApprovalBody(incidents, proposal),
      options: [
        { id: 'apply', label: 'Apply repair', variant: 'primary' },
        { id: 'dismiss', label: 'Dismiss', variant: 'neutral' },
      ],
      context: { requestId: request.id, taskId, incidentIds: [...request.incidentIds] },
    },
  })
}

/**
 * ONE review task + ONE `health-repair` approval for a set of non-safe plan
 * items. The task has no assignee: it is never dispatched (dispatch pulls
 * from todo only) and never stranded (restart recovery/watchdog read
 * inProgress only).
 */
export async function openRepairApproval(input: {
  contentDir: string
  report: HealthReport
  incidents: readonly HealthIncident[]
  items: readonly HealthRepairPlanItem[]
  plan: HealthRepairPlan
}): Promise<OpenedApproval> {
  const proposal = freezeProposal(input.report, input.items)
  const request = createDoctorRepairRequest(input.contentDir, {
    kind: 'approval-repair',
    plan: input.plan,
    incidentIds: input.incidents.map((incident) => incident.id),
    observationIds: proposal.observationIds,
    checkIds: checkIdsForObservations(input.report, proposal.observationIds),
    proposal,
  })
  const { createTaskWithEffects } = await import('./task-service')
  const task = await createTaskWithEffects({
    title: `Health: approve repair — ${summarizeIncidents(input.incidents)}`,
    column: 'review',
    description: repairApprovalBody(input.incidents, proposal),
    createdBy: 'system',
    source: { pluginId: 'health', entityType: 'doctor-repair', entityId: request.id, purpose: 'approval-repair' },
    channel: 'system',
  })
  const approvalId = repairApprovalId(request.id, 0)
  const approval = requestRepairApprovalRecord(request, task.id, input.incidents, proposal, approvalId)
  const sent = appendEvents(input.contentDir, request.id, [
    event('task-created', `Created review task ${task.id}.`, { taskId: task.id }),
    event('approval-requested', 'Posted the repair proposal for approval.', { approvalId }),
  ], { status: 'sent', taskId: task.id, approvalId })
  return { request: sent, approval, taskId: task.id }
}

/** ONE review task + ONE `health-navigate` approval per operator-only incident. */
export async function openNavigateApproval(input: {
  contentDir: string
  report: HealthReport
  incident: HealthIncident
}): Promise<OpenedApproval> {
  const { incident } = input
  const href = incident.resolution.type === 'navigate' ? incident.resolution.href : '/health'
  const absoluteHref = new URL(href, bakinBaseUrl()).toString()
  const request = createDoctorRepairRequest(input.contentDir, {
    kind: 'approval-navigate',
    incidentIds: [incident.id],
    observationIds: [...incident.observationIds],
    checkIds: checkIdsForObservations(input.report, incident.observationIds),
  })
  const body = [
    `${incident.title}`,
    `Impact: ${incident.impact}`,
    '',
    `This needs you: ${incident.resolution.label} — ${absoluteHref}`,
    '',
    'Dismiss snoozes the incident for 7 days; it closes on its own once Health verifies the fix.',
  ].join('\n')
  const { createTaskWithEffects } = await import('./task-service')
  const task = await createTaskWithEffects({
    title: `Health: ${incident.title}`,
    column: 'review',
    description: body,
    createdBy: 'system',
    source: { pluginId: 'health', entityType: 'doctor-repair', entityId: request.id, purpose: 'approval-navigate' },
    channel: 'system',
  })
  const approvalId = `health-navigate:${request.id}`
  const approval = requestApproval({
    approvalId,
    owner: { kind: 'health-navigate', taskId: task.id, requestId: request.id, incidentIds: [incident.id], href },
    request: {
      title: incident.title,
      body,
      options: [{ id: 'dismiss', label: 'Dismiss', variant: 'neutral' }],
      context: { requestId: request.id, taskId: task.id, href: absoluteHref },
    },
  })
  const sent = appendEvents(input.contentDir, request.id, [
    event('task-created', `Created review task ${task.id}.`, { taskId: task.id }),
    event('approval-requested', 'Posted the incident for operator attention.', { approvalId }),
  ], { status: 'sent', taskId: task.id, approvalId })
  return { request: sent, approval, taskId: task.id }
}

// ─── Decisions ───────────────────────────────────────────────────────────────

function liveRequestFor(record: ApprovalRecord & { owner: { requestId: string } }): DoctorRepairRequest {
  const { contentDir } = requireContext()
  const request = getDoctorRepairRequest(contentDir, record.owner.requestId)
  if (!request) throw new ApprovalResolveError('The Health repair request behind this approval no longer exists.', 409)
  if (request.approvalId !== record.approvalId) throw new ApprovalResolveError('A fresh proposal superseded this approval; decide the new one.', 409)
  if (request.status !== 'sent' && request.status !== 'planned') throw new ApprovalResolveError(`This Health request is already ${request.status}.`, 409)
  return request
}

async function ownerStateFor(record: ApprovalRecord & { owner: { requestId: string } }): Promise<ApprovalOwnerState> {
  const { contentDir } = requireContext()
  const request = getDoctorRepairRequest(contentDir, record.owner.requestId)
  if (!request) return 'orphaned'
  if (request.approvalId !== record.approvalId) return 'orphaned'
  return request.status === 'sent' || request.status === 'planned' ? 'live' : 'orphaned'
}

async function dismissRequest(request: DoctorRepairRequest, decision: ApprovalDecision): Promise<void> {
  const { contentDir } = requireContext()
  const report = getHealthReport()
  const silenced: string[] = []
  for (const incidentId of request.incidentIds) {
    const incident = report.incidents.find((row) => row.id === incidentId)
    if (!incident) continue
    try {
      acknowledgeHealthIncident(incident.effectiveDisposition === 'action_required'
        ? { incidentId, action: 'snooze', forMs: DISMISS_SNOOZE_MS }
        : { incidentId, action: 'ack' })
      silenced.push(incidentId)
    } catch (err) {
      log.warn('Dismiss could not silence a Health incident', err, { incidentId })
    }
  }
  const by = actorLabel(decision.actor)
  const note = decision.comment ? ` — ${decision.comment}` : ''
  appendEvents(contentDir, request.id, [event('dismissed', `Dismissed by ${by}${note}.`, { silenced, actor: decision.actor })], { status: 'dismissed' })
  await taskLog(request.taskId, `Dismissed by ${by}${note}. Silenced ${silenced.length} incident(s) for 7 days; they re-fire on new evidence.`)
  await completeTask(request.taskId)
}

async function planChanged(request: DoctorRepairRequest, record: RecordOf<'health-repair'>, report: HealthReport, fresh: HealthRepairPlan | null): Promise<never> {
  const { contentDir } = requireContext()
  await cancelApproval(record.approvalId, 'plan-changed')
  const freshItems = fresh?.items ?? []
  if (freshItems.length === 0) {
    appendEvents(contentDir, request.id, [event('plan-changed', 'The proposed repair no longer applies: nothing is left to repair.', { approvalId: record.approvalId })])
    await taskLog(request.taskId, 'The proposed repair no longer applies — nothing is left to repair. This task closes on its own once Health verifies the incidents are gone.')
    throw new ApprovalResolveError('Nothing is left to repair: the proposal was withdrawn and this task closes once Health verifies the incidents are gone.', 409)
  }
  const generation = request.events.filter((row) => row.type === 'approval-requested').length
  const proposal = freezeProposal(report, freshItems)
  const approvalId = repairApprovalId(request.id, generation)
  const incidents = report.incidents.filter((incident) => request.incidentIds.includes(incident.id))
  requestRepairApprovalRecord(request, request.taskId ?? record.owner.taskId, incidents, proposal, approvalId)
  appendEvents(contentDir, request.id, [
    event('plan-changed', 'The proposed changes differ from the approved ones; the approval was withdrawn.', { approvalId: record.approvalId, before: canonicalChangeSet(record.owner.proposal.items), after: canonicalChangeSet(freshItems) }),
    event('approval-requested', 'Posted the fresh repair proposal for approval.', { approvalId }),
  ], { approvalId, proposal, plan: fresh ?? undefined })
  await taskLog(request.taskId, `The proposed repair changed since you were asked (now: ${describeProposedChanges(proposal).join('; ')}). A fresh approval is waiting on this task.`)
  throw new ApprovalResolveError('The proposed repair changed since this approval was requested; a fresh proposal is waiting on the task.', 409)
}

async function applyApprovedRepair(request: DoctorRepairRequest, record: RecordOf<'health-repair'>, decision: ApprovalDecision): Promise<void> {
  const { contentDir, projectRoot } = requireContext()
  const proposal = record.owner.proposal
  const report = getHealthReport()
  const present = proposal.observationIds.filter((id) => report.observations.some((row) => row.id === id && row.status !== 'healthy'))
  let fresh: HealthRepairPlan | null = null
  if (present.length > 0) {
    fresh = await planDoctorRepair({ contentDir, projectRoot, target: { type: 'observations', reportId: report.id, ids: present as [string, ...string[]] } })
  }
  if (!fresh || !sameChangeSet(proposal.items, fresh.items)) await planChanged(request, record, report, fresh)
  const plan = fresh!

  const by = actorLabel(decision.actor)
  const itemIds = plan.items.map((item) => item.id)
  appendEvents(contentDir, request.id, [event('applying', `Approved by ${by}; applying ${itemIds.length} repair item(s).`, { planId: plan.planId, itemIds, actor: decision.actor })], { status: 'applying' })
  await taskLog(request.taskId, `Approved by ${by}. Applying ${describeProposedChanges(proposal).length} change(s)…`)

  let result: Awaited<ReturnType<typeof applyDoctorRepair>>
  try {
    result = await applyDoctorRepair({ contentDir, projectRoot, planId: plan.planId, itemIds, confirmedItemIds: itemIds })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    appendEvents(contentDir, request.id, [event('apply-failed', `Repair failed before verification: ${message}`)], { status: 'failed' })
    await taskLog(request.taskId, `Repair failed: ${message}`)
    await blockTaskWithReason(request.taskId, `Repair failed: ${message}`)
    return
  }

  const failed = result.results.filter((row) => row.status === 'failed')
  const stillOpen = new Set(result.report.incidents.map((incident) => incident.id))
  const remaining = request.incidentIds.filter((id) => stillOpen.has(id))
  const applied = event('applied', `Applied ${result.results.filter((row) => row.status === 'applied').length}/${result.results.length} repair item(s).`, {
    planId: plan.planId,
    results: result.results.map((row) => ({ itemId: row.itemId, status: row.status, message: row.message })),
    verifiedReportId: result.verifiedReportId,
  })
  if (failed.length === 0 && remaining.length === 0) {
    appendEvents(contentDir, request.id, [applied, event('verified', 'Fresh targeted checks pass; the incidents no longer reproduce.', { reportId: result.verifiedReportId, checkIds: result.affectedCheckIds })], { status: 'verified' })
    await taskLog(request.taskId, `Repair applied and verified: ${result.affectedCheckIds.join(', ')} healthy; incidents resolved.`)
    await completeTask(request.taskId)
    return
  }
  const reason = failed.length > 0
    ? `${failed.length} repair step(s) failed: ${failed.map((row) => row.message).join('; ')}`
    : `${remaining.length} incident(s) still reproduce after the repair: ${remaining.join(', ')}`
  appendEvents(contentDir, request.id, [applied, event('apply-failed', reason, { remainingIncidentIds: remaining })], { status: 'failed' })
  await taskLog(request.taskId, `Repair did not resolve the incidents. ${reason}`)
  await blockTaskWithReason(request.taskId, reason)
}

export const healthRepairApprovalKind: ApprovalKindHandler<'health-repair'> = {
  kind: 'health-repair',
  ownerState: ownerStateFor,
  async onResolve(record, decision) {
    const request = liveRequestFor(record)
    if (decision.option === 'dismiss') return dismissRequest(request, decision)
    if (decision.option === 'apply') return applyApprovedRepair(request, record, decision)
    throw new ApprovalResolveError(`Unknown repair decision "${decision.option}"`, 400)
  },
}

export const healthNavigateApprovalKind: ApprovalKindHandler<'health-navigate'> = {
  kind: 'health-navigate',
  ownerState: ownerStateFor,
  async onResolve(record, decision) {
    const request = liveRequestFor(record)
    if (decision.option === 'dismiss') return dismissRequest(request, decision)
    throw new ApprovalResolveError(`Unknown decision "${decision.option}" — this incident needs an operator action; Dismiss is the one decision here.`, 400)
  },
}

export function registerDoctorApprovalKinds(ctx: DoctorApprovalContext): void {
  context = ctx
  registerApprovalKind(healthRepairApprovalKind)
  registerApprovalKind(healthNavigateApprovalKind)
}

// ─── Boot recovery ───────────────────────────────────────────────────────────

/** Fresh-verification target for a request: stored check ids, else derived from the report. */
export function originatingCheckIds(request: Pick<DoctorRepairRequest, 'checkIds' | 'observationIds'>, report: HealthReport): string[] {
  if (request.checkIds.length > 0) return [...request.checkIds]
  const fromReport = checkIdsForObservations(report, request.observationIds)
  if (fromReport.length > 0) return fromReport
  // Observation ids are `${checkId}:${key}`; keys never contain ':'.
  return [...new Set(request.observationIds.map((id) => id.slice(0, id.lastIndexOf(':'))).filter(Boolean))].sort()
}

/**
 * A request left in `applying` was interrupted between mutation and its
 * `applied` event (crash/restart). Verify with fresh targeted checks: clean →
 * verified + task done; otherwise failed + blocked. The pending approval (the
 * handler never got to the record's CAS) is withdrawn either way.
 */
export async function recoverInterruptedApplies(contentDir: string): Promise<{ recovered: number; verified: number; failed: number }> {
  const summary = { recovered: 0, verified: 0, failed: 0 }
  for (const request of listDoctorRepairRequests(contentDir).filter((row) => row.status === 'applying')) {
    summary.recovered += 1
    try {
      const report = await runTargetedDiagnostics(originatingCheckIds(request, getHealthReport()))
      const stillOpen = new Set(report.incidents.map((incident) => incident.id))
      const remaining = request.incidentIds.filter((id) => stillOpen.has(id))
      if (request.approvalId) await cancelApproval(request.approvalId, 'interrupted')
      if (remaining.length === 0) {
        summary.verified += 1
        appendEvents(contentDir, request.id, [event('recovered', 'Apply was interrupted by a restart; fresh targeted checks pass.', { reportId: report.id })], { status: 'verified' })
        await taskLog(request.taskId, 'The repair was interrupted by a restart, but fresh Health checks pass — incidents resolved.')
        await completeTask(request.taskId)
      } else {
        summary.failed += 1
        const reason = `Repair was interrupted by a restart; ${remaining.length} incident(s) still reproduce: ${remaining.join(', ')}`
        appendEvents(contentDir, request.id, [event('interrupted', reason, { remainingIncidentIds: remaining, reportId: report.id })], { status: 'failed' })
        await taskLog(request.taskId, reason)
        await blockTaskWithReason(request.taskId, reason)
      }
    } catch (err) {
      log.error('Interrupted repair recovery failed', err, { requestId: request.id })
    }
  }
  if (summary.recovered > 0) log.info('Recovered interrupted Health repairs', summary)
  return summary
}
