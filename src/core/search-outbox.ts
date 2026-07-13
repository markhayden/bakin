/**
 * App facade over the durable search outbox (packages/core/src/search/outbox)
 * plus the process-wide drain pump (spec D5, plan F2).
 *
 * Every ctx.search write is: durable enqueue → nudge the pump. Engine up →
 * the write lands before the caller's promise resolves (single-flight drain
 * chain). Engine down → the row waits; the safety tick retries with backoff
 * until the engine returns. Boot's only job is starting the pump.
 */
import {
  drainOnce,
  outboxStats,
  retryQuarantined,
  listQuarantined,
  enqueueIndex,
  enqueueRemove,
  enqueueTransform,
  applyTransformOps,
  type DrainReport,
  type OutboxDrainTarget,
} from '@bakin/core/search/outbox'
import { createLogger } from './logger'
import { recordUsage } from './usage'

export {
  enqueueIndex,
  enqueueRemove,
  enqueueTransform,
  applyTransformOps,
  outboxStats,
  retryQuarantined,
  listQuarantined,
}
export type { DrainReport, OutboxDrainTarget }

const log = createLogger('search-outbox-pump')

const SAFETY_TICK_MS = 30_000
const DOWN_BACKOFF_MS = [5_000, 10_000, 30_000]

interface PumpState {
  target: OutboxDrainTarget | null
  chain: Promise<DrainReport | null>
  timer: ReturnType<typeof setInterval> | null
  consecutiveDownCycles: number
  nextAttemptAt: number
}

// globalThis so Bun HMR / module re-eval reuses one pump (same reason as
// __bakinBroadcast in sse.ts).
const g = globalThis as { __bakinSearchOutboxPump?: PumpState }
if (!g.__bakinSearchOutboxPump) {
  g.__bakinSearchOutboxPump = { target: null, chain: Promise.resolve(null), timer: null, consecutiveDownCycles: 0, nextAttemptAt: 0 }
}
const pump: PumpState = g.__bakinSearchOutboxPump

/** Wire the pump to the live adapter + logical→physical resolver. */
export function configureOutboxPump(target: OutboxDrainTarget): void {
  pump.target = target
}

/**
 * Single-flight drain: concurrent nudges share one cycle. Never rejects —
 * a failed cycle logs and leaves rows queued (that is the design).
 */
export function nudgeOutboxPump(): Promise<DrainReport | null> {
  const target = pump.target
  if (!target) return Promise.resolve(null)
  if (Date.now() < pump.nextAttemptAt) return Promise.resolve(null)
  const cycle = pump.chain.then(async () => {
    try {
      const startedAt = Date.now()
      const report = await drainOnce(target)
      if (report.processed > 0 || report.failedTransient > 0 || report.failedPermanent > 0) {
        recordUsage({
          kind: 'rest',
          activityClass: 'system',
          name: 'search.drain',
          agent: null,
          durationMs: Date.now() - startedAt,
          status: report.failedPermanent > 0 ? 'error' : 'ok',
          meta: { processed: report.processed, failedTransient: report.failedTransient, failedPermanent: report.failedPermanent },
        })
      }
      if (report.failedTransient > 0 && report.processed === 0) {
        pump.consecutiveDownCycles += 1
        const backoff = DOWN_BACKOFF_MS[Math.min(pump.consecutiveDownCycles, DOWN_BACKOFF_MS.length) - 1]
        pump.nextAttemptAt = Date.now() + backoff
      } else {
        pump.consecutiveDownCycles = 0
        pump.nextAttemptAt = 0
      }
      return report
    } catch (err) {
      log.warn('outbox drain cycle failed', { err: err instanceof Error ? err.message : String(err) })
      return null
    }
  })
  pump.chain = cycle
  return cycle
}

/** Start the safety tick (boot). Resumes whatever the journal holds. */
export function startOutboxPump(target: OutboxDrainTarget): void {
  configureOutboxPump(target)
  if (pump.timer) return
  pump.timer = setInterval(() => {
    // The tick ignores the down-backoff gate deliberately being the retry path.
    pump.nextAttemptAt = 0
    void nudgeOutboxPump()
  }, SAFETY_TICK_MS)
  pump.timer.unref?.()
  void nudgeOutboxPump()
  log.info('search outbox pump started', { pending: outboxStats().pending })
}

export function stopOutboxPump(): void {
  if (pump.timer) clearInterval(pump.timer)
  pump.timer = null
  pump.target = null
}
