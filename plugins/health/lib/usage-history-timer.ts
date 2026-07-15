/**
 * Usage-history scan timer — drives src/core/usage-history's sweep on a
 * settings-configurable interval (#359).
 *
 * The first scan runs one full interval after activation, NOT at boot —
 * boot stays side-effect free and the sweep is incremental forever after
 * (stat-skip makes idle cycles ~free). Handle lives on globalThis so Bun
 * HMR / plugin hot reload can't leak a second timer; stop() is wired into
 * the plugin's onShutdown.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { createLogger } from '../../../src/core/logger'
import { scanUsageHistory, type UsageScanReport } from '../../../src/core/usage-history'

const log = createLogger('health-usage-history')

const g = globalThis as typeof globalThis & {
  __bakinUsageHistoryTimer?: ReturnType<typeof setInterval> | null
  __bakinUsageHistoryLastScan?: { at: number; report: UsageScanReport } | null
  __bakinUsageHistoryScanInFlight?: Promise<void> | null
  __bakinUsageHistoryScanIntervalMs?: number
}

export const DEFAULT_SCAN_MINUTES = 5
export const MIN_SCAN_MINUTES = 1
export const MAX_SCAN_MINUTES = 24 * 60
const SCAN_STALE_INTERVALS = 2

export function normalizeUsageHistoryScanMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SCAN_MINUTES
  return Math.min(MAX_SCAN_MINUTES, Math.max(MIN_SCAN_MINUTES, Math.round(value)))
}

/** Run one sweep and always publish its newest evidence state. */
export function runUsageHistoryScan(
  runtime: AgentRuntimeAdapter,
  scanner: typeof scanUsageHistory = scanUsageHistory,
): Promise<void> {
  if (g.__bakinUsageHistoryScanInFlight) return g.__bakinUsageHistoryScanInFlight

  const run = (async () => {
    try {
      const report = await scanner(runtime)
      g.__bakinUsageHistoryLastScan = { at: Date.now(), report }
      if (report.scanned > 0 || report.failed > 0) {
        log.info('usage history scan', { ...report })
      }
    } catch (err) {
      g.__bakinUsageHistoryLastScan = {
        at: Date.now(),
        report: {
          scanned: 0,
          skipped: 0,
          failed: 1,
          coverage: { status: 'unavailable', reason: 'scan_failed', agents: [] },
        },
      }
      log.warn('usage history scan failed', { err: err instanceof Error ? err.message : String(err) })
    }
  })()
  g.__bakinUsageHistoryScanInFlight = run
  void run.finally(() => {
    if (g.__bakinUsageHistoryScanInFlight === run) {
      g.__bakinUsageHistoryScanInFlight = null
    }
  })
  return run
}

/** Start or reschedule the scan interval. An unchanged live timer is preserved. */
export function startUsageHistoryTimer(runtime: AgentRuntimeAdapter, minutes: number): void {
  const intervalMs = normalizeUsageHistoryScanMinutes(minutes) * 60_000
  if (g.__bakinUsageHistoryTimer && g.__bakinUsageHistoryScanIntervalMs === intervalMs) return
  if (g.__bakinUsageHistoryTimer) clearInterval(g.__bakinUsageHistoryTimer)
  const run = () => { void runUsageHistoryScan(runtime) }
  g.__bakinUsageHistoryTimer = setInterval(run, intervalMs)
  g.__bakinUsageHistoryScanIntervalMs = intervalMs
  g.__bakinUsageHistoryTimer.unref?.()
  log.info('usage history scan scheduled', { intervalMinutes: intervalMs / 60_000 })
}

export function stopUsageHistoryTimer(): void {
  if (g.__bakinUsageHistoryTimer) {
    clearInterval(g.__bakinUsageHistoryTimer)
    g.__bakinUsageHistoryTimer = null
    g.__bakinUsageHistoryScanIntervalMs = undefined
  }
}

/** Completion info of the most recent sweep, or null before the first one. */
export function getLastUsageScan(): { at: number; report: UsageScanReport } | null {
  return g.__bakinUsageHistoryLastScan ?? null
}

/** Evidence becomes stale after two missed scheduled sweeps. */
export function getUsageHistoryScanStaleAfterMs(): number {
  const intervalMs = g.__bakinUsageHistoryScanIntervalMs ?? DEFAULT_SCAN_MINUTES * 60_000
  return intervalMs * SCAN_STALE_INTERVALS
}
