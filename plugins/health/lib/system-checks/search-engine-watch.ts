/**
 * System checks — search canary + engine-burn watchdog.
 *
 * Both exist because of the 2026-07-12 incident: a wedged engine answered
 * health probes for 17 hours while every real query starved under the
 * budget and returned nothing — and the doctor said "ok" the whole time,
 * because nothing actually RAN a search or looked at the engine process.
 *
 *  - search-canary runs one real cross-table query through the exact
 *    production path (crossTableSearch: budgets, semantic legs, omission
 *    labels). All tables omitted on two consecutive doctor runs = search
 *    is dark regardless of cause → error + engine-restart repair.
 *  - search-engine-burn reads the adapter's engineStatus() (pid CPU rate +
 *    wedge signatures from the engine log). A wedge signature on two
 *    consecutive runs = the known zero-progress spin → error + restart
 *    repair. Sustained high CPU alone only warns — legitimate backfills
 *    burn CPU for hours and a restart would make those WORSE.
 *
 * Same shape as search-spin: module-level samples the doctor's own cadence
 * advances, pure detection helpers, no timers, nothing at boot.
 */
import { healthOk, healthWarn } from '@makinbakin/sdk/utils'
import type { HealthCheckResult, HealthRepairHandler } from '../../../../packages/core/src/plugin-types'

/** Sustained CPU (fraction of one core) that earns a busy warning. */
const BUSY_UTILIZATION = 0.9

export type CanaryVerdict = 'ok' | 'partial' | 'dark'

/** Pure: classify one canary response's per-table outcomes. */
export function classifyCanary(tables: Array<{ budget?: 'degraded' | 'omitted' }>): CanaryVerdict {
  if (tables.length === 0) return 'ok'
  if (tables.every((t) => t.budget === 'omitted')) return 'dark'
  return tables.some((t) => t.budget !== undefined) ? 'partial' : 'ok'
}

// Doctor-cadence state (module-level, like search-spin's sample).
let darkStreak = 0
let wedgeStreak = 0
let busyStreak = 0

/** Test-only. */
export function resetEngineWatchStateForTests(): void {
  darkStreak = 0
  wedgeStreak = 0
  busyStreak = 0
}

export async function checkSearchCanary(): Promise<HealthCheckResult[]> {
  const { getSettings } = await import('../../../../src/core/settings')
  if (!getSettings().search.settings.enabled) return []

  const { getAppServices } = await import('../../../../src/core/app-services')
  const search = getAppServices().search
  if (!await search.available()) return [] // the base search check owns "engine down"

  const { crossTableSearch } = await import('../../../../src/core/search-query')
  const response = await crossTableSearch('doctor canary probe', { limit: 1 })
  if (response.meta.source === 'unavailable') return [] // raced an outage — base check owns it

  const tables = response.meta.tables ?? []
  const verdict = classifyCanary(tables)
  darkStreak = verdict === 'dark' ? darkStreak + 1 : 0

  if (verdict === 'dark' && darkStreak >= 2) {
    return [{
      check: 'search-canary',
      status: 'error',
      message: `Search is DARK: a real query got zero contribution from all ${tables.length} tables (every source omitted under the ${response.meta.took_ms}ms query budget) on ${darkStreak} consecutive doctor runs — the engine answers health probes but cannot serve queries. Repair restarts the engine service; the write journal is durable, nothing is lost.`,
      autoFixable: true,
    }]
  }
  if (verdict === 'dark') {
    return [healthWarn('search-canary', `Canary query: every table omitted under the query budget — engine busy or wedged; escalates to an error (with restart repair) if the next doctor run agrees`)]
  }
  if (verdict === 'partial') {
    const omitted = tables.filter((t) => t.budget === 'omitted').length
    const degraded = tables.filter((t) => t.budget === 'degraded').length
    return [healthWarn('search-canary', `Canary query degraded: ${omitted} of ${tables.length} table(s) omitted, ${degraded} keyword-only (semantic lane dropped) — honest degrade under load; investigate with \`bakin search:stats\` if it persists`)]
  }
  return [healthOk('search-canary', `Canary query answered from all ${tables.length} tables in ${response.meta.took_ms}ms`)]
}

