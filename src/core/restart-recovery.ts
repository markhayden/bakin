/**
 * Restart recovery — one-shot boot repair for stranded in-progress tasks.
 *
 * The runtime adapter owns live execution. Bakin owns task state. The
 * execution ledger is the only liveness authority (spec D3): the boot sweep
 * marks every prior-boot run lost first, so any task still in progress with
 * no running row is stranded and can be returned to todo for re-dispatch.
 */
import { createLogger } from './logger'
import { getSettings } from './settings'
import { appendAudit } from './audit'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { withStateLock } from './dispatch-state'
import { assessWorkflowRuns, collectWorkflowDescendantTaskIds, isStrandedInProgress, type WorkflowActiveAgent, type WorkflowInstanceLike as LivenessInstance } from './task-liveness'
import {
  addTaskLog,
  blockTask,
  getTaskWithColumn,
  readTaskboard,
  recoverTask,
} from './task-store'

const log = createLogger('restart-recovery')
const hooks = () => getHookRegistry()

type RecoveryAction = 'recover' | 'block' | 'manual'

type RecoveryReason =
  | 'no-live-run'
  | 'workflow-no-live-run'
  | 'workflow-instance-missing'
  | 'workflow-no-active-agents'
  | 'workflow-partial-live-run'
  | 'workflow-not-running'

type RecoveryTask = {
  id: string
  title: string
  agent?: string
  workflowId?: string
  /** Persisted auto-recovery counter (spec D3); absent on legacy files ⇒ 0. */
  recoveries?: number
}

type WorkflowInstanceLike = LivenessInstance & {
  status?: string
}

export interface RestartRecoveryCandidate {
  id: string
  title: string
  agent?: string
  workflowId?: string
  /** Agents the task (or its active workflow steps) is assigned to. */
  effectiveAgents: string[]
  /** Exec keys the ledger holds no running row for (`taskId` or `taskId:stepId`). */
  missingRuns: string[]
  recoveryCount: number
  reason: RecoveryReason
  action: RecoveryAction
}

export interface RestartRecoveryResult {
  recovered: number
  blocked: number
  skipped: number
  candidates: RestartRecoveryCandidate[]
}

/** Shared with the watchdog: the persisted field, never log-line prefixes. */
function countRecoveries(task: RecoveryTask): number {
  return task.recoveries ?? 0
}

function uniq(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))]
}

function withActionForRecoveryLimit(
  task: RecoveryTask,
  candidate: Omit<RestartRecoveryCandidate, 'id' | 'title' | 'agent' | 'workflowId' | 'recoveryCount' | 'action'>,
): RestartRecoveryCandidate {
  const settings = getSettings()
  const recoveryCount = countRecoveries(task)
  return {
    id: task.id,
    title: task.title,
    agent: task.agent,
    workflowId: task.workflowId,
    recoveryCount,
    ...candidate,
    action: recoveryCount >= settings.watchdog.maxAutoRecoveries ? 'block' : 'recover',
  }
}

/**
 * The ledger scope a workflow assessment read (active steps + fanned-out task
 * ids). The assessment awaits hooks; the mutation boundary re-checks THIS
 * scope synchronously against the ledger so a step claimed during the await
 * is seen without another await (spec D9, code review round 3).
 */
interface RunScope {
  activeAgents: WorkflowActiveAgent[]
  descendants: string[]
}

