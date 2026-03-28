/**
 * Reads OpenClaw cron jobs and merges with Beacon sidecar metadata.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../../../src/core/logger'
import { readSidecar, withDefaults } from './sidecar'
import { cronToHuman } from './cron-parser'
import type { OpenClawJob, OpenClawJobsFile, MergedJob, BeaconJobMeta } from '../types'

const log = createLogger('schedule:jobs')

const OPENCLAW_JOBS_PATH = join(
  process.env.HOME || '~',
  '.openclaw',
  'cron',
  'jobs.json'
)

/** Read raw OpenClaw jobs from disk. */
export function readOpenClawJobs(jobsPath?: string): OpenClawJob[] {
  const path = jobsPath ?? OPENCLAW_JOBS_PATH
  if (!existsSync(path)) {
    log.debug('OpenClaw jobs.json not found', { path })
    return []
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const data = JSON.parse(raw) as OpenClawJobsFile
    return data.jobs ?? []
  } catch (err) {
    log.warn('Failed to read OpenClaw jobs', err)
    return []
  }
}

/** Extract best-effort context from an orphaned OpenClaw job's payload. */
function extractOrphanContext(job: OpenClawJob): { prompt?: string } {
  if (!job.payload) return {}
  // OpenClaw stores the message in payload.message
  const msg = job.payload.message
  if (typeof msg === 'string' && msg.length > 0) {
    // If it starts with beacon:schedule:, it's a Beacon job that lost its sidecar
    // Otherwise surface the raw message as prompt context
    const beaconPrefix = 'beacon:schedule:'
    if (msg.startsWith(beaconPrefix)) {
      return { prompt: msg.slice(beaconPrefix.length) }
    }
    return { prompt: msg }
  }
  return {}
}

/** Merge a single OpenClaw job with its sidecar entry (if any). */
export function mergeJob(job: OpenClawJob, sidecar: BeaconJobMeta | undefined): MergedJob {
  const meta = sidecar ? withDefaults(sidecar) : null

  // Normalise OpenClaw field names: kind→type, expr→value
  const schedType = job.schedule.type ?? job.schedule.kind ?? 'cron'
  const schedValue = job.schedule.value ?? job.schedule.expr ?? ''
  const normalised = { type: schedType, value: schedValue, tz: job.schedule.tz }

  // For orphaned jobs (no sidecar), extract what we can from the payload
  const orphanContext = !meta ? extractOrphanContext(job) : {}

  return {
    // OpenClaw fields (normalised)
    id: job.id,
    name: job.name,
    schedule: normalised,
    enabled: job.enabled,
    delivery: job.delivery,

    // Beacon sidecar (with defaults)
    isBeaconJob: meta?.isBeaconJob ?? false,
    displayName: meta?.displayName ?? job.name,
    description: meta?.description,
    agentId: meta?.agentId,  // null for orphans — don't guess, flag for triage
    owner: meta?.owner ?? 'roscoe',
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
export function readMergedJobs(jobsPath?: string): MergedJob[] {
  const openclawJobs = readOpenClawJobs(jobsPath)
  const sidecar = readSidecar()

  const merged = openclawJobs.map(job => mergeJob(job, sidecar.jobs[job.id]))

  // Clean up stale sidecar entries (jobs deleted from OpenClaw)
  const activeIds = new Set(openclawJobs.map(j => j.id))
  let dirty = false
  for (const jobId of Object.keys(sidecar.jobs)) {
    if (!activeIds.has(jobId)) {
      log.info('Removing stale sidecar entry', { jobId })
      delete sidecar.jobs[jobId]
      dirty = true
    }
  }
  if (dirty) {
    // Lazy import to avoid circular — writeSidecar is simple enough
    const { writeSidecar } = require('./sidecar')
    writeSidecar(sidecar)
  }

  return merged
}
