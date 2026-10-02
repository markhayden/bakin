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
import { bumpHeartbeat, bumpHeartbeatByTaskAgent, getLiveRun, getLiveRunByKey, listLiveRuns, type RunRow } from './execution-ledger'
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
  /**
   * Running rows on this task or any of its descendant task ids whose exec
   * key is NOT an expected step — the previous step's turn still settling
   * after the engine advanced (review P1), or a completed nested/map child's
   * final turn (review round 2). Execution remains, so the task is not
   * stranded even when no expected step has started yet.
   */
  otherLive: RunRow[]
  /** No execution remains anywhere: no expected step live and no other live row. */
  stranded: boolean
}

/** The slice of a persisted workflow instance the descendant walk reads. */
export interface WorkflowInstanceLike {
  stepStates?: Record<string, { childTaskId?: string; children?: Array<{ childTaskId: string }> } | undefined>
}

/**
 * Every task id a workflow instance has ever fanned out to — nested child
 * instances (`childTaskId`) and map children, in ANY step status, recursively.
 * A completed child's final turn can still be settling after the parent
 * advanced (review round 2), so completed steps are walked too. The loader is
 * injected (callers use the `workflows.loadInstance` hook); unknown or cyclic
 * ids stop the walk.
 */
export async function collectWorkflowDescendantTaskIds(
  taskId: string,
  loadInstance: (id: string) => Promise<WorkflowInstanceLike | null | undefined>,
): Promise<string[]> {
  const seen = new Set<string>([taskId])
  const out: string[] = []
  const queue = [taskId]
  while (queue.length > 0) {
    const current = queue.shift()!
    const instance = await loadInstance(current)
    for (const state of Object.values(instance?.stepStates ?? {})) {
      const ids = [
        ...(state?.childTaskId ? [state.childTaskId] : []),
        ...(state?.children ?? []).map((child) => child.childTaskId),
      ]
      for (const id of ids) {
        if (!id || seen.has(id)) continue
        seen.add(id)
        out.push(id)
        queue.push(id)
      }
    }
  }
  return out
}

/**
 * Which of a workflow task's active steps hold a live run, keyed the way
 * dispatch claims them. `descendants` are the instance's fanned-out task ids
 * (`collectWorkflowDescendantTaskIds`) so a completed child's still-running
 * final turn counts as execution.
 */
export function assessWorkflowRuns(
  taskId: string,
  active: readonly WorkflowActiveAgent[],
  descendants: readonly string[] = [],
): WorkflowRunAssessment {
  const expected = active.map((entry) => stepExecKey(entry.effectiveTaskId ?? taskId, entry.stepId))
  const live = expected.filter((key) => getLiveRunByKey(key) !== null)
  const liveSet = new Set(live)
  const expectedSet = new Set(expected)
  const taskIds = new Set([taskId, ...descendants, ...active.map((entry) => entry.effectiveTaskId).filter((id): id is string => !!id)])
  const otherLive = listLiveRuns().filter((run) => taskIds.has(run.taskId) && !expectedSet.has(run.execKey))
  return {
    expected,
    live,
    missing: expected.filter((key) => !liveSet.has(key)),
    otherLive,
    stranded: live.length === 0 && otherLive.length === 0,
  }
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
