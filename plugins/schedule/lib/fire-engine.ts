/**
 * Schedule fire engine — the claim→fire→heal core.
 *
 * The exactly-once firing path: claim a run in the execution ledger (the
 * (job_id, run_id) row IS the lock), evaluate pause/skip/overlap/outcome gates,
 * create the board task, attach the claim, and audit. Plus the healer that
 * re-drives claims stranded 'pending' by a crash between claim and task
 * creation. Reads the activated ctx via the single plugin-context cell; never
 * threads it. Behavior here is the live fire path for ALL Bakin schedules —
 * see .claude/knowledge/bakin-owned-scheduler.md.
 */
import { randomUUID } from 'crypto'
import type { BakinJobMeta, BridgeResult } from '../types'
import { getPluginCtx } from './plugin-context'
import { getSystemTimezone, expandTemplate } from './schedule-util'
import {
  upsertJob,
  getJob,
  isPaused,
  shouldSkip,
  recordFailure,
  recordSuccess,
  withDefaults,
} from './sidecar'
import { claimCronFire, attachCronTask, markCronFireSkipped, findHealableCronClaims } from '../../../src/core/execution-ledger'
import { createTaskWithEffects, validateTeamRef, TaskValidationError } from '../../../src/core/task-service'
import { TEAM_ROUTING_BLOCK_REASON } from '../../../src/core/dispatch-types'
import { addTaskLog, readTaskboard } from '../../../src/core/task-store'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('schedule')

/** `blockedReason` stamped on a catch-up task that landed in `blocked` because
 *  its occurrence was older than the catch-up window. This is a *triage*
 *  marker (the run never dispatched), NOT a failure — distinct from the
 *  dispatch-failure reasons set in `src/core/dispatch.ts`. The outcome check
 *  compares against this constant so a slept-through fire doesn't penalize a
 *  healthy job's auto-pause counter. */
export const MISSED_WINDOW_REASON = 'missed schedule window'

/** Re-exported from dispatch-team (round-4 review): ONE sentinel for every
 *  team-routing block — fire-time dangling teams AND dispatch-side resolver
 *  blocks — so the outcome check below never counts either toward
 *  auto-pause, no matter where the routing problem was detected. */
export { TEAM_ROUTING_BLOCK_REASON }

export interface ProcessRunResult {
  status: number
  body: BridgeResult
}

async function getScheduleDefaultOwner(): Promise<string> {
  const ctx = getPluginCtx()
  return ctx?.runtime ? getRuntimeMainAgentId(ctx.runtime) : 'main'
}

/** Claim a run, then fire it through the shared post-claim path. A lost claim
 *  (duplicate) is suppressed + audited, never an error — the (job_id, run_id)
 *  ledger key is the lock. */
async function fireScheduledRun(meta: BakinJobMeta, jobId: string, runId: string, firedAtMs: number): Promise<ProcessRunResult> {
  const claim = claimCronFire(jobId, runId, firedAtMs)
  if (!claim.claimed) {
    getPluginCtx()?.activity.audit('fire_suppressed', 'system', {
      jobId,
      runId,
      existingTaskId: claim.existing?.taskId ?? null,
      existingDisposition: claim.existing?.disposition ?? null,
    })
    return { status: 200, body: { ok: true, skipped: 'already-processed' } }
  }
  return runClaimedFire(meta, jobId, runId, { firedAtMs })
}

/** Drive a fire from a {jobId, runId?, timestamp?} payload — manual triggers
 *  and test harnesses. Mints a unique manual runId when none is given. */
export async function fireScheduledRunFromPayload(payload: { jobId: string; runId?: string; timestamp?: string }): Promise<ProcessRunResult> {
  const meta = getJob(payload.jobId)
  if (!meta?.isBakinJob) return { status: 200, body: { ok: true, skipped: 'not-bakin' } }
  const runId = payload.runId || `manual-${randomUUID()}`
  const parsed = payload.timestamp ? Date.parse(payload.timestamp) : NaN
  const firedAt = Number.isFinite(parsed) ? parsed : Date.now()
  return fireScheduledRun(meta, payload.jobId, runId, firedAt)
}

/** True if a task with this id exists on the board (any column). Lets a fire
 *  detect "row created but a post-create effect threw" and attach the claim
 *  instead of leaving it pending for the healer to duplicate. */
