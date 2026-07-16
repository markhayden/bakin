/**
 * Reads runtime cron jobs and merges them with Bakin sidecar metadata.
 */
import type { AgentRuntimeAdapter, CronJob, RuntimeMetadata } from '@bakin/core/adapters/runtime'
import { createLogger } from '../../../src/core/logger'
import { readSidecar, writeSidecar, withDefaults } from './sidecar'
import { cronToHuman } from './cron-parser'
import { scheduleNextRun } from './cron-eval'
import type { RuntimeCronJobSnapshot, MergedJob, BakinJobMeta } from '../types'

const log = createLogger('schedule:jobs')

// cron is an OPTIONAL runtime capability (P2.1): readers accept undefined and
// degrade to Bakin-owned schedules only (a runtime without native cron simply
// contributes zero native jobs).
type RuntimeCronReader = Pick<NonNullable<AgentRuntimeAdapter['cron']>, 'list'>

/** Normalize a runtime cron job into the schedule plugin's merged-view input. */
export function runtimeCronToScheduleJob(job: CronJob): RuntimeCronJobSnapshot {
  const tz = metadataString(job.metadata, 'tz')
  const scheduleType = metadataScheduleType(job.metadata)
  const toolsAllow = normalizeToolsAllow(job.toolsAllow)
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
    toolsAllow,
    toolsAllowMissing: !toolsAllow && !isBakinScheduleMetadata(job.metadata),
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
    teamId: meta?.teamId,    // team-routed jobs (#189) — UI edit/list read this
    owner: meta?.owner ?? defaultOwner,
    requireTriage: meta?.requireTriage ?? (!meta), // orphans need triage
    workflowId: meta?.workflowId,
    taskPrompt: meta?.taskPrompt ?? orphanContext.prompt,
    taskTitle: meta?.taskTitle,
    toolsAllow: job.toolsAllow,
    toolsAllowMissing: meta?.isBakinJob ? false : job.toolsAllowMissing ?? false,
    paused: meta?.paused ?? false,
    pauseUntil: meta?.pauseUntil,
    pauseReason: meta?.pauseReason,
    skipNextN: meta?.skipNextN,
    skippedCount: meta?.skippedCount,
    allowOverlap: meta?.allowOverlap ?? false,
    maxFailures: meta?.maxFailures ?? 3,
    consecutiveFailures: meta?.consecutiveFailures ?? 0,
    lastTaskId: meta?.lastTaskId,
    completedAt: meta?.completedAt,
    tz: meta?.tz ?? job.schedule.tz,
    createdAt: meta?.createdAt ?? job.createdAt,

    // Computed
    humanSchedule: schedType === 'cron'
      ? cronToHuman(schedValue)
      : schedType === 'every'
        ? `Every ${Math.round(parseInt(schedValue, 10) / 1000)}s`
        : `Once at ${schedValue}`,
    // 'every' only occurs on native runtime crons — no Bakin next-run math.
    nextRun: (schedType === 'cron' || schedType === 'at') && schedValue && !meta?.completedAt
      ? scheduleNextRun({ kind: schedType, expr: schedValue }, job.schedule.tz ?? meta?.tz, new Date())?.toISOString()
      : undefined,
    lastRun: undefined, // enriched by caller from run history
    completed: meta?.schedule?.kind === 'at' && !!meta?.completedAt,
  }
}

/** Synthesize a runtime-cron-shaped snapshot from a store-owned Bakin schedule.
 *  Post-cutover, Bakin schedules have no runtime cron — the store is the source
 *  of truth — so the merged view is built from the stored schedule definition. */
export function storeJobToSnapshot(meta: BakinJobMeta): RuntimeCronJobSnapshot {
  const expr = meta.schedule?.expr ?? ''
  const kind = meta.schedule?.kind ?? 'cron'
  return {
    id: meta.jobId,
    name: meta.displayName ?? meta.jobId,
    schedule: { kind, type: kind, expr, value: expr, tz: meta.tz },
    enabled: meta.enabled !== false,
    payload: undefined,
    toolsAllow: undefined,
    toolsAllowMissing: false,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  }
}

/** Read all jobs merged with sidecar metadata.
 *
 *  Two sources are unioned: runtime cron jobs (native OpenClaw crons, surfaced
 *  read-only) and store-owned Bakin schedules (which have no runtime cron once
 *  cut over). Bakin records are NEVER auto-deleted here — a read must not mutate
 *  the schedule store; only genuinely-orphaned NON-Bakin sidecar entries (a
 *  native cron deleted out-of-band) are swept. */
export async function readMergedJobs(cron: RuntimeCronReader | undefined, defaultOwner: string): Promise<MergedJob[]> {
  // Runtime cron jobs are a read-only surfacing; a runtime WITHOUT a native
  // cron surface (Pi) or an unreachable one (no openclaw binary on PATH,
  // gateway down) must not take the whole schedule plugin with it —
  // Bakin-owned schedules keep working regardless.
  let runtimeJobs: ReturnType<typeof runtimeCronToScheduleJob>[] = []
  let runtimeAvailable = true
  try {
    runtimeJobs = cron ? (await cron.list()).map(runtimeCronToScheduleJob) : []
  } catch (err) {
    runtimeAvailable = false
    log.warn('Runtime cron unavailable — surfacing Bakin-owned schedules only', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  const runtimeIds = new Set(runtimeJobs.map(j => j.id))
  const sidecar = readSidecar()

  const merged = runtimeJobs.map(job => mergeJob(job, sidecar.jobs[job.id], defaultOwner))

  // Union store-owned Bakin schedules that have no backing runtime cron.
  for (const meta of Object.values(sidecar.jobs)) {
    if (runtimeIds.has(meta.jobId) || !meta.isBakinJob) continue
    merged.push(mergeJob(storeJobToSnapshot(meta), meta, defaultOwner))
  }

  // Sweep only NON-Bakin sidecar orphans (a native cron removed out-of-band).
  // Store-owned Bakin schedules intentionally have no runtime cron and must be
  // kept; they are deleted only through the explicit delete route. NEVER sweep
  // after a failed runtime read — every non-Bakin entry would look orphaned.
  // Same for an ABSENT cron surface (P2.1): on a cron-less runtime the native
  // sidecar metadata is dormant, not orphaned — it must survive a runtime
  // switch and be intact on switch-back.
  if (cron && runtimeAvailable) {
    let dirty = false
    for (const [jobId, meta] of Object.entries(sidecar.jobs)) {
      if (runtimeIds.has(jobId) || meta.isBakinJob) continue
      log.info('Removing stale non-Bakin sidecar entry', { jobId })
      delete sidecar.jobs[jobId]
      dirty = true
    }
    if (dirty) writeSidecar(sidecar)
  }

  return merged
}

function metadataString(metadata: RuntimeMetadata | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function metadataBoolean(metadata: RuntimeMetadata | undefined, key: string): boolean {
  return metadata?.[key] === true
}

function isBakinScheduleMetadata(metadata: RuntimeMetadata | undefined): boolean {
  return metadataBoolean(metadata, 'bakinSchedule') || metadataBoolean(metadata, 'bakin.schedule')
}

function metadataScheduleType(metadata: RuntimeMetadata | undefined): RuntimeCronJobSnapshot['schedule']['type'] {
  const value = metadataString(metadata, 'scheduleType')
  return value === 'every' || value === 'at' ? value : 'cron'
}

function normalizeToolsAllow(value: string[] | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const tools = value
    .map(tool => tool.trim())
    .filter(tool => {
      if (!tool || seen.has(tool)) return false
      seen.add(tool)
      return true
    })
  return tools.length > 0 ? tools : undefined
}