async function assessWorkflowTask(
  task: RecoveryTask,
  contentDir: string,
  scope: RunScope,
): Promise<RestartRecoveryCandidate | null> {
  const recoveryCount = countRecoveries(task)
  const instance = await hooks().invoke<WorkflowInstanceLike | null>('workflows.loadInstance', {
    taskId: task.id,
    contentDir,
  })

  if (!instance) {
    return withActionForRecoveryLimit(task, {
      effectiveAgents: uniq([task.agent]),
      missingRuns: [task.id],
      reason: 'workflow-instance-missing',
    })
  }

  if (instance.status === 'pending_approval' || instance.status === 'complete' || instance.status === 'cancelled') {
    return null
  }

  if (instance.status !== 'in_progress') {
    return {
      id: task.id,
      title: task.title,
      agent: task.agent,
      workflowId: task.workflowId,
      effectiveAgents: [],
      missingRuns: [],
      recoveryCount,
      reason: 'workflow-not-running',
      action: 'manual',
    }
  }

  const activeAgents = await hooks().invoke<WorkflowActiveAgent[]>('workflows.getActiveAgents', {
    taskId: task.id,
    contentDir,
  }) ?? []
  const effectiveAgents = uniq(activeAgents.map((entry) => entry.agent))

  if (activeAgents.length === 0) {
    return {
      id: task.id,
      title: task.title,
      agent: task.agent,
      workflowId: task.workflowId,
      effectiveAgents: [],
      missingRuns: [],
      recoveryCount,
      reason: 'workflow-no-active-agents',
      action: 'manual',
    }
  }

  // Steps claim runs keyed by their (possibly nested-child) task id + step id.
  // A still-running previous-step row (the engine advanced before that turn
  // settled) is execution too — never stranded, never manual (review P1) —
  // including a completed nested/map child's final turn (review round 2).
  const descendants = await collectWorkflowDescendantTaskIds(task.id, (id) =>
    hooks().invoke<WorkflowInstanceLike | null>('workflows.loadInstance', { taskId: id, contentDir }))
  scope.activeAgents = activeAgents
  scope.descendants = descendants
  const runs = assessWorkflowRuns(task.id, activeAgents, descendants)
  if (runs.missing.length === 0 || (runs.live.length === 0 && runs.otherLive.length > 0)) return null

  if (runs.live.length > 0) {
    return {
      id: task.id,
      title: task.title,
      agent: task.agent,
      workflowId: task.workflowId,
      effectiveAgents,
      missingRuns: runs.missing,
      recoveryCount,
      reason: 'workflow-partial-live-run',
      action: 'manual',
    }
  }

  return withActionForRecoveryLimit(task, {
    effectiveAgents,
    missingRuns: runs.missing,
    reason: 'workflow-no-live-run',
  })
}

interface Assessment {
  candidate: RestartRecoveryCandidate | null
  /** Synchronous ledger re-check over the scope the assessment read — for the mutation boundary. */
  stillStranded: () => boolean
}

async function assessTask(task: RecoveryTask, contentDir: string): Promise<Assessment> {
  if (task.workflowId) {
    const scope: RunScope = { activeAgents: [], descendants: [] }
    const candidate = await assessWorkflowTask(task, contentDir, scope)
    return { candidate, stillStranded: () => assessWorkflowRuns(task.id, scope.activeAgents, scope.descendants).stranded }
  }

  const stillStranded = (): boolean => isStrandedInProgress({ id: task.id, column: 'inProgress' })
  if (!stillStranded()) return { candidate: null, stillStranded }

  return {
    candidate: withActionForRecoveryLimit(task, {
      effectiveAgents: uniq([task.agent]),
      missingRuns: [task.id],
      reason: 'no-live-run',
    }),
    stillStranded,
  }
}

export async function findRestartRecoveryCandidates(contentDir: string): Promise<RestartRecoveryCandidate[]> {
  const board = readTaskboard() as unknown as { columns?: { inProgress?: RecoveryTask[] } }
  const tasks = board.columns?.inProgress ?? []
  const candidates: RestartRecoveryCandidate[] = []

  for (const task of tasks) {
    try {
      const { candidate } = await assessTask(task, contentDir)
      if (candidate) candidates.push(candidate)
    } catch (err) {
      log.warn('Failed to assess restart recovery candidate', err, { id: task.id })
    }
  }

  return candidates
}

/**
 * Decide and write ONE candidate. Called under the dispatch state lock.
 * Fresh validation at the mutation boundary (spec D9): the candidate list is
 * one board read, but every mutation below awaits, so a task may have been
 * moved, reset or claimed meanwhile. Re-read the row and re-assess it; act on
 * the FRESH verdict (a reset counter recovers instead of blocking, a run that
 * went live is left alone).
 */