function storedTaskExists(taskId: string): boolean {
  try {
    const board = readTaskboard() as unknown as { columns: Record<string, Array<{ id: string }>> }
    return Object.values(board.columns).some(col => (col ?? []).some(t => t.id === taskId))
  } catch {
    return false
  }
}

// Every reason a fire can be skipped. 'job-removed' is the only one set outside
// skipFire() — the healer consumes an orphaned claim with no live ctx to audit.
type SkipReason = 'paused' | 'skip-count' | 'auto-paused' | 'overlap' | 'job-removed'

/** Record a skipped fire (ledger disposition + reason) AND surface it on the
 *  activity feed, so an overrunning or paused schedule shows up instead of
 *  silently dropping beats. */
function skipFire(jobId: string, runId: string, reason: SkipReason): ProcessRunResult {
  markCronFireSkipped(jobId, runId, reason)
  // activity.audit prepends the plugin id → observable event is `schedule.fire_skipped`
  // (matches fire_suppressed/fire_healed/task_created — bare operation, no manual prefix).
  getPluginCtx()?.activity.audit('fire_skipped', 'system', { jobId, runId, reason })
  return { status: 200, body: { ok: true, skipped: reason } }
}

export async function runClaimedFire(
  meta: BakinJobMeta,
  jobId: string,
  runId: string,
  opts: { column?: string; blockedReason?: string; firedAtMs?: number } = {},
): Promise<ProcessRunResult> {
  const defaults = withDefaults(meta, await getScheduleDefaultOwner())

  // Check pause state
  const pauseState = isPaused(meta)
  if (pauseState.paused) {
    upsertJob(meta) // persist any auto-resume changes
    return skipFire(jobId, runId, 'paused') // consumed — never healed into a task
  }

  // Check skip-next-N
  if (shouldSkip(meta)) {
    upsertJob(meta)
    return skipFire(jobId, runId, 'skip-count')
  }

  // Check failure auto-pause
  if ((defaults.consecutiveFailures ?? 0) >= (defaults.maxFailures ?? 3)) {
    meta.paused = true
    meta.pauseReason = 'auto-failures'
    meta.enabled = false // mirror manual pause: skip at the scheduler gate, no claim churn
    upsertJob(meta)
    return skipFire(jobId, runId, 'auto-paused')
  }

  // Both the overlap guard and last-task-outcome tracking inspect the board;
  // read it once. A read failure means we skip both checks and proceed.
  type BoardTask = { id: string; blockedReason?: string }
  let board: { columns: Record<string, BoardTask[]> } | null = null
  if (meta.lastTaskId) {
    try {
      board = readTaskboard() as unknown as { columns: Record<string, BoardTask[]> }
    } catch {
      log.debug('Could not read taskboard for overlap/outcome checks', { taskId: meta.lastTaskId })
    }
  }

  // Check overlap. `blocked` is intentionally excluded: a blocked task is
  // awaiting human triage, not running, so it must not suppress the next real
  // fire (that cascade silently ate scheduled runs — see SPEC).
  if (board && !defaults.allowOverlap && meta.lastTaskId) {
    const activeColumns = ['todo', 'inProgress', 'review'] as const
    for (const col of activeColumns) {
      const tasks = board.columns[col] ?? []
      if (tasks.some(t => t.id === meta.lastTaskId)) {
        return skipFire(jobId, runId, 'overlap')
      }
    }
  }

  // Check last task outcome for failure tracking
  if (board && meta.lastTaskId) {
    const doneOrArchived = [...(board.columns.done ?? []), ...(board.columns.archived ?? [])]
    if (doneOrArchived.some(t => t.id === meta.lastTaskId)) {
      recordSuccess(meta)
    } else {
      // A blocked last-task counts as a failure ONLY if it genuinely failed
      // during dispatch. A catch-up triage block (MISSED_WINDOW_REASON) never
      // ran — penalizing the job for it would auto-pause a healthy schedule
      // just because the server slept through a fire (see SPEC FR2).
      const blockedTask = (board.columns.blocked ?? []).find(t => t.id === meta.lastTaskId)
      const isTriageBlock = blockedTask?.blockedReason === MISSED_WINDOW_REASON
        || blockedTask?.blockedReason === TEAM_ROUTING_BLOCK_REASON
      if (blockedTask && !isTriageBlock) {
        const autoPaused = recordFailure(meta)
        if (autoPaused) {
          upsertJob(meta)
          return skipFire(jobId, runId, 'auto-paused')
        }
      }
    }
  }

  // Create the task. Label by the run's logical OCCURRENCE time, not wall-clock
  // creation time — a catch-up task for a missed run must read as the day it was
  // supposed to fire, not the (later) day it was created (see SPEC FR3). The
  // occurrence is an absolute instant; render it in the JOB's timezone so an
  // evening run that crosses UTC midnight still reads as its local day.
  const labelDate = new Date(opts.firedAtMs ?? Date.now())
  const labelTz = meta.tz || getSystemTimezone()
  const templateVars = {
    date: new Intl.DateTimeFormat('en-CA', {
      timeZone: labelTz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(labelDate), // en-CA → YYYY-MM-DD
    agent: meta.agentId ?? (meta.teamId ? `team:${meta.teamId}` : 'unassigned'),
    jobName: meta.displayName ?? jobId,
  }

  const title = meta.taskTitle
    ? expandTemplate(meta.taskTitle, templateVars)
    : `${meta.displayName ?? jobId} — ${labelDate.toLocaleDateString(undefined, { timeZone: labelTz })}`

  const description = meta.taskPrompt
    ? expandTemplate(meta.taskPrompt, templateVars)
    : undefined

  // Dangling-team guard (review R6): the team may have been deleted after
  // the job was configured, and createTaskWithEffects would then THROW on
  // every fire — occurrences lost, failures accumulating until auto-pause.
  // Instead, the occurrence lands as a BLOCKED task with an honest reason
  // (not a job failure): the user re-assigns it and fixes the schedule.
  let fireTeam = defaults.requireTriage ? undefined : meta.teamId
  let column = opts.column ?? 'todo'
  let blockedReason = opts.blockedReason
  let danglingTeamDetail: string | undefined
  let skipAssignmentValidation = false
  if (fireTeam && meta.agentId && !defaults.requireTriage) {
    // Legacy/hand-edited sidecar carrying BOTH: the agent wins (pre-#189
    // behavior) — never mint a both-set task through the skip flag (round-5).
    log.warn('Schedule meta has both agentId and teamId; agent wins for this fire', { jobId, agentId: meta.agentId, teamId: fireTeam })
    fireTeam = undefined
  }
  if (fireTeam) {
    try {
      await validateTeamRef(fireTeam)
      // Fire-time validation is authoritative — skip the redundant
      // re-validation inside createTaskWithEffects (round-5: the second
      // team.exists call re-opened the unavailable-window race this flag
      // was added to close, and doubled the hook traffic per fire).
      skipAssignmentValidation = true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const validation = err instanceof TaskValidationError ? err : null
      if (!validation || validation.code === 'validation_unavailable') {
        // NOT a dangling team: the team plugin is momentarily unavailable
        // (hot reload, boot order) or validation infra threw. Create the
        // occurrence WITH the team — dispatch's resolver re-checks and
        // blocks honestly if the team is truly gone (round-3 review).
        log.warn('Team validation unavailable at fire time; deferring to dispatch', { jobId, team: fireTeam, message })
        // Without this flag createTaskWithEffects re-validates against the
        // same unavailable plugin and throws — the defer would be dead and
        // the fire charged as a failure (round-4 review).
        skipAssignmentValidation = true
      } else {
        // Confirmed dangling team: land the occurrence blocked (triage, not
        // a job failure) so no run is lost and the job never auto-pauses.
        log.warn('Schedule job references a missing team; creating the occurrence blocked', { jobId, team: fireTeam, message })
        blockedReason = TEAM_ROUTING_BLOCK_REASON
        danglingTeamDetail = `Team routing failed: ${message}. Re-assign this task, and fix the schedule's team assignment.`
        column = 'blocked'
        fireTeam = undefined
      }
    }
  }

  // Pre-mint the task id so that if a post-create effect throws (e.g. the
  // workflow-start hook fails AFTER the row is written), we can still attach the
  // existing task to the claim. Otherwise the claim stays `pending`, the healer
  // re-drives it, and a *second* task is minted for the same occurrence (#472).
  const taskId = `task-${randomUUID()}`
  try {
    await createTaskWithEffects({
      id: taskId,
      title,
      description,
      column,
      blockedReason,
      assignee: defaults.requireTriage ? undefined : meta.agentId,
      // Team-assigned schedules (#189): each occurrence is a fresh task, so
      // dispatch re-resolves the best member per fire. requireTriage wins.
      team: fireTeam,
      skipAssignmentValidation,
      workflowId: meta.workflowId,
      createdBy: 'schedule',
      scheduleJobId: jobId,
      source: {
        pluginId: 'schedule',
        entityType: 'job',
        entityId: jobId,
        purpose: 'scheduled-run',
      },
    })
  } catch (err) {
    // If the row was never written, the claim is safe to retry — leave it
    // pending and surface the failure. If it WAS written (post-create effect
    // failed), fall through to attach it so the next heal can't duplicate it.
    if (!storedTaskExists(taskId)) {
      log.error('Schedule failed to create task', err)
      recordFailure(meta)
      upsertJob(meta)
      return { status: 500, body: { ok: false, error: (err as Error).message } }
    }
    log.warn('Scheduled task row created but a post-create effect failed; attaching to claim to avoid a duplicate', {
      jobId, runId, taskId, error: err instanceof Error ? err.message : String(err),
    })
  }

  meta.lastTaskId = taskId
  // A one-shot's single occurrence is now consumed (even a blocked catch-up
  // materialized a task) — auto-disable + stamp completedAt so the job reads
  // "completed" instead of pretending a next run exists. Run history stays.
  if (meta.schedule?.kind === 'at') {
    meta.enabled = false
    meta.completedAt = new Date(opts.firedAtMs ?? Date.now()).toISOString()
  }
  attachCronTask(jobId, runId, taskId)
  upsertJob(meta)

  // The human-readable dangling-team detail rides the task log (the
  // blockedReason itself is the triage sentinel the outcome check matches).
  if (danglingTeamDetail) {
    try {
      await addTaskLog(taskId, 'system', danglingTeamDetail)
    } catch (err) {
      log.warn('Could not append dangling-team detail to task log', { taskId, err: err instanceof Error ? err.message : String(err) })
    }
  }

  // Audit + activity feed — uses the EFFECTIVE blockedReason (the
  // dangling-team guard may have rewritten it; round-3 review).
  const auditCtx = getPluginCtx()
  if (auditCtx) {
    auditCtx.activity.audit('task_created', 'system', {
      jobId, runId, taskId, agent: meta.agentId, team: meta.teamId, owner: defaults.owner,
      ...(column !== 'todo' ? { column, blockedReason } : {}),
    })
    const where = column === 'blocked' ? ` (blocked — ${blockedReason ?? MISSED_WINDOW_REASON})` : ''
    auditCtx.activity.log('system', `Schedule "${meta.displayName ?? jobId}" created task ${taskId}${meta.agentId ? ` for ${meta.agentId}` : ''}${where}`, { taskId })
  }

  return { status: 200, body: { ok: true, taskId } }
}

const HEAL_AFTER_MS = 5 * 60_000

/**
 * Re-drive cron-fire claims stuck in 'pending'. The claim row is the lock,
 * so healing creates AT MOST one task per run — and re-evaluates pause/skip
 * state at heal time so a paused job's stranded claim is consumed, not
 * resurrected into a task.
 *
 * The scan→heal pass is not itself transactional; it's safe because the
 * server singleton lock guarantees one process and the scheduler's in-flight
 * guard serializes ticks within it. If either assumption ever changes, the
 * heal needs a claim-the-heal CAS (e.g. pending → healing disposition).
 */
export async function healPendingCronClaims(): Promise<void> {
  let stale: ReturnType<typeof findHealableCronClaims>
  try {
    stale = findHealableCronClaims(HEAL_AFTER_MS)
  } catch (err) {
    log.warn('Cron-claim heal scan failed', err)
    return
  }
  for (const claim of stale) {
    const meta = getJob(claim.jobId)
    if (!meta?.isBakinJob) {
      // Job deleted/unmanaged since the claim — consume it.
      markCronFireSkipped(claim.jobId, claim.runId, 'job-removed')
      continue
    }
    const result = await runClaimedFire(meta, claim.jobId, claim.runId, { firedAtMs: claim.firedAt })
    getPluginCtx()?.activity.audit('fire_healed', 'system', {
      jobId: claim.jobId,
      runId: claim.runId,
      taskId: (result.body as { taskId?: string }).taskId ?? null,
      skipped: (result.body as { skipped?: string }).skipped ?? null,
    })
  }
}

/** Fire a single occurrence on demand (run-now / manual trigger). Claims a
 *  unique manual run so it is never blocked by occurrence dedup. */
export async function fireManualRun(meta: BakinJobMeta, jobId: string): Promise<void> {
  await fireScheduledRun(meta, jobId, `manual-${randomUUID()}`, Date.now())
}
