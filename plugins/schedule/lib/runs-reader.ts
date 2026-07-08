/**
 * Reads per-job run history.
 *
 * Bakin-owned schedules no longer have runtime cron runs — their fire history
 * lives in the execution ledger's cron_fires table (each occurrence's claim +
 * disposition). Native (unmanaged) runtime crons still report through the
 * adapter. We route by ownership so both surfaces show real history.
 */
import type { AgentRuntimeAdapter, CronRun } from '@bakin/core/adapters/runtime'
import { createLogger } from '../../../src/core/logger'
import { listCronFires, type CronFireRow } from '../../../src/core/execution-ledger'
import { getJob } from './sidecar'
import type { RunEntry } from '../types'

const log = createLogger('schedule:runs')

// cron is an OPTIONAL runtime capability (P2.1): readers accept undefined —
// Bakin jobs read the ledger regardless; native jobs simply have no history.
type RuntimeCronRunReader = Pick<NonNullable<AgentRuntimeAdapter['cron']>, 'listRuns'>

/** Read run history for a specific job. Returns newest-first. */
export async function readRuns(cron: RuntimeCronRunReader | undefined, jobId: string, limit = 50): Promise<RunEntry[]> {
  if (getJob(jobId)?.isBakinJob) return readLedgerRuns(jobId, limit)
  if (!cron) return []
  try {
    return (await cron.listRuns(jobId)).slice(0, limit).map(runtimeRunToEntry)
  } catch (err) {
    log.warn('Failed to read run history', err, { jobId })
    return []
  }
}

/** Get the most recent run for a job. */
export async function getLastRun(cron: RuntimeCronRunReader | undefined, jobId: string): Promise<RunEntry | null> {
  const runs = await readRuns(cron, jobId, 1)
  return runs[0] ?? null
}

/** Bakin schedule fire history from the execution ledger (newest-first). */
function readLedgerRuns(jobId: string, limit: number): RunEntry[] {
  try {
    return listCronFires(jobId, limit).map(cronFireToEntry)
  } catch (err) {
    log.warn('Failed to read run history from ledger', err, { jobId })
    return []
  }
}

export function cronFireToEntry(fire: CronFireRow): RunEntry {
  // A cron_fires row records the FIRE outcome (did the schedule create/skip a
  // task), not the task's terminal result — so 'success' = "a task was created".
  // RunEntry's 'failure' status is only reachable via the native-cron adapter
  // path (runtimeRunToEntry); ledger fires are never red.
  const status: RunEntry['status'] =
    fire.disposition === 'skipped' ? 'skipped' : fire.disposition === 'pending' ? 'pending' : 'success' // created | seeded
  return {
    runId: fire.runId,
    jobId: fire.jobId,
    timestamp: new Date(fire.firedAt).toISOString(),
    status,
    taskId: fire.taskId ?? undefined,
    skippedReason: fire.skipReason ?? undefined,
  }
}

export function runtimeRunToEntry(run: CronRun): RunEntry {
  return {
    runId: run.id,
    jobId: run.jobId,
    timestamp: run.startedAt ?? run.endedAt ?? new Date().toISOString(),
    status: run.status === 'failed' ? 'failure' : run.status === 'cancelled' ? 'skipped' : 'success',
    duration: run.startedAt && run.endedAt
      ? Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt))
      : undefined,
    error: run.error,
  }
}
