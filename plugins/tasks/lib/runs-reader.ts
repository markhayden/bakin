/**
 * Reads a task's dispatch run history from the execution ledger's `runs` table
 * and maps it to the UI-facing TaskRunEntry. Read-only; mirrors the schedule
 * plugin's runs-reader pattern.
 */
import { getCompletion, listRunsByTask, type RunRow } from '../../../src/core/execution-ledger'
import { getTaskWithColumn } from '../../../src/core/task-store'
import type { TaskOutcome, TaskRunEntry } from '../types'

/** A task's dispatch attempts, newest-first. */
export function readTaskRuns(taskId: string, limit = 50): TaskRunEntry[] {
  return listRunsByTask(taskId, limit).map(runRowToEntry)
}

/**
 * The task's terminal outcome, distinct from any run's dispatch status (#476).
 * A completions row wins (it always implies the board reached done — archiving
 * a done task keeps it); otherwise the current column decides. Unknown task →
 * undefined.
 */
export function readTaskOutcome(taskId: string): TaskOutcome | undefined {
  const completion = getCompletion(taskId)
  if (completion) {
    return {
      state: 'done',
      completedAt: new Date(completion.completedAt).toISOString(),
      agent: completion.agent,
    }
  }
  const entry = getTaskWithColumn(taskId)
  if (!entry) return undefined
  switch (entry.column) {
    case 'blocked':
      return { state: 'blocked' }
    case 'archived':
      return { state: 'archived' }
    case 'done': // legacy done task without a completions row
      return { state: 'done' }
    default:
      return { state: 'in_progress' }
  }
}

export function runRowToEntry(run: RunRow): TaskRunEntry {
  return {
    runId: run.runId,
    taskId: run.taskId,
    seq: run.seq,
    agent: run.agent,
    status: run.status,
    startedAt: new Date(run.startedAt).toISOString(),
    settledAt: run.settledAt != null ? new Date(run.settledAt).toISOString() : undefined,
    settleReason: run.settleReason ?? undefined,
    durationMs: run.settledAt != null ? Math.max(0, run.settledAt - run.startedAt) : undefined,
  }
}