/** One task's settlement: what the engine did and, when it did nothing, why. */
export interface StrandedTaskOutcome {
  id: string
  outcome: 'recovered' | 'blocked' | 'skipped'
  reason?: string
}

async function settleCandidate(
  snapshot: RestartRecoveryCandidate,
  contentDir: string,
  settings: ReturnType<typeof getSettings>,
): Promise<StrandedTaskOutcome> {
  const skipped = (reason: string): StrandedTaskOutcome => ({ id: snapshot.id, outcome: 'skipped', reason })
  const fresh = getTaskWithColumn(snapshot.id)
  if (!fresh || fresh.column !== 'inProgress') {
    log.info('Restart recovery skipped a candidate that left in-progress meanwhile', { id: snapshot.id })
    return skipped('left in progress meanwhile')
  }
  let candidate: RestartRecoveryCandidate | null
  let stillStranded: () => boolean
  try {
    ({ candidate, stillStranded } = await assessTask({
      id: snapshot.id,
      title: fresh.task.title,
      agent: fresh.task.agent,
      workflowId: fresh.task.workflowId,
      recoveries: fresh.task.recoveries,
    }, contentDir))
  } catch (err) {
    log.warn('Failed to re-assess restart recovery candidate', err, { id: snapshot.id })
    return skipped(`re-assessment failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!candidate) {
    log.info('Restart recovery skipped a candidate that gained a live run meanwhile', { id: snapshot.id })
    return skipped('gained a live run meanwhile')
  }
  // The re-assessment awaited workflow hooks; any write to the row in that
  // window (operator move or reset, engine step advance, agent log) bumps
  // `version` — leave such a task alone this pass rather than act on a
  // verdict computed from the pre-await row.
  const again = getTaskWithColumn(snapshot.id)
  if (!again || again.column !== 'inProgress' || again.task.version !== fresh.task.version) {
    log.info('Restart recovery skipped a candidate written during re-assessment', { id: snapshot.id })
    return skipped('the task changed during re-assessment')
  }
  // A workflow step claim writes the ledger, not the task row (the card is
  // already in progress), so `version` cannot see it. Re-check the ledger
  // synchronously over the scope the assessment read; from here to the
  // store write nothing awaits (code review round 3). A manual hold is a
  // log line, not a mutation of the work — it still records.
  if (candidate.action !== 'manual' && !stillStranded()) {
    log.info('Restart recovery skipped a candidate whose run went live during re-assessment', { id: snapshot.id })
    return skipped('its run went live during re-assessment')
  }

  if (candidate.action === 'manual') {
    // Durable + visible hold: the structured marker makes the watchdog
    // skip this task while it is the latest log entry (any newer activity
    // clears the hold naturally). A hold is not an attempt — the counter
    // is untouched.
    try {
      await addTaskLog(
        candidate.id,
        'system',
        `Manual recovery hold: ${candidate.reason} (no live run: ${candidate.missingRuns.join(', ') || 'unknown'}). Left in progress for manual attention; the watchdog will not auto-recover while this is the latest log entry.`,
        { restartRecovery: 'manual' },
      )
    } catch (err) {
      log.warn('Failed to write manual recovery hold marker', err, { taskId: candidate.id })
    }
    return skipped(`manual hold: ${candidate.reason} — an operator chooses the next state`)
  }

  try {
    if (candidate.action === 'block') {
      await blockTask(
        candidate.id,
        `Restart recovery limit reached (${candidate.recoveryCount} attempts). No live run in the execution ledger.`,
      )
      await addTaskLog(
        candidate.id,
        'system',
        `Restart recovery: recovery limit reached after ${candidate.recoveryCount} attempts; task moved to blocked for manual review.`,
      )
      appendAudit(contentDir, 'task.restart_recovery_exhausted', 'system', {
        id: candidate.id,
        title: candidate.title,
        agent: candidate.agent,
        workflowId: candidate.workflowId,
        recoveryCount: candidate.recoveryCount,
        reason: candidate.reason,
      })
      log.warn('Restart recovery blocked exhausted task', {
        id: candidate.id,
        title: candidate.title,
        recoveryCount: candidate.recoveryCount,
      })
      return { id: candidate.id, outcome: 'blocked', reason: `recovery limit reached after ${candidate.recoveryCount} attempts; moved to blocked for review` }
    }

    // ONE store write (todo + recoveries+1), THEN the log line.
    await recoverTask(candidate.id)
    await addTaskLog(
      candidate.id,
      'system',
      `Restart recovery: no live run after server restart; returned to Todo for re-dispatch (attempt ${candidate.recoveryCount + 1} of ${settings.watchdog.maxAutoRecoveries}).`,
    )
    appendAudit(contentDir, 'task.restart_recovered', 'system', {
      id: candidate.id,
      title: candidate.title,
      agent: candidate.agent,
      workflowId: candidate.workflowId,
      effectiveAgents: candidate.effectiveAgents,
      reason: candidate.reason,
      recoveryCount: candidate.recoveryCount + 1,
    })
    log.info('Restart recovery moved task to todo', {
      id: candidate.id,
      title: candidate.title,
      reason: candidate.reason,
    })
    return { id: candidate.id, outcome: 'recovered' }
  } catch (err) {
    log.error('Restart recovery failed for task', err, { id: candidate.id })
    return skipped(`recovery failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function count(result: RestartRecoveryResult, outcome: StrandedTaskOutcome): void {
  if (outcome.outcome === 'recovered') result.recovered++
  else if (outcome.outcome === 'blocked') result.blocked++
  else result.skipped++
}

/**
 * The operator's requeue (Health's `requeue-stranded-tasks`, self-healing
 * 1.3d): settle exactly the named tasks through the same engine — the same
 * re-assessment, lock and verdicts as the boot pass — and report each one.
 * A task that is not stranded any more (not in progress, or with a live run)
 * is reported, never touched.
 */
export async function recoverStrandedTasks(contentDir: string, ids: readonly string[]): Promise<StrandedTaskOutcome[]> {
  const settings = getSettings()
  const candidates = await findRestartRecoveryCandidates(contentDir)
  const outcomes: StrandedTaskOutcome[] = []
  for (const id of ids) {
    const snapshot = candidates.find((candidate) => candidate.id === id)
    if (!snapshot) {
      outcomes.push({ id, outcome: 'skipped', reason: 'not stranded any more: the task is not in progress or has a live run' })
      continue
    }
    outcomes.push(await withStateLock(() => settleCandidate(snapshot, contentDir, settings)))
  }
  return outcomes
}

export async function runRestartRecovery(contentDir: string): Promise<RestartRecoveryResult> {
  const settings = getSettings()
  const candidates = await findRestartRecoveryCandidates(contentDir)
  const result: RestartRecoveryResult = {
    recovered: 0,
    blocked: 0,
    skipped: 0,
    candidates,
  }

  if (settings.restartRecovery?.enabled === false) {
    if (candidates.length > 0) {
      log.warn('Restart recovery disabled; leaving candidates untouched', { count: candidates.length })
    }
    result.skipped = candidates.length
    return result
  }

  for (const snapshot of candidates) {
    // Under the dispatch state lock (#977): every ledger claim is made under
    // it (dispatch-cycle / -single / -team → claimDispatchRun), so while a
    // candidate is re-assessed and written no step or child can go live —
    // and HTTP is up during startup recovery, so claims DO arrive.
    count(result, await withStateLock(() => settleCandidate(snapshot, contentDir, settings)))
  }

  if (result.recovered > 0 || result.blocked > 0 || result.skipped > 0) {
    log.info('Restart recovery complete', {
      recovered: result.recovered,
      blocked: result.blocked,
      skipped: result.skipped,
    })
  }

  return result
}
