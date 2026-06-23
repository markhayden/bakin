/**
 * Schedule loop — production wiring of the DI'd engine in lib/scheduler.ts.
 *
 * Owns the `schedulerTimer` module cell (so start/stop and the timer live in
 * exactly one place), the settings-derived tick/catch-up accessors, the
 * SchedulerDeps factory bound to the live ledger + fire engine, and the
 * idempotent OpenClaw→Bakin cutover. The self-rescheduling cycle
 * (resume-pauses → tick → heal) re-reads the tick interval each pass so a
 * settings change takes effect without a restart.
 */
import { runSchedulerTick, DEFAULT_TICK_WINDOW_MS, type SchedulerDeps } from './scheduler'
import { getPluginCtx } from './plugin-context'
import { runClaimedFire, healPendingCronClaims, MISSED_WINDOW_REASON } from './fire-engine'
import { readSidecar, resumeDuePauses } from './sidecar'
import { getCronFire, claimCronFire } from '../../../src/core/execution-ledger'
import { migrateBakinSchedulesOffOpenClawCron } from './cutover'
import { getSystemTimezone } from './schedule-util'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('schedule')

/** Schedule plugin settings. */
export interface ScheduleSettings {
  /** Scheduler tick cadence in seconds (floor-clamped). Default 30. */
  tickIntervalSeconds?: number
  /** Catch-up safety window in minutes: a missed occurrence fires into `todo`
   *  if within this window of now, else lands in `blocked`. Default 60. */
  catchUpWindowMinutes?: number
}

const DEFAULT_TICK_INTERVAL_SECONDS = 30
const MIN_TICK_INTERVAL_SECONDS = 5
const DEFAULT_CATCH_UP_WINDOW_MINUTES = 60

/** Resolved tick interval in ms, clamped to a safe floor. */
function tickIntervalMs(): number {
  const raw = getPluginCtx()?.getSettings<ScheduleSettings>()?.tickIntervalSeconds
  const seconds = typeof raw === 'number' && raw >= MIN_TICK_INTERVAL_SECONDS ? raw : DEFAULT_TICK_INTERVAL_SECONDS
  return seconds * 1000
}

/** Resolved catch-up safety window in ms. A missed occurrence fires into `todo`
 *  if within this window, else into `blocked` for the user to triage. */
export function catchUpWindowMs(): number {
  const raw = getPluginCtx()?.getSettings<ScheduleSettings>()?.catchUpWindowMinutes
  const minutes = typeof raw === 'number' && raw >= 0 ? raw : DEFAULT_CATCH_UP_WINDOW_MINUTES
  return minutes * 60_000
}

let schedulerTimer: ReturnType<typeof setTimeout> | null = null

export function schedulerDeps(): SchedulerDeps {
  return {
    now: () => Date.now(),
    // Window must exceed the tick interval so no occurrence slips between ticks.
    tickWindowMs: Math.max(DEFAULT_TICK_WINDOW_MS, tickIntervalMs() * 2),
    listJobs: () => Object.values(readSidecar().jobs).filter(job => job.isBakinJob),
    getCronFire: (jobId, runId) => getCronFire(jobId, runId),
    claimCronFire: (jobId, runId, firedAt) => claimCronFire(jobId, runId, firedAt),
    fire: async (meta, jobId, runId, occurrence, opts) => {
      await runClaimedFire(
        meta, jobId, runId,
        opts?.blocked
          ? { column: 'blocked', blockedReason: MISSED_WINDOW_REASON, firedAtMs: occurrence.getTime() }
          : { firedAtMs: occurrence.getTime() },
      )
    },
    log,
  }
}

/** Run the idempotent cutover using the live runtime adapter. Shared by
 *  activate() (automatic) and the doctor repair (manual). */
export function runScheduleCutover(): ReturnType<typeof migrateBakinSchedulesOffOpenClawCron> {
  const cron = getPluginCtx()!.runtime.cron
  return migrateBakinSchedulesOffOpenClawCron({
    cronGet: async (jobId) => {
      const job = await cron.get(jobId)
      return job ? { schedule: job.schedule, enabled: job.enabled, metadata: job.metadata } : null
    },
    cronRemove: (jobId) => cron.remove(jobId),
    systemTz: getSystemTimezone,
  })
}

export function startScheduler(): void {
  stopScheduler()
  // Self-rescheduling loop (not setInterval) so each cycle re-reads the tick
  // interval — a settings change takes effect without a restart, and the next
  // cycle is only armed after the previous finishes (no overlap). Each cycle:
  // resume expired timed-pauses → fire due occurrences → heal stranded claims.
  const cycle = () => {
    Promise.resolve()
      .then(() => { resumeDuePauses() })
      .then(() => runSchedulerTick(schedulerDeps()))
      .then(() => healPendingCronClaims())
      .catch(err => log.warn('Scheduler cycle failed', err))
      .finally(() => {
        schedulerTimer = setTimeout(cycle, tickIntervalMs())
        schedulerTimer.unref?.()
      })
  }
  schedulerTimer = setTimeout(cycle, tickIntervalMs())
  schedulerTimer.unref?.()
}

export function stopScheduler(): void {
  if (!schedulerTimer) return
  clearTimeout(schedulerTimer)
  schedulerTimer = null
}
