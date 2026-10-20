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
  getStoredRepairPlan,
  createStoredRepairPlan,
  DoctorRepairConfirmationError,
  DoctorRepairStalePlanError,
} from './doctor-repair-plans'
import { releaseIncidents, reserveIncidents, transferIncidents } from './doctor-reservations'
import { getDoctorRepairRequest, openRepairWorkByIncident } from './doctor-repair-store'
import { checkEvaluatedFresh } from './doctor-autoclose'
import {
  CHILD_PARTIAL_CODE,
  CHILD_SKIPPED_CODE,
  OperationCancelledError,
  OperationRejectedError,
  parentOutcome,
  tallyChildren,
  type OperationContext,
  type OperationOrigin,
  type OperationOutcome,
  type OperationPlan,
  type OperationStartResponse,
  type OperationView,
} from '@bakin/core/operations'
import { getOperationRegistry } from './operations'

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
  remainingIncidentIds: string[]
  report: HealthReport
}

function targetObservationIds(report: HealthReport, target: HealthRepairTarget): string[] {
  if (target.reportId !== report.id) {
    throw new Error('Repair planning requires the current Health report.')
  }
  if (target.type === 'observations') return [...new Set(target.ids)]
  const incidentIds = target.type === 'incidents'
    ? new Set(target.ids)
    // Effective disposition (#690): all_actionable follows what surfaces show.
    : new Set(report.incidents.filter((incident) => incident.effectiveDisposition === 'action_required').map((incident) => incident.id))
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

function skippedResult(item: HealthRepairPlanItem, message: string): HealthRepairApplyResult {
  return { itemId: item.id, actionId: item.actionId, status: 'skipped', message, affectedCheckIds: [], changes: [] }
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

/**
 * The repair parent's own plan (#895 D10): its children (one per selected
 * action) run under `apply`, then `verify` re-runs the affected checks. The
 * parent has no point of no return of its own — it latches non-cancellable as
 * soon as any child passes its point of no return.
 */
export const REPAIR_PARENT_PLAN: OperationPlan = {
  stages: [
    { id: 'apply', kind: 'installing', label: 'Apply repairs' },
    { id: 'verify', kind: 'verifying', label: 'Re-check Health' },
  ],
  pointOfNoReturn: null,
}

export interface DoctorRepairStartOptions extends DoctorRepairApplyOptions {
  origin: OperationOrigin
  /**
   * The agent this apply acts for (CLI agent context, #898). A repair-type
   * incident an OPEN delegated task is working refuses every other caller
   * (`repair_in_flight`, held by that task); the task's own agent is the one
   * explicit hand-off — it is doing the work it was asked to do.
   */
  actingAgentId?: string
  /**
   * Owner token that takes the incident reservation back when the operation
   * settles (escalation hands the safe subset over and wants it back before
   * it records each disposition — no window for a delegation to grab it).
   * Absent: the reservation is released at settle.
   */
  releaseTo?: string
}

/** Validation failures keep today's 409 bodies (D22). */
function rejectAsToday(error: unknown): never {
  if (error instanceof DoctorRepairStalePlanError) {
    throw new OperationRejectedError(409, { error: error.message, code: error.code })
  }
  if (error instanceof DoctorRepairConfirmationError) {
    throw new OperationRejectedError(409, { error: error.message, code: error.code, itemIds: error.itemIds })
  }
  throw error
}

/** Child outcome from an action's validated rows. */
function childOutcome(results: HealthRepairApplyResult[]): OperationOutcome<HealthRepairApplyResult[]> {
  const applied = results.some((r) => r.status === 'applied')
  const failed = results.some((r) => r.status === 'failed')
  if (failed) return { status: 'failed', code: applied ? CHILD_PARTIAL_CODE : 'apply_failed', message: results.find((r) => r.status === 'failed')?.message, httpStatus: 200, body: results }
  return { status: 'succeeded', code: applied ? 'ok' : CHILD_SKIPPED_CODE, httpStatus: 200, body: results }
}

/**
 * Starts the repair as a parent operation (D10): the request fingerprint is
 * claimed BEFORE the plan is consumed (two tabs applying the same selection
 * attach to one run), validation keeps today's 409s, then one child per
 * selected action runs in sequence with its own plan and resources, and
 * `verify` re-runs the affected checks. `result.body` is the
 * `DoctorRepairApplyReport` — rows are kept on every outcome.
 */
/** The repair operation's fingerprint — also its incident-reservation owner token (#896). */
export function repairFingerprint(planId: string, itemIds: readonly string[]): string {
  return `repair:${planId}:${[...itemIds].sort().join(',')}`
}

export async function startDoctorRepair(options: DoctorRepairStartOptions): Promise<OperationStartResponse> {
  void options.projectRoot
  const registry = getOperationRegistry()
  const fingerprint = repairFingerprint(options.planId, options.itemIds)
  // Admission BEFORE ownership (#896 D3.1): the selected items' incidents are
  // reserved under this request's fingerprint before the registry sees it.
  // Identical requests attach (same token); a DIFFERENT plan over any of these
  // incidents — another tab, escalation, a delegation — is refused here, so
  // two repairs never work one incident. A plan the store no longer holds
  // reserves nothing: validate answers STALE_PLAN for it as today.
  const stored = getStoredRepairPlan(options.planId)
  const incidentIds = [...new Set(
    (stored?.items ?? []).filter((item) => options.itemIds.includes(item.id)).flatMap((item) => item.incidentIds),
  )]
  // Durable admission: an OPEN delegated task (a live agent run) already
  // works the incident — refuse unless this apply IS that task's agent. The
  // dependency is loaded FIRST; from here to `registry.start` nothing yields,
  // so the durable check and the reservation are one synchronous admission
  // (a delegation cannot finish persistence in between).
  const { getTaskWithColumn } = await import('./task-store')
  const working = delegatedTaskWorking(options.contentDir, incidentIds, options.actingAgentId, getTaskWithColumn)
  if (working) {
    throw new OperationRejectedError(409, {
      error: `Repair task ${working.taskId} is already working ${working.incidentId}.`,
      code: 'repair_in_flight',
      overlapping: [working.incidentId],
      heldBy: `task:${working.taskId}`,
    })
  }
  const reservation = incidentIds.length > 0 ? reserveIncidents(incidentIds, fingerprint) : null
  if (reservation?.status === 'refused') {
    throw new OperationRejectedError(409, {
      error: 'A repair is already working these incidents.',
      code: 'repair_in_flight',
      overlapping: reservation.overlapping,
      heldBy: reservation.heldBy,
    })
  }
  const owns = reservation?.status === 'granted'
  // The hand-back is keyed by fingerprint, not by caller: a request that
  // ATTACHES to a running twin never runs its own settle, so the twin's
  // settle consults this and honours the attacher's releaseTo.
  if (options.releaseTo) handBackByFingerprint.set(fingerprint, options.releaseTo)
  let validated: ReturnType<typeof claimRepairApplication> | undefined
  let current: HealthReport | undefined
  try {
    return await registry.start<DoctorRepairApplyReport>({
      kind: 'repair',
      owner: 'core',
      origin: options.origin,
      title: options.itemIds.length === 1 ? 'Apply a Health repair' : `Apply ${options.itemIds.length} Health repairs`,
      href: '/health',
      fingerprint,
      plan: REPAIR_PARENT_PLAN,
      validate: () => {
        current = getHealthReport()
        try {
          validated = claimRepairApplication({
            planId: options.planId,
            itemIds: options.itemIds,
            confirmedItemIds: options.confirmedItemIds,
            report: current,
          })
        } catch (error) {
          rejectAsToday(error)
        }
      },
      run: async (op) => {
        try {
          return await runDoctorRepair(op, options, validated!, current!)
        } finally {
          settleReservation(fingerprint, incidentIds)
        }
      },
    })
  } catch (error) {
    // Validation refused (or the registry threw) before anything ran: a
    // reservation this request GRANTED must not outlive it. An attached
    // request never releases — the running twin owns the incidents.
    if (owns) settleReservation(fingerprint, incidentIds)
    throw error
  }
}

/** fingerprint → owner token that takes the incidents back at settle (set by whichever caller asked). */
const handBackByFingerprint = new Map<string, string>()

/** At settle the incidents go back to the caller that asked for them (attached or not), or free. */
function settleReservation(fingerprint: string, incidentIds: readonly string[]): void {
  const releaseTo = handBackByFingerprint.get(fingerprint)
  handBackByFingerprint.delete(fingerprint)
  if (releaseTo && transferIncidents(incidentIds, fingerprint, releaseTo)) return
  releaseIncidents(fingerprint)
}

/**
 * The newest OPEN delegated request whose task still exists, for any of these
 * incidents — unless the caller is that task's own agent (the hand-off).
 * Synchronous on purpose (see the caller); request and task reads are
 * memoised so a wide apply does not re-read one request per incident.
 */
function delegatedTaskWorking(
  contentDir: string,
  incidentIds: readonly string[],
  actingAgentId: string | undefined,
  getTaskWithColumn: (taskId: string) => unknown,
): { taskId: string; incidentId: string } | null {
  if (incidentIds.length === 0) return null
  const index = openRepairWorkByIncident(contentDir)
  const requests = new Map<string, ReturnType<typeof getDoctorRepairRequest>>()
  const tasksExist = new Map<string, boolean>()
  for (const incidentId of incidentIds) {
    for (const work of index.get(incidentId) ?? []) {
      if (!requests.has(work.requestId)) requests.set(work.requestId, getDoctorRepairRequest(contentDir, work.requestId))
      const request = requests.get(work.requestId)
      if (request?.kind !== 'delegate') continue
      if (!tasksExist.has(work.taskId)) tasksExist.set(work.taskId, Boolean(getTaskWithColumn(work.taskId)))
      if (!tasksExist.get(work.taskId)) continue // task gone — the request covers nothing
      if (actingAgentId && request.agentId === actingAgentId) break // the owning agent acts for its task
      return { taskId: work.taskId, incidentId }
    }
  }
  return null
}

async function runDoctorRepair(
  op: OperationContext,
  options: DoctorRepairStartOptions,
  validated: ReturnType<typeof claimRepairApplication>,
  current: HealthReport,
): Promise<OperationOutcome<DoctorRepairApplyReport>> {
  const registry = getOperationRegistry()
  const byAction = new Map<string, HealthRepairPlanItem[]>()
  for (const item of validated.items) {
    const rows = byAction.get(item.actionId) ?? []
    rows.push(item)
    byAction.set(item.actionId, rows)
  }

  op.stage('apply')
  const results: HealthRepairApplyResult[] = []
  const children: OperationView[] = []
  let cancelled = false
  // Actions unregistered since validation (a plugin unloaded) fail without a child.
  let missingActions = 0
  for (const [actionId, items] of byAction) {
    const action = getHealthRepairAction(actionId)
    if (!action) {
      missingActions += 1
      results.push(...items.map((item) => failedResult(item, new Error(`Repair action ${actionId} is no longer registered.`))))
      continue
    }
    if (cancelled) {
      results.push(...items.map((item) => skippedResult(item, 'Cancelled before this repair started.')))
      continue
    }
    try {
      const child = await registry.startChild<HealthRepairApplyResult[]>(op.id, {
        kind: `repair:${actionId}`,
        title: action.name,
        fingerprint: actionId,
        resources: action.resources ?? [],
        plan: action.operationPlan(items),
        run: async (childOp) => childOutcome(applyOutput(await action.apply(items, childOp), actionId, items)),
      })
      children.push(child)
      if (child.result && Array.isArray(child.result.body) && child.status !== 'cancelled') {
        // The child validated its rows; unexpected throws arrive as a 500 body.
        const rows = child.result.httpStatus === 200 ? child.result.body : items.map((item) => failedResult(item, new Error(child.outcome?.message ?? 'Repair failed')))
        results.push(...rows)
      } else if (child.status === 'cancelled') {
        results.push(...items.map((item) => skippedResult(item, 'Cancelled before anything was changed.')))
      } else {
        results.push(...items.map((item) => failedResult(item, new Error(child.outcome?.message ?? 'Repair failed'))))
      }
    } catch (error) {
      if (!(error instanceof OperationCancelledError)) throw error
      cancelled = true
      results.push(...items.map((item) => skippedResult(item, 'Cancelled before this repair started.')))
    }
  }

  const tally = tallyChildren(children)
  tally.failed += missingActions
  if (cancelled && tally.applied === 0) throw new OperationCancelledError(op.id)

  const selectedObservationIds = new Set(validated.items.flatMap((item) => item.observationIds))
  const inferredCheckIds = current.observations
    .filter((observation) => selectedObservationIds.has(observation.id))
    .map((observation) => observation.checkId)
  const affectedCheckIds = [...new Set([...inferredCheckIds, ...results.flatMap((result) => result.affectedCheckIds)])].sort()
  let report: HealthReport
  if (cancelled) {
    op.skip('verify', 'cancelled after a repair applied — re-run Health to verify')
    report = getHealthReport()
  } else {
    op.stage('verify')
    report = await runTargetedDiagnostics(affectedCheckIds)
  }
  const remainingIncidentIds = report.incidents
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
    remainingIncidentIds,
  })

  const body: DoctorRepairApplyReport = {
    planId: options.planId,
    basedOnReportId: validated.plan.basedOnReportId,
    results,
    affectedCheckIds,
    verifiedReportId: report.id,
    remainingIncidentIds,
    report,
  }
  // Verified needs evidence, not absence: every affected check ran fresh and
  // none of the selected observations is still unhealthy (R4).
  const verified = remainingIncidentIds.length === 0
    && affectedCheckIds.every((checkId) => checkEvaluatedFresh(report, checkId))
    && !report.observations.some((row) => selectedObservationIds.has(row.id) && row.status !== 'healthy')
  const outcome = parentOutcome(tally, { cancelled, verified: cancelled ? null : verified })
  const failedRows = results.filter((r) => r.status === 'failed').length
  const message = outcome.code === 'ok'
    ? `Applied and verified.`
    : outcome.code === 'nothing_applied'
      ? 'Nothing needed changing.'
      : outcome.code === 'verification_failed'
        ? remainingIncidentIds.length > 0
          ? `Applied, but ${remainingIncidentIds.length} related incident(s) remain.`
          : 'Applied, but Health could not confirm the fix — re-run Health.'
        : `${failedRows} repair item(s) failed.`
  return {
    status: outcome.status === 'cancelled' ? 'failed' : outcome.status,
    code: outcome.code,
    message,
    httpStatus: 200,
    body,
  }
}

/** In-process callers (escalation, approvals): the terminal report, or a throw for a run that produced none. */
export async function awaitDoctorRepair(operationId: string): Promise<{ view: OperationView; report: DoctorRepairApplyReport | null }> {
  const view = await getOperationRegistry().await(operationId)
  const report = view.result?.httpStatus === 200 ? view.result.body as DoctorRepairApplyReport : null
  return { view, report }
}
