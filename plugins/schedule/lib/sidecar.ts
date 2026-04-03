/**
 * Schedule sidecar — Bakin-owned metadata for OpenClaw cron jobs.
 * Stored at ~/.bakin/schedule/sidecar.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { createLogger } from '../../../src/core/logger'
import { getContentDir } from '../../../src/core/content-dir'
import type { ScheduleSidecar, BakinJobMeta } from '../types'

const log = createLogger('schedule:sidecar')

const DEFAULTS = {
  owner: 'main-operator',
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
    const data = JSON.parse(raw)
    if (data.version !== 1 || typeof data.jobs !== 'object') {
      log.warn('Invalid sidecar format, returning empty')
      return { version: 1, jobs: {} }
    }
    return data as ScheduleSidecar
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

/** Apply defaults to a sidecar entry for display. */
export function withDefaults(meta: BakinJobMeta): Required<Pick<BakinJobMeta, 'owner' | 'maxFailures' | 'allowOverlap' | 'requireTriage'>> & BakinJobMeta {
  return {
    ...meta,
    owner: meta.owner ?? DEFAULTS.owner,
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
      // Auto-resume: clear pause state
      meta.paused = false
      meta.pauseUntil = undefined
      meta.pauseReason = undefined
      return { paused: false }
    }
  }

  return { paused: true, reason: meta.pauseReason ?? 'manual' }
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
