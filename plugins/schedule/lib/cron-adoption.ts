/**
 * Switch-time cron adoption (pi-parity T3.4, story 7).
 *
 * When a runtime switch leaves a cron-bearing runtime, the switch snapshots
 * the source's native cron jobs BEFORE teardown and — when the user opted in
 * (`--adopt-cron`) — hands them here via the `schedule.adoptCronJobs` hook.
 * Each job becomes a Bakin-managed schedule with `source: 'adopted'` and the
 * provider-raw snapshot preserved (`originalRuntimeCron`), mirroring the
 * per-job REST adopt handler — minus the live `cron.get`/`cron.remove` calls
 * (the source runtime is already gone; its native jobs stop firing with it).
 *
 * Idempotent per job id: an already-Bakin-managed id is reported `skipped`,
 * so a re-run switch never duplicates schedules.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import { getRuntimeMainAgentId, type CronJob } from '@bakin/core/adapters/runtime'
import type { BakinJobMeta } from '../types'
import { getJob, upsertJob } from './sidecar'
import { getSystemTimezone, nativeCronTz } from './schedule-util'
import { indexJob } from './job-service'

export interface AdoptCronJobsInput {
  /** Source runtime adapter name (recorded as the snapshot provider). */
  provider: string
  jobs: Array<{ job: CronJob; raw: unknown }>
  /** Classify without writing (switch dry-run preview). */
  dryRun?: boolean
}

export interface AdoptCronJobsResult {
  adopted: string[]
  /** Already Bakin-managed — left untouched. */
  skipped: string[]
  failed: Array<{ jobId: string; error: string }>
}

export async function adoptCronJobs(
  ctx: Pick<PluginContext, 'runtime' | 'activity'>,
  input: AdoptCronJobsInput,
): Promise<AdoptCronJobsResult> {
  const result: AdoptCronJobsResult = { adopted: [], skipped: [], failed: [] }
  const now = new Date().toISOString()
  const tz = getSystemTimezone()
  let defaultOwner: string | undefined
  try {
    defaultOwner = await getRuntimeMainAgentId(ctx.runtime)
  } catch {
    // Ownerless adoption is still an adoption — the job edits fine later.
  }

  for (const { job, raw } of input.jobs) {
    try {
      const existing = getJob(job.id)
      if (existing?.isBakinJob) {
        result.skipped.push(job.id)
        continue
      }
      if (input.dryRun) {
        result.adopted.push(job.id)
        continue
      }

      const meta: BakinJobMeta = {
        ...(existing ?? {}),
        jobId: job.id,
        isBakinJob: true,
        source: 'adopted',
        schedule: { kind: 'cron', expr: job.schedule },
        enabled: job.enabled ?? true,
        displayName: existing?.displayName ?? job.name,
        agentId: existing?.agentId,
        teamId: existing?.teamId,
        owner: existing?.owner ?? defaultOwner,
        requireTriage: existing?.requireTriage ?? false,
        workflowId: existing?.workflowId,
        taskPrompt: existing?.taskPrompt ?? job.command,
        taskTitle: existing?.taskTitle,
        allowOverlap: existing?.allowOverlap ?? false,
        maxFailures: existing?.maxFailures ?? 3,
        consecutiveFailures: existing?.consecutiveFailures ?? 0,
        // Native tz wins over the system tz — the job must keep firing at
        // the local time its author chose, wherever this box thinks it is.
        tz: existing?.tz ?? nativeCronTz(job) ?? tz,
        originalRuntimeCron: {
          provider: input.provider,
          capturedAt: now,
          snapshot: raw,
        },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      upsertJob(meta)
      indexJob(job.id)
      ctx.activity.audit('job.adopted', 'system', { jobId: job.id, via: 'runtime-switch' })
      result.adopted.push(job.id)
    } catch (err) {
      result.failed.push({ jobId: job.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  if (!input.dryRun && result.adopted.length > 0) {
    ctx.activity.log('system', `Adopted ${result.adopted.length} runtime cron job(s) into Bakin during runtime switch`)
  }
  return result
}
