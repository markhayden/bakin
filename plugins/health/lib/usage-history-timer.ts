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
}

export const DEFAULT_SCAN_MINUTES = 5
const MIN_SCAN_MINUTES = 1

/** Start the scan interval. Idempotent — a live timer is left untouched. */
export function startUsageHistoryTimer(runtime: AgentRuntimeAdapter, minutes: number): void {
  if (g.__bakinUsageHistoryTimer) return
  const intervalMs = Math.max(MIN_SCAN_MINUTES, minutes) * 60_000
  const run = () => {
    scanUsageHistory(runtime)
      .then((report) => {
        g.__bakinUsageHistoryLastScan = { at: Date.now(), report }
        if (report.scanned > 0 || report.failed > 0) {
          log.info('usage history scan', { ...report })
        }
      })
      .catch((err) => {
        log.warn('usage history scan failed', { err: err instanceof Error ? err.message : String(err) })
      })
  }
  g.__bakinUsageHistoryTimer = setInterval(run, intervalMs)
  g.__bakinUsageHistoryTimer.unref?.()
  log.info('usage history scan scheduled', { intervalMinutes: intervalMs / 60_000 })
}

export function stopUsageHistoryTimer(): void {
  if (g.__bakinUsageHistoryTimer) {
    clearInterval(g.__bakinUsageHistoryTimer)
    g.__bakinUsageHistoryTimer = null
  }
}

/** Completion info of the most recent sweep, or null before the first one. */
export function getLastUsageScan(): { at: number; report: UsageScanReport } | null {
  return g.__bakinUsageHistoryLastScan ?? null
}