export async function checkSearchEngineBurn(): Promise<HealthCheckResult[]> {
  const { getSettings } = await import('../../../../src/core/settings')
  if (!getSettings().search.settings.enabled) return []

  const { getAppServices } = await import('../../../../src/core/app-services')
  const search = getAppServices().search
  if (!search.engineStatus) return [] // adapter can't measure — feature-detect, never assume
  const status = await search.engineStatus()
  if (status === null) return [] // current mode can't measure (e.g. externally managed guest)
  if (!status.running) return [] // the base search check owns "engine down"

  wedgeStreak = status.wedgeSignals.length > 0 ? wedgeStreak + 1 : 0
  busyStreak = (status.cpuUtilization ?? 0) >= BUSY_UTILIZATION ? busyStreak + 1 : 0

  if (wedgeStreak >= 2) {
    return [{
      check: 'search-engine-burn',
      status: 'error',
      message: `Search engine is WEDGED: zero-progress signature(s) [${status.wedgeSignals.join(', ')}] recurring in the engine log across ${wedgeStreak} consecutive doctor runs (pid ${status.pid}, ~${Math.round((status.cpuUtilization ?? 0) * 100)}% CPU). This burned a dev box for 17h once — repair restarts the engine service.`,
      autoFixable: true,
    }]
  }
  if (status.wedgeSignals.length > 0) {
    return [healthWarn('search-engine-burn', `Engine wedge signature(s) [${status.wedgeSignals.join(', ')}] observed — may be legitimate post-crash catch-up; escalates to an error (with restart repair) if the next doctor run agrees`)]
  }
  if (busyStreak >= 2) {
    return [healthWarn('search-engine-burn', `Engine sustained ~${Math.round((status.cpuUtilization ?? 0) * 100)}% CPU across ${busyStreak} consecutive doctor runs with no wedge signature — normal during backfills/enrichment; check \`bakin search:stats\` backlog if search feels slow`)]
  }
  return [healthOk('search-engine-burn', status.cpuUtilization === null
    ? 'Engine running (first CPU sample — rate available next run)'
    : `Engine healthy (~${Math.round(status.cpuUtilization * 100)}% CPU, no wedge signatures)`)]
}

/**
 * Shared repair: gracefully restart the supervised engine, then wait for
 * it to answer again. Non-destructive — the outbox is durable and queries
 * degrade honestly during the bounce (D11).
 */
function engineRestartRepair(checkId: 'search-canary' | 'search-engine-burn', title: string): HealthRepairHandler {
  return {
    async plan(rows) {
      const matching = rows.filter((row) => row.check === checkId && row.autoFixable)
      if (matching.length === 0) return []
      return [{
        id: `health.repair-${checkId}`,
        checkId,
        title,
        reason: matching.map((row) => row.message).join('; '),
        safety: 'safe',
        requiresConfirmation: true,
        changes: [{
          kind: 'other',
          target: 'search engine service',
          action: 'update',
          description: 'Gracefully restart the OS-supervised engine (SIGTERM, supervisor respawns). Writes wait in the durable journal; queries degrade honestly during the bounce.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const { getAppServices } = await import('../../../../src/core/app-services')
      const search = getAppServices().search
      const fail = (message: string) => [{
        id: `health.repair-${checkId}`,
        checkId,
        status: 'failed' as const,
        message,
        changes: [],
      }]
      if (!search.restartEngine) return fail('Adapter does not support engine restart — restart the engine where it runs')
      try {
        await search.restartEngine()
      } catch (err) {
        return fail(`Engine restart failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      // Wait for the engine to answer again (supervisor respawn + warmup).
      const deadline = Date.now() + 30_000
      let up = false
      while (Date.now() < deadline) {
        if (await search.available()) { up = true; break }
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
      resetEngineWatchStateForTests()
      return [{
        id: `health.repair-${checkId}`,
        checkId,
        status: up ? 'applied' as const : 'failed' as const,
        message: up
          ? 'Engine restarted and answering; the journal drains automatically'
          : 'Engine restarted but not answering within 30s — check `bakin check search` and the engine log',
        changes: [],
      }]
    },
  }
}

export function searchCanaryRepair(): HealthRepairHandler {
  return engineRestartRepair('search-canary', 'Restart the search engine service (search is dark)')
}

export function searchEngineBurnRepair(): HealthRepairHandler {
  return engineRestartRepair('search-engine-burn', 'Restart the search engine service (zero-progress wedge)')
}
