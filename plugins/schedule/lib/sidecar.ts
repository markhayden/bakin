/**
 * Schedule sidecar - Bakin-owned metadata for runtime cron jobs.
 * Stored at ~/.bakin/schedule/sidecar.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { createLogger } from '../../../src/core/logger'
import { getContentDir } from '../../../src/core/content-dir'
import type { ScheduleSidecar, BakinJobMeta } from '../types'

const log = createLogger('schedule:sidecar')

/** Mint a Bakin-owned schedule id (no longer derived from the runtime cron id). */
export function newScheduleId(): string {
  return `sch_${randomUUID()}`
}

// Validated on read. The envelope is strict (a bad version/shape means an
// unreadable file → empty, never a half-parsed store); individual jobs are
// validated leniently and a single malformed entry is dropped rather than
// nuking every other valid schedule.
const scheduleDefSchema = z.object({
  kind: z.enum(['cron', 'at']),
  expr: z.string(),
})

const bakinJobMetaSchema = z
  .object({
    jobId: z.string(),
    isBakinJob: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    schedule: scheduleDefSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .passthrough()

const sidecarEnvelopeSchema = z.object({
  version: z.literal(1),
  jobs: z.record(z.string(), z.unknown()),
})

const DEFAULTS = {
  maxFailures: 3,
  allowOverlap: false,
  requireTriage: false,
} as const

function getSidecarPath(): string {
  return `${getContentDir()}/schedule/sidecar.json`
}

export function readSidecar(): ScheduleSidecar {
  const path = getSidecarPath()
  if (!existsSync(path)) {
    return { version: 1, jobs: {} }
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const envelope = sidecarEnvelopeSchema.safeParse(JSON.parse(raw))
    if (!envelope.success) {
      log.warn('Invalid sidecar format, returning empty')
      return { version: 1, jobs: {} }
    }
    const jobs: Record<string, BakinJobMeta> = {}
    for (const [id, rawJob] of Object.entries(envelope.data.jobs)) {
      const parsed = bakinJobMetaSchema.safeParse(rawJob)
      if (parsed.success) {
        jobs[id] = parsed.data as unknown as BakinJobMeta
      } else {
        log.warn('Skipping structurally-invalid schedule job', { jobId: id })
      }
    }
    return { version: 1, jobs }
  } catch (err) {
    log.warn('Failed to read sidecar', err)
    return { version: 1, jobs: {} }
  }
}

export function writeSidecar(sidecar: ScheduleSidecar): void {
  const path = getSidecarPath()
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(path, JSON.stringify(sidecar, null, 2), 'utf-8')
}

export function getJob(jobId: string): BakinJobMeta | null {
  const sidecar = readSidecar()
  return sidecar.jobs[jobId] ?? null
}

export function upsertJob(meta: BakinJobMeta): void {
  const sidecar = readSidecar()
  sidecar.jobs[meta.jobId] = { ...meta, updatedAt: new Date().toISOString() }
  writeSidecar(sidecar)
}

export function removeJob(jobId: string): boolean {
  const sidecar = readSidecar()
  if (!sidecar.jobs[jobId]) return false
  delete sidecar.jobs[jobId]
  writeSidecar(sidecar)
  return true
}

// Run-level dedup lives in the execution ledger (cron_fires table) — the
// legacy processedRunIds sidecar machinery was a TOCTOU race (state persisted
// AFTER slow task creation) and is seeded into the ledger once on upgrade by
// seedCronFireLedgerFromSidecar() in the plugin entry.

/** Apply defaults to a sidecar entry for display. */
export function withDefaults(
  meta: BakinJobMeta,
  defaultOwner: string,
): Required<Pick<BakinJobMeta, 'owner' | 'maxFailures' | 'allowOverlap' | 'requireTriage'>> & BakinJobMeta {
  return {
    ...meta,
    owner: meta.owner ?? defaultOwner,
    maxFailures: meta.maxFailures ?? DEFAULTS.maxFailures,
    allowOverlap: meta.allowOverlap ?? DEFAULTS.allowOverlap,
    requireTriage: meta.requireTriage ?? DEFAULTS.requireTriage,
    consecutiveFailures: meta.consecutiveFailures ?? 0,
    skippedCount: meta.skippedCount ?? 0,
  }
}

/** Check if a job is currently paused (including auto-resume logic). */
export function isPaused(meta: BakinJobMeta): { paused: boolean; reason?: string } {
  if (!meta.paused) return { paused: false }

  // Check pauseUntil auto-resume
  if (meta.pauseUntil) {
    const until = new Date(meta.pauseUntil)
    if (until <= new Date()) {
      // Auto-resume: clear pause state AND re-enable. Pause sets enabled=false
      // (so the scheduler's enabled-gate cheaply skips paused jobs); resume must
      // restore it or the job stays dormant forever.
      meta.paused = false
      meta.pauseUntil = undefined
      meta.pauseReason = undefined
      meta.enabled = true
      return { paused: false }
    }
  }

  return { paused: true, reason: meta.pauseReason ?? 'manual' }
}

/**
 * Auto-resume any job whose timed pause (`pauseUntil`) has elapsed: clears the
 * pause and re-enables it so the scheduler's enabled-gate lets it fire again.
 * Run before the scheduler tick / startup catch-up — the enabled-gate means a
 * dormant paused job otherwise never reaches the runClaimedFire auto-resume.
 * Returns the number of jobs resumed.
 */
export function resumeDuePauses(now: number = Date.now()): number {
  const sidecar = readSidecar()
  let resumed = 0
  for (const meta of Object.values(sidecar.jobs)) {
    if (meta.paused && meta.pauseUntil && Date.parse(meta.pauseUntil) <= now) {
      meta.paused = false
      meta.pauseUntil = undefined
      meta.pauseReason = undefined
      meta.enabled = true
      resumed += 1
    }
  }
  if (resumed > 0) writeSidecar(sidecar)
  return resumed
}

/** Check and handle skip-next-N logic. Returns true if this run should be skipped. */
export function shouldSkip(meta: BakinJobMeta): boolean {
  if (!meta.skipNextN || meta.skipNextN <= 0) return false
  const skipped = meta.skippedCount ?? 0
  if (skipped < meta.skipNextN) {
    meta.skippedCount = skipped + 1
    return true
  }
  // Reached threshold — clear skip state
  meta.skipNextN = undefined
  meta.skippedCount = undefined
  return false
}

/** Increment failure counter and auto-pause if threshold reached. */
export function recordFailure(meta: BakinJobMeta): boolean {
  const max = meta.maxFailures ?? DEFAULTS.maxFailures
  meta.consecutiveFailures = (meta.consecutiveFailures ?? 0) + 1
  if (meta.consecutiveFailures >= max) {
    meta.paused = true
    meta.pauseReason = 'auto-failures'
    meta.enabled = false // mirror manual pause: skip at the scheduler gate, no claim churn
    log.warn('Auto-paused schedule after consecutive failures', {
      jobId: meta.jobId,
      failures: meta.consecutiveFailures,
      max,
    })
    return true // was auto-paused
  }
  return false
}

/** Reset failure counter on successful task completion. */
export function recordSuccess(meta: BakinJobMeta): void {
  meta.consecutiveFailures = 0
}
