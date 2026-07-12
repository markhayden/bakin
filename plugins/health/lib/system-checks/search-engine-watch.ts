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
 * Escalation streaks are PERSISTED (plugin-data/health/engine-watch.json)
 * so a server restart doesn't silently re-arm the two-run escalation on a
 * restart-heavy dev box, and any run that cannot produce a verdict
 * (disabled / engine down / unmeasurable) RESETS its streak — "two
 * consecutive runs" means consecutive observations, never two samples
 * straddling an outage (a respawned engine's legitimate catch-up must not
 * inherit a pre-crash streak). No timers, nothing at boot.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { healthOk, healthWarn } from '@makinbakin/sdk/utils'
import type { HealthCheckResult, HealthRepairHandler } from '../../../../packages/core/src/plugin-types'

/** Sustained CPU (fraction of one core) that earns a busy warning. */
const BUSY_UTILIZATION = 0.9
/**
 * One engine bounce serves every correlated detection: a wedged engine
 * errors BOTH checks, and a `--fix --yes` run applies both repair plans
 * sequentially — the second apply inside this window reports applied
 * without bouncing the just-restarted engine again.
 */
const RESTART_DEBOUNCE_MS = 2 * 60 * 1000

export type CanaryVerdict = 'ok' | 'partial' | 'dark'

/** Pure: classify one canary response's per-table outcomes. */
export function classifyCanary(tables: Array<{ budget?: 'degraded' | 'omitted' }>): CanaryVerdict {
  if (tables.length === 0) return 'ok'
  if (tables.every((t) => t.budget === 'omitted')) return 'dark'
  return tables.some((t) => t.budget !== undefined) ? 'partial' : 'ok'
}

// ── Persisted streak state ─────────────────────────────────────────────────

interface StreakState {
  darkStreak: number
  wedgeStreak: number
  busyStreak: number
}

const ZERO_STREAKS: StreakState = { darkStreak: 0, wedgeStreak: 0, busyStreak: 0 }

async function statePath(): Promise<string> {
  const { getContentDir } = await import('../../../../src/core/content-dir')
  return join(getContentDir(), 'plugin-data', 'health', 'engine-watch.json')
}

async function loadStreaks(): Promise<StreakState> {
  try {
    const raw = JSON.parse(readFileSync(await statePath(), 'utf-8')) as Partial<StreakState>
    return {
      darkStreak: typeof raw.darkStreak === 'number' ? raw.darkStreak : 0,
      wedgeStreak: typeof raw.wedgeStreak === 'number' ? raw.wedgeStreak : 0,
      busyStreak: typeof raw.busyStreak === 'number' ? raw.busyStreak : 0,
    }
  } catch {
    return { ...ZERO_STREAKS } // fresh install / first run
  }
}

async function saveStreaks(next: Partial<StreakState>): Promise<StreakState> {
  const merged = { ...(await loadStreaks()), ...next }
  const path = await statePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(merged))
  return merged
}

/**
 * Post-restart reset: a bounced engine makes every pre-restart streak moot
 * (both checks observe the same engine), so ALL streaks clear together.
 */
async function resetStreaks(): Promise<void> {
  await saveStreaks({ ...ZERO_STREAKS })
}

// In-memory restart debounce — both repair applies run in one process.
let lastEngineRestartAt = 0

/** Test-only alias — the production reset is resetStreaks(). */
export async function resetEngineWatchStateForTests(): Promise<void> {
  await resetStreaks()
  lastEngineRestartAt = 0
}

// ── Checks ─────────────────────────────────────────────────────────────────

