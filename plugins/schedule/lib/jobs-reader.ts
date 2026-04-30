/**
 * Reads runtime cron jobs and merges them with Bakin sidecar metadata.
 */
import type { AgentRuntimeAdapter, CronJob, RuntimeMetadata } from '@bakin/core/adapters/runtime'
import { createLogger } from '../../../src/core/logger'
import { readSidecar, writeSidecar, withDefaults } from './sidecar'
import { cronToHuman } from './cron-parser'
import type { RuntimeCronJobSnapshot, MergedJob, BakinJobMeta } from '../types'

const log = createLogger('schedule:jobs')

type RuntimeCronReader = Pick<AgentRuntimeAdapter['cron'], 'list'>

/** Normalize a runtime cron job into the schedule plugin's merged-view input. */
export function runtimeCronToScheduleJob(job: CronJob): RuntimeCronJobSnapshot {
  const tz = metadataString(job.metadata, 'tz')
  const scheduleType = metadataScheduleType(job.metadata)
  return {
    id: job.id,
    name: job.name,
    schedule: {
      kind: scheduleType,
      type: scheduleType,
      expr: job.schedule,
      value: job.schedule,
      tz,
    },
    enabled: job.enabled,
    delivery: metadataString(job.metadata, 'webhookUrl')
      ? { mode: 'webhook', url: metadataString(job.metadata, 'webhookUrl') }
      : undefined,
    payload: { message: job.command },
    createdAt: metadataString(job.metadata, 'createdAt'),
    updatedAt: metadataString(job.metadata, 'updatedAt'),
  }
}

/** Extract best-effort context from an orphaned runtime cron job payload. */
function extractOrphanContext(job: RuntimeCronJobSnapshot): { prompt?: string } {
  if (!job.payload) return {}
  const msg = job.payload.message
  if (typeof msg === 'string' && msg.length > 0) {
    // If it starts with bakin:schedule:, it's a Bakin job that lost its sidecar
    // Otherwise surface the raw message as prompt context
    const bakinPrefix = 'bakin:schedule:'
    if (msg.startsWith(bakinPrefix)) {
      return { prompt: msg.slice(bakinPrefix.length) }
    }
    return { prompt: msg }
  }
  return {}
}

/** Merge a single runtime cron job with its sidecar entry, if any. */
export function mergeJob(
  job: RuntimeCronJobSnapshot,
  sidecar: BakinJobMeta | undefined,
  defaultOwner: string,
): MergedJob {
  const meta = sidecar ? withDefaults(sidecar, defaultOwner) : null

  const schedType = job.schedule.type ?? job.schedule.kind ?? 'cron'
  const schedValue = job.schedule.value ?? job.schedule.expr ?? ''
  const normalised = { type: schedType, value: schedValue, tz: job.schedule.tz }

  // For orphaned jobs (no sidecar), extract what we can from the payload
  const orphanContext = !meta ? extractOrphanContext(job) : {}
  const source = meta?.source ?? (meta?.isBakinJob ? 'bakin' : 'runtime')
  const normalizedSource = source === 'adopted' || meta?.originalRuntimeCron ? 'adopted' : source

  return {
    // Runtime cron fields (normalised)
    id: job.id,
    name: job.name,
    schedule: normalised,
    enabled: job.enabled,
    delivery: job.delivery,
    source: normalizedSource,
    canAdopt: !meta?.isBakinJob,
    canRestoreNative: Boolean(meta?.isBakinJob && meta.originalRuntimeCron),

    // Bakin sidecar (with defaults)
    isBakinJob: meta?.isBakinJob ?? false,
    displayName: meta?.displayName ?? job.name,
    description: meta?.description,
    agentId: meta?.agentId,  // null for orphans — don't guess, flag for triage
    owner: meta?.owner ?? defaultOwner,
    requireTriage: meta?.requireTriage ?? (!meta), // orphans need triage
    workflowId: meta?.workflowId,
    taskPrompt: meta?.taskPrompt ?? orphanContext.prompt,
    taskTitle: meta?.taskTitle,
    paused: meta?.paused ?? false,
    pauseUntil: meta?.pauseUntil,
    pauseReason: meta?.pauseReason,
    skipNextN: meta?.skipNextN,
    skippedCount: meta?.skippedCount,
    allowOverlap: meta?.allowOverlap ?? false,
    maxFailures: meta?.maxFailures ?? 3,
    consecutiveFailures: meta?.consecutiveFailures ?? 0,
    lastTaskId: meta?.lastTaskId,
    tz: meta?.tz ?? job.schedule.tz,
    createdAt: meta?.createdAt ?? job.createdAt,

    // Computed
    humanSchedule: schedType === 'cron'
      ? cronToHuman(schedValue)
      : schedType === 'every'
        ? `Every ${Math.round(parseInt(schedValue, 10) / 1000)}s`
        : `Once at ${schedValue}`,
    nextRun: undefined, // computed by caller with cron-parser lib
    lastRun: undefined, // enriched by caller from run history
  }
}

/** Read all jobs merged with sidecar metadata. */
export async function readMergedJobs(cron: RuntimeCronReader, defaultOwner: string): Promise<MergedJob[]> {
  const runtimeJobs = (await cron.list()).map(runtimeCronToScheduleJob)
  const sidecar = readSidecar()

  const merged = runtimeJobs.map(job => mergeJob(job, sidecar.jobs[job.id], defaultOwner))

  // Clean up stale sidecar entries for cron jobs deleted from the runtime.
  const activeIds = new Set(runtimeJobs.map(j => j.id))
  let dirty = false
  for (const jobId of Object.keys(sidecar.jobs)) {
    if (!activeIds.has(jobId)) {
      log.info('Removing stale sidecar entry', { jobId })
      delete sidecar.jobs[jobId]
      dirty = true
    }
  }
  if (dirty) {
    writeSidecar(sidecar)
  }

  return merged
}

function metadataString(metadata: RuntimeMetadata | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function metadataScheduleType(metadata: RuntimeMetadata | undefined): RuntimeCronJobSnapshot['schedule']['type'] {
  const value = metadataString(metadata, 'scheduleType')
  return value === 'every' || value === 'at' ? value : 'cron'
}
