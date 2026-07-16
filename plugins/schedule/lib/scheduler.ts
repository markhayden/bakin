/**
 * The Bakin-owned scheduler engine.
 *
 * Steady-state firing: every tick, for each enabled Bakin schedule, compute the
 * occurrences that fell inside the just-elapsed window and fire any that haven't
 * been claimed yet. Exactly-once is the execution ledger's job — the per-
 * occurrence runId is the dedup key, so a re-tick (or a second server) claiming
 * the same occurrence is a no-op.
 *
 * This module is dependency-injected (clock, job list, ledger ops, fire
 * callback) so it is unit-testable with a fake clock and carries no `pluginCtx`
 * or filesystem coupling. Production wiring lives in the plugin entry (T4).
 * Catch-up of fires missed during downtime is handled separately (T6).
 */
import { scheduleOccurrencesBetween, schedulePrevRun } from './cron-eval'
import type { BakinJobMeta } from '../types'

/** Default window scanned each tick. Must exceed the tick interval so no
 *  occurrence slips between ticks; modest overlap is harmless (ledger dedups). */
export const DEFAULT_TICK_WINDOW_MS = 90_000

export interface SchedulerDeps {
  /** Current epoch ms. Injected so tests can use a fake clock. */
  now: () => number
  /** Window scanned each tick, in ms. Defaults to DEFAULT_TICK_WINDOW_MS. */
  tickWindowMs?: number
  /** All Bakin schedule jobs to consider (the engine filters enabled + has-schedule). */
  listJobs: () => BakinJobMeta[]
  /** Cheap pre-filter: has this (job, run) already been recorded? */
  getCronFire: (jobId: string, runId: string) => unknown | null
  /** Authoritative claim. The (job_id, run_id) PK makes a duplicate fail. */
  claimCronFire: (jobId: string, runId: string, firedAt: number) => { claimed: boolean }
  /** Post-claim fire (pause/skip/overlap checks + task creation). `blocked`
   *  materializes the task into the blocked column (stale catch-up). */
  fire: (meta: BakinJobMeta, jobId: string, runId: string, occurrence: Date, opts?: { blocked?: boolean }) => Promise<void>
  log?: { warn: (msg: string, data?: unknown) => void }
}

/** Deterministic, per-occurrence run id — the ledger dedup key. */
export function makeOccurrenceRunId(jobId: string, occurrence: Date): string {
  return `${jobId}:${occurrence.toISOString()}`
}

/** A schedule fires only when enabled (default true) and it has a definition. */
function isFireable(meta: BakinJobMeta): boolean {
  return meta.enabled !== false && !!meta.schedule?.expr
}

/**
 * Run one scheduler tick: fire every unclaimed occurrence that fell inside the
 * window `(now - tickWindow, now]`. Safe to call repeatedly; never throws for a
 * single bad job (it is logged and skipped).
 */
export async function runSchedulerTick(deps: SchedulerDeps): Promise<void> {
  const nowMs = deps.now()
  const windowMs = deps.tickWindowMs ?? DEFAULT_TICK_WINDOW_MS
  const from = new Date(nowMs - windowMs)
  const to = new Date(nowMs)

  for (const meta of deps.listJobs()) {
    if (!isFireable(meta)) continue
    const occurrences = scheduleOccurrencesBetween(meta.schedule!, meta.tz, from, to)
    for (const occurrence of occurrences) {
      const runId = makeOccurrenceRunId(meta.jobId, occurrence)
      // Cheap pre-filter — the claim below is the authoritative dedup.
      if (deps.getCronFire(meta.jobId, runId)) continue
      const claim = deps.claimCronFire(meta.jobId, runId, occurrence.getTime())
      if (!claim.claimed) continue
      try {
        await deps.fire(meta, meta.jobId, runId, occurrence)
      } catch (err) {
        deps.log?.warn('Scheduler fire failed', {
          jobId: meta.jobId,
          runId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
}

/**
 * Startup catch-up for fires missed while the server was down. For each
 * fireable job, take the SINGLE most-recent occurrence that should already
 * have fired (coalescing any older misses away — no stale bursts). If it
 * hasn't been claimed, fire it: into `todo` when it's within `catchUpWindowMs`
 * of now, or into `blocked` (for the user to triage) when it's older. The
 * occurrence runId keeps this exactly-once and deduped against the steady tick.
 */
export async function runStartupCatchUp(deps: SchedulerDeps, catchUpWindowMs: number): Promise<void> {
  const nowMs = deps.now()
  for (const meta of deps.listJobs()) {
    if (!isFireable(meta)) continue
    const occurrence = schedulePrevRun(meta.schedule!, meta.tz, new Date(nowMs))
    if (!occurrence) continue
    // Don't fire an occurrence that predates the schedule's creation — a newly
    // created job has no "missed" runs from before it existed.
    const createdMs = Date.parse(meta.createdAt)
    if (Number.isFinite(createdMs) && occurrence.getTime() < createdMs) continue
    const runId = makeOccurrenceRunId(meta.jobId, occurrence)
    if (deps.getCronFire(meta.jobId, runId)) continue
    const claim = deps.claimCronFire(meta.jobId, runId, occurrence.getTime())
    if (!claim.claimed) continue
    const blocked = nowMs - occurrence.getTime() > catchUpWindowMs
    try {
      await deps.fire(meta, meta.jobId, runId, occurrence, { blocked })
    } catch (err) {
      deps.log?.warn('Catch-up fire failed', {
        jobId: meta.jobId,
        runId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