export async function checkSearchCanary(): Promise<HealthCheckResult[]> {
  const { getSettings } = await import('../../../../src/core/settings')
  if (!getSettings().search.settings.enabled) {
    await saveStreaks({ darkStreak: 0 })
    return []
  }

  const { getAppServices } = await import('../../../../src/core/app-services')
  const search = getAppServices().search
  if (!await search.available()) {
    // The base search check owns "engine down" — and a down engine breaks
    // the observation chain, so the streak must not survive the gap.
    await saveStreaks({ darkStreak: 0 })
    return []
  }

  const { crossTableSearch } = await import('../../../../src/core/search-registry')
  const response = await crossTableSearch('doctor canary probe', { limit: 1 })
  if (response.meta.source === 'unavailable') {
    await saveStreaks({ darkStreak: 0 })
    return [] // raced an outage — base check owns it
  }

  const tables = response.meta.tables ?? []
  const verdict = classifyCanary(tables)
  const prior = await loadStreaks()
  const { darkStreak } = await saveStreaks({ darkStreak: verdict === 'dark' ? prior.darkStreak + 1 : 0 })

  if (verdict === 'dark' && darkStreak >= 2) {
    return [{
      check: 'search-canary',
      status: 'error',
      message: `Search is DARK: a real query got zero contribution from all ${tables.length} tables (every source omitted under the query budget) on ${darkStreak} consecutive doctor runs — the engine answers health probes but cannot serve queries. Repair restarts the engine service; the write journal is durable, nothing is lost.`,
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
  if (!getSettings().search.settings.enabled) {
    await saveStreaks({ wedgeStreak: 0, busyStreak: 0 })
    return []
  }

  const { getAppServices } = await import('../../../../src/core/app-services')
  const search = getAppServices().search
  if (!search.engineStatus) return [] // adapter can't measure — feature-detect, never assume
  const status = await search.engineStatus()
  if (status === null) return [] // current mode can't measure (e.g. externally managed guest)
  if (!status.running) {
    // Down engine = broken observation chain; a respawn's legitimate
    // catch-up must not inherit the pre-crash streak (review finding).
    await saveStreaks({ wedgeStreak: 0, busyStreak: 0 })
    return [] // the base search check owns "engine down"
  }

  const prior = await loadStreaks()
  const { wedgeStreak, busyStreak } = await saveStreaks({
    wedgeStreak: status.wedgeSignals.length > 0 ? prior.wedgeStreak + 1 : 0,
    busyStreak: (status.cpuUtilization ?? 0) >= BUSY_UTILIZATION ? prior.busyStreak + 1 : 0,
  })

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

// ── Repair ─────────────────────────────────────────────────────────────────

/**
 * Shared repair: gracefully restart the supervised engine, then verify
 * with a REAL query — the incident proved a wedged engine keeps answering
 * status probes, so `available()` alone would report success while search
 * stays dark. Non-destructive — the outbox is durable and queries degrade
 * honestly during the bounce (D11).
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
      const done = (status: 'applied' | 'failed', message: string) => [{
        id: `health.repair-${checkId}`,
        checkId,
        status,
        message,
        changes: [],
      }]
      if (Date.now() - lastEngineRestartAt < RESTART_DEBOUNCE_MS) {
        return done('applied', 'Engine was already restarted moments ago by the companion check\'s repair — skipped a duplicate bounce; the next doctor run re-verifies')
      }
      if (!search.restartEngine) return done('failed', 'Adapter does not support engine restart — restart the engine where it runs')
      try {
        await search.restartEngine()
        lastEngineRestartAt = Date.now()
      } catch (err) {
        return done('failed', `Engine restart failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      // Verify with the canary query, not the status probe: wait for the
      // engine to answer AND actually serve (not all tables omitted).
      const { crossTableSearch } = await import('../../../../src/core/search-registry')
      const deadline = Date.now() + 30_000
      let serving = false
      while (Date.now() < deadline) {
        if (await search.available()) {
          const probe = await crossTableSearch('doctor canary probe', { limit: 1 }).catch(() => null)
          const tables = probe?.meta.tables ?? []
          if (probe && probe.meta.source === 'search' && classifyCanary(tables) !== 'dark') {
            serving = true
            break
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
      if (!serving) {
        // Deliberately NOT resetting streaks: the wedge likely survived the
        // bounce, and the next doctor run should escalate immediately.
        return done('failed', 'Engine restarted but queries are still dark after 30s — the wedge likely survived the bounce; check the engine log (`~/.bakin/logs/antfly.log`) and `bakin search:stats`')
      }
      await resetStreaks()
      return done('applied', 'Engine restarted and serving queries again; the journal drains automatically')
    },
  }
}

export function searchCanaryRepair(): HealthRepairHandler {
  return engineRestartRepair('search-canary', 'Restart the search engine service (search is dark)')
}

export function searchEngineBurnRepair(): HealthRepairHandler {
  return engineRestartRepair('search-engine-burn', 'Restart the search engine service (zero-progress wedge)')
}
