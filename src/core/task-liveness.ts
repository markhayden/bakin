/**
 * Task liveness — ONE predicate, consumed by restart recovery, the watchdog,
 * the restart-recovery health check, continuation and the settle-time
 * hand-off (spec D3).
 *
 * The execution ledger is the only liveness authority: a task is stranded
 * when it is in progress and the ledger holds no `running` row for it. The
 * agent-written heartbeat files under ~/.bakin/heartbeats are status notes
 * for the Team page and gate nothing here.
 *
 * Run-heartbeat bumps carry execution identity (plan review R6): the stream
 * path knows the exact run id; the exec-tool and progress paths know only
 * task + agent and bump only when that pair resolves to exactly one row.
 */
import { bumpHeartbeat, bumpHeartbeatByTaskAgent, getLiveRun, getLiveRunByKey } from './execution-ledger'
import { createLogger } from './logger'

const log = createLogger('task-liveness')

/** The ONE home for the workflow-step exec key format (`claimDispatchRun` uses it). */
export function stepExecKey(taskId: string, stepId: string): string {
  return `${taskId}:${stepId}`
}

/** In progress AND no running ledger row ⇒ stranded. Any other column ⇒ never. */
export function isStrandedInProgress(task: { id: string; column: string }): boolean {
  if (task.column !== 'inProgress') return false
  return getLiveRun(task.id) === null
}

export interface WorkflowActiveAgent {
  agent: string
  stepId: string
  /** Nested workflows claim their step runs on the CHILD task id. */
  effectiveTaskId?: string
}

export interface WorkflowRunAssessment {
  /** Exec keys the active steps are expected to hold. */
  expected: string[]
  /** Subset of `expected` with a running ledger row. */
  live: string[]
  /** `expected` minus `live`. */
  missing: string[]
}

/** Which of a workflow task's active steps hold a live run, keyed the way dispatch claims them. */
export function assessWorkflowRuns(taskId: string, active: readonly WorkflowActiveAgent[]): WorkflowRunAssessment {
  const expected = active.map((entry) => stepExecKey(entry.effectiveTaskId ?? taskId, entry.stepId))
  const live = expected.filter((key) => getLiveRunByKey(key) !== null)
  const liveSet = new Set(live)
  return { expected, live, missing: expected.filter((key) => !liveSet.has(key)) }
}

/** Exact-run bump for the streaming path (the dispatch threadId IS the run id). Advisory. */
export function bumpRunHeartbeat(runId: string, now?: number): void {
  try {
    bumpHeartbeat(runId, now)
  } catch (err) {
    log.debug('Run heartbeat bump failed', { runId, err: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * Task + agent bump for the exec-tool and progress paths. Lands only when
 * exactly one running row belongs to that agent on that task. Advisory:
 * returns whether a row moved, never throws.
 */
export function bumpTaskRunHeartbeat(taskId: string | undefined, agent: string, now?: number): boolean {
  if (!taskId) return false
  try {
    const bumped = bumpHeartbeatByTaskAgent(taskId, agent, now)
    if (!bumped) log.debug('Run heartbeat not bumped: no single live run for task+agent', { taskId, agent })
    return bumped
  } catch (err) {
    log.debug('Run heartbeat bump failed', { taskId, agent, err: err instanceof Error ? err.message : String(err) })
    return false
  }
}
