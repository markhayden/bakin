/**
 * Reads cron run history from the active runtime adapter.
 */
import type { AgentRuntimeAdapter, CronRun } from '@bakin/core/adapters/runtime'
import { createLogger } from '../../../src/core/logger'
import type { RunEntry } from '../types'

const log = createLogger('schedule:runs')

type RuntimeCronRunReader = Pick<AgentRuntimeAdapter['cron'], 'listRuns'>

/** Read run history for a specific job. Returns newest-first. */
export async function readRuns(cron: RuntimeCronRunReader, jobId: string, limit = 50): Promise<RunEntry[]> {
  try {
    return (await cron.listRuns(jobId)).slice(0, limit).map(runtimeRunToEntry)
  } catch (err) {
    log.warn('Failed to read run history', err, { jobId })
    return []
  }
}

/** Get the most recent run for a job. */
export async function getLastRun(cron: RuntimeCronRunReader, jobId: string): Promise<RunEntry | null> {
  const runs = await readRuns(cron, jobId, 1)
  return runs[0] ?? null
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
