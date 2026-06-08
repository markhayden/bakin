/**
 * Reads a task's dispatch run history from the execution ledger's `runs` table
 * and maps it to the UI-facing TaskRunEntry. Read-only; mirrors the schedule
 * plugin's runs-reader pattern.
 */
import { listRunsByTask, type RunRow } from '../../../src/core/execution-ledger'
import type { TaskRunEntry } from '../types'

/** A task's dispatch attempts, newest-first. */
export function readTaskRuns(taskId: string, limit = 50): TaskRunEntry[] {
  return listRunsByTask(taskId, limit).map(runRowToEntry)
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
