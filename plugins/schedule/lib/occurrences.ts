/**
 * Server-side occurrence computation — THE one engine that places jobs on
 * the calendar (PR3 of #191). Replaces the calendars' hand-rolled client-side
 * cron parsing, which was wrong for timezones, DST, and anything beyond
 * simple expressions.
 *
 * Pure and dependency-injected (clock + ledger reader) so it is fake-clock
 * testable; the route in routes/jobs.ts wires it to readMergedJobs and the
 * execution ledger.
 */
import { scheduleOccurrencesBetween } from './cron-eval'
import type { MergedJob, ScheduleDef } from '../types'

export interface OccurrenceItem {
  jobId: string
  /** Absolute instant, ISO-8601 UTC. Clients render in their local tz. */
  at: string
  /** Strictly before `now` at compute time. */
  past: boolean
  /** Ledger enrichment for past Bakin-job occurrences (absent = never claimed
   *  — e.g. the server slept through it and it fell outside catch-up). */
  disposition?: 'pending' | 'created' | 'skipped' | 'seeded'
  taskId?: string
  skipReason?: string
}

export interface OccurrenceQueryDeps {
  nowMs: number
  /** Ledger read for past Bakin occurrences (getCronFire-shaped). */
  getFire: (jobId: string, runId: string) => {
    disposition: 'pending' | 'created' | 'skipped' | 'seeded'
    taskId?: string | null
    skipReason?: string | null
  } | null
}

export interface OccurrencesResult {
  items: OccurrenceItem[]
  /** Jobs whose schedule Bakin cannot evaluate (native 'every' kinds) —
   *  reported, never silently dropped. */
  unevaluated: string[]
}

/** The Bakin-evaluable ScheduleDef of a merged job, or null. */
function evaluableDef(job: MergedJob): ScheduleDef | null {
  const type = job.schedule.type
  const expr = job.schedule.value
  if (!expr) return null
  if (type !== 'cron' && type !== 'at') return null
  return { kind: type, expr }
}

export function computeOccurrences(
  jobs: MergedJob[],
  fromMs: number,
  toMs: number,
  deps: OccurrenceQueryDeps,
): OccurrencesResult {
  const items: OccurrenceItem[] = []
  const unevaluated: string[] = []
  const from = new Date(fromMs)
  const to = new Date(toMs)

  for (const job of jobs) {
    if (!job.schedule.value) continue
    const def = evaluableDef(job)
    if (!def) {
      unevaluated.push(job.id)
      continue
    }

    const tz = job.schedule.tz ?? job.tz
    const createdMs = job.createdAt ? Date.parse(job.createdAt) : NaN
    const fireable = job.enabled && !job.paused && !job.completed

    for (const occurrence of scheduleOccurrencesBetween(def, tz, from, to)) {
      const occMs = occurrence.getTime()
      // No phantom history: a job has no occurrences from before it existed
      // (mirrors the catch-up guard in scheduler.ts).
      if (Number.isFinite(createdMs) && occMs < createdMs) continue
      const past = occMs < deps.nowMs
      // Disabled/paused/completed jobs won't fire — show what happened, not
      // a future that can't. (A completed one-shot's instant is always past.)
      if (!past && !fireable) continue

      const item: OccurrenceItem = { jobId: job.id, at: occurrence.toISOString(), past }
      if (past && job.isBakinJob) {
        // Same runId scheme the fire path claims with (makeOccurrenceRunId).
        const fire = deps.getFire(job.id, `${job.id}:${occurrence.toISOString()}`)
        if (fire) {
          item.disposition = fire.disposition
          if (fire.taskId) item.taskId = fire.taskId
          if (fire.skipReason) item.skipReason = fire.skipReason
        }
      }
      items.push(item)
    }
  }

  items.sort((a, b) => a.at.localeCompare(b.at) || a.jobId.localeCompare(b.jobId))
  return { items, unevaluated }
}
