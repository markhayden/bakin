/**
 * One-time, idempotent cutover of Bakin schedules off OpenClaw cron.
 *
 * Before this change, a Bakin schedule lived as an OpenClaw cron job whose fire
 * ran a tool-capable agent turn (the double-fire bug). Now Bakin fires its own
 * schedules from the store, so the OpenClaw cron job must go — otherwise it
 * keeps rogue-firing in parallel.
 *
 * For each Bakin job this copies the schedule expr / tz / enabled flag out of
 * the runtime cron (if not already stored) and then removes the runtime cron.
 * It is safe to run repeatedly: a job already migrated (expr stored, no runtime
 * cron) is a no-op. Runs automatically on activate (closing the upgrade gap)
 * and is reused by the doctor repair (T11) when the runtime was unreachable.
 */
import { createLogger } from '../../../src/core/logger'
import { readSidecar, upsertJob } from './sidecar'
import type { BakinJobMeta } from '../types'

const log = createLogger('schedule:cutover')

export interface CutoverSummary {
  /** Bakin jobs inspected. */
  checked: number
  /** Jobs whose runtime cron was found, imported, and removed this pass. */
  migrated: number
  /** Jobs already off OpenClaw cron (expr stored, no runtime cron). */
  alreadyMigrated: number
  /** Jobs with neither a runtime cron nor a stored expr — cannot fire. */
  unrecoverable: number
  /** Jobs the runtime errored on; left intact for a later retry/doctor pass. */
  failed: number
}

/** Minimal runtime cron surface the cutover needs, plus a tz fallback. */
export interface CutoverDeps {
  cronGet: (jobId: string) => Promise<{ schedule: string; enabled?: boolean; metadata?: Record<string, unknown> } | null>
  cronRemove: (jobId: string) => Promise<unknown>
  systemTz: () => string
}

export async function migrateBakinSchedulesOffOpenClawCron(deps: CutoverDeps): Promise<CutoverSummary> {
  const summary: CutoverSummary = { checked: 0, migrated: 0, alreadyMigrated: 0, unrecoverable: 0, failed: 0 }
  const jobs = Object.values(readSidecar().jobs).filter(job => job.isBakinJob)

  for (const meta of jobs) {
    summary.checked += 1
    try {
      const runtimeJob = await deps.cronGet(meta.jobId)
      if (!runtimeJob) {
        if (meta.schedule?.expr) {
          summary.alreadyMigrated += 1
        } else {
          summary.unrecoverable += 1
          log.warn('Bakin schedule has neither a stored expr nor a runtime cron; it cannot fire', { jobId: meta.jobId })
        }
        continue
      }

      // Runtime cron still present → import what we don't already own, then remove it.
      const metaTz = typeof runtimeJob.metadata?.tz === 'string' ? runtimeJob.metadata.tz : undefined
      const updated: BakinJobMeta = {
        ...meta,
        schedule: meta.schedule ?? { kind: 'cron', expr: runtimeJob.schedule },
        tz: meta.tz ?? metaTz ?? deps.systemTz(),
        enabled: meta.enabled ?? runtimeJob.enabled ?? true,
      }
      upsertJob(updated)
      await deps.cronRemove(meta.jobId)
      summary.migrated += 1
      log.info('Migrated Bakin schedule off OpenClaw cron', { jobId: meta.jobId })
    } catch (err) {
      summary.failed += 1
      log.warn('Cutover failed for schedule; leaving it for a later pass', {
        jobId: meta.jobId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (summary.migrated > 0 || summary.unrecoverable > 0) {
    log.info('Schedule cutover pass complete', { ...summary })
  }
  return summary
}
