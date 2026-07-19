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
import { healthError, healthHealthy, healthNotApplicable, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthRepairActionDefinition, HealthRepairPlanItem } from '@makinbakin/sdk'
import { repairTargetSelection } from './repair-support'
import { createLogger } from '../../../../src/core/logger'

const log = createLogger('health-search-engine-watch')

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

class EngineWatchStateError extends Error {
  constructor(message: string, options: { cause: unknown }) {
    super(message, options)
    this.name = 'EngineWatchStateError'
  }
}

async function statePath(): Promise<string> {
  const { getContentDir } = await import('../../../../src/core/content-dir')
  return join(getContentDir(), 'plugin-data', 'health', 'engine-watch.json')
}

async function loadStreaks(): Promise<StreakState> {
  const path = await statePath()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('persisted state must be a JSON object')
    }
    const raw = parsed as Partial<StreakState>
    return {
      darkStreak: parseStreak(raw, 'darkStreak'),
      wedgeStreak: parseStreak(raw, 'wedgeStreak'),
      busyStreak: parseStreak(raw, 'busyStreak'),
    }
  } catch (error) {
    if (isMissingFileError(error)) return { ...ZERO_STREAKS }
    const wrapped = new EngineWatchStateError('Search engine watch history could not be read.', {
      cause: error,
    })
    log.error('Search engine watch history read failed', wrapped, {
      path,
      cause: error instanceof Error ? error.message : String(error),
    })
    throw wrapped
  }
}

async function saveStreaks(next: Partial<StreakState>): Promise<StreakState> {
  const merged = { ...(await loadStreaks()), ...next }
  await writeStreaks(merged)
  return merged
}

async function writeStreaks(state: StreakState): Promise<void> {
  const path = await statePath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(state))
  } catch (error) {
    const wrapped = new EngineWatchStateError('Search engine watch history could not be written.', {
      cause: error,
    })
    log.error('Search engine watch history write failed', wrapped, {
      path,
      cause: error instanceof Error ? error.message : String(error),
    })
    throw wrapped
  }
}

function parseStreak(state: Partial<StreakState>, key: keyof StreakState): number {
  const value = state[key]
  if (value === undefined) return 0
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${key} must be a non-negative safe integer`)
  }
  return value
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/**
 * Post-restart reset: a bounced engine makes every pre-restart streak moot
 * (both checks observe the same engine), so ALL streaks clear together.
 */
async function resetStreaks(): Promise<void> {
  await writeStreaks({ ...ZERO_STREAKS })
}

// In-memory restart debounce — both repair applies run in one process.
let lastEngineRestartAt = 0

/** Test-only alias — the production reset is resetStreaks(). */
export async function resetEngineWatchStateForTests(): Promise<void> {
  await resetStreaks()
  lastEngineRestartAt = 0
}

// ── Checks ─────────────────────────────────────────────────────────────────

export async function checkSearchCanary(): Promise<HealthCheckRunInput> {
  try {
    return await checkSearchCanaryWithState()
  } catch (error) {
    if (error instanceof EngineWatchStateError) {
      return healthObserved([engineWatchStateUnknown(error)])
    }
    throw error
  }
}

async function checkSearchCanaryWithState(): Promise<HealthCheckRunInput> {
  const { getSettings } = await import('../../../../src/core/settings')
  if (!getSettings().search.settings.enabled) {
    await saveStreaks({ darkStreak: 0 })
    return healthNotApplicable('Search is disabled; a production query canary is not applicable.')
  }

  const { getAppServices } = await import('../../../../src/core/app-services')
  const search = getAppServices().search
  try {
    if (!await search.available()) {
      // The base search check owns "engine down" — and a down engine breaks
      // the observation chain, so the streak must not survive the gap.
      await saveStreaks({ darkStreak: 0 })
      return healthNotApplicable('The Search engine is unavailable; the main Search check owns engine availability.')
    }
  } catch (err) {
    await saveStreaks({ darkStreak: 0 })
    return healthObserved([canaryUnknown(err)])
  }

  const { crossTableSearch } = await import('../../../../src/core/search-registry')
  let response: Awaited<ReturnType<typeof crossTableSearch>>
  try {
    response = await crossTableSearch('doctor canary probe', { limit: 1 })
  } catch (err) {
    await saveStreaks({ darkStreak: 0 })
    return healthObserved([canaryUnknown(err)])
  }
  if (response.meta.source === 'unavailable') {
    await saveStreaks({ darkStreak: 0 })
    return healthNotApplicable('The canary raced an engine outage; the main Search check owns engine availability.')
  }

  const tables = response.meta.tables ?? []
  const verdict = classifyCanary(tables)
  const prior = await loadStreaks()
  const { darkStreak } = await saveStreaks({ darkStreak: verdict === 'dark' ? prior.darkStreak + 1 : 0 })

  if (verdict === 'dark' && darkStreak >= 2) {
    return healthObserved([healthError({
      key: 'queries.canary',
      summary: 'Search is not serving real queries.',
      detail: `Every one of ${tables.length} tables was omitted under the query budget on ${darkStreak} consecutive Health runs, even though the engine answers health probes.`,
      evidence: { verdict, tableCount: tables.length, darkStreak },
      incident: {
        key: 'search-dark',
        title: 'Search is dark despite passing engine probes',
        class: 'service_failure',
        impact: 'Production searches return no indexed contribution from any table.',
        disposition: 'action_required',
        resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
        resolution: {
          key: 'restart-engine',
          type: 'repair',
          label: 'Restart and verify the Search engine',
          actionId: 'search-canary-restart',
        },
      },
    })])
  }
  if (verdict === 'dark') {
    return healthObserved([healthWarning({
      key: 'queries.canary',
      summary: 'Canary query received no contribution from any table.',
      detail: 'The engine may be busy or wedged; a second consecutive dark result becomes actionable.',
      evidence: { verdict, tableCount: tables.length, darkStreak },
      incident: {
        key: 'search-dark-first-sample',
        title: 'Search canary needs another sample',
        impact: 'Real queries may be returning no indexed results under the current engine load.',
        disposition: 'watch',
        resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Run the canary again' },
      },
    })])
  }
  if (verdict === 'partial') {
    const omitted = tables.filter((t) => t.budget === 'omitted').length
    const degraded = tables.filter((t) => t.budget === 'degraded').length
    return healthObserved([healthWarning({
      key: 'queries.canary',
      summary: 'Canary query completed with degraded coverage.',
      detail: `${omitted} of ${tables.length} tables were omitted and ${degraded} used keyword-only search.`,
      evidence: { verdict, tableCount: tables.length, omitted, degraded, tookMs: response.meta.took_ms },
      incident: {
        key: 'query-degraded',
        title: 'Search query coverage is degraded',
        class: 'service_failure',
        impact: 'Search remains available, but results may omit tables or semantic matches under load.',
        disposition: 'watch',
        resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
        resolution: {
          key: 'inspect-stats',
          type: 'instructions',
          label: 'Inspect Search load',
          steps: ['Inspect Search statistics and backlog if degraded coverage persists.'],
          command: 'bakin search:stats',
        },
      },
    })])
  }
  return healthObserved([healthHealthy({
    key: 'queries.canary',
    summary: `Canary query answered from all ${tables.length} Search table${tables.length === 1 ? '' : 's'}.`,
    detail: `${response.meta.took_ms} ms.`,
    evidence: { verdict, tableCount: tables.length, tookMs: response.meta.took_ms },
  })])
}

export async function checkSearchEngineBurn(): Promise<HealthCheckRunInput> {
  try {
    return await checkSearchEngineBurnWithState()
  } catch (error) {
    if (error instanceof EngineWatchStateError) {
      return healthObserved([engineWatchStateUnknown(error)])
    }
    throw error
  }
}

async function checkSearchEngineBurnWithState(): Promise<HealthCheckRunInput> {
  const { getSettings } = await import('../../../../src/core/settings')
  if (!getSettings().search.settings.enabled) {
    await saveStreaks({ wedgeStreak: 0, busyStreak: 0 })
    return healthNotApplicable('Search is disabled; engine burn monitoring is not applicable.')
  }

  const { getAppServices } = await import('../../../../src/core/app-services')
  const search = getAppServices().search
  if (!search.engineStatus) {
    await saveStreaks({ wedgeStreak: 0, busyStreak: 0 })
    return healthNotApplicable('The active Search adapter does not expose engine process telemetry.')
  }
  let status: Awaited<ReturnType<NonNullable<typeof search.engineStatus>>>
  try {
    status = await search.engineStatus()
  } catch (err) {
    await saveStreaks({ wedgeStreak: 0, busyStreak: 0 })
    return healthObserved([engineBurnUnknown(err)])
  }
  if (status === null) {
    await saveStreaks({ wedgeStreak: 0, busyStreak: 0 })
    return healthNotApplicable('The current Search supervision mode cannot measure engine process telemetry.')
  }
  if (!status.running) {
    // Down engine = broken observation chain; a respawn's legitimate
    // catch-up must not inherit the pre-crash streak (review finding).
    await saveStreaks({ wedgeStreak: 0, busyStreak: 0 })
    return healthNotApplicable('The Search engine is down; the main Search check owns engine availability.')
  }

  const prior = await loadStreaks()
  const { wedgeStreak, busyStreak } = await saveStreaks({
    wedgeStreak: status.wedgeSignals.length > 0 ? prior.wedgeStreak + 1 : 0,
    busyStreak: (status.cpuUtilization ?? 0) >= BUSY_UTILIZATION ? prior.busyStreak + 1 : 0,
  })

  if (wedgeStreak >= 2) {
    return healthObserved([healthError({
      key: 'engine.burn',
      summary: 'Search engine is wedged.',
      detail: `Zero-progress signatures recurred across ${wedgeStreak} consecutive Health runs while process ${status.pid} used about ${Math.round((status.cpuUtilization ?? 0) * 100)}% of one CPU core.`,
      evidence: {
        wedgeSignals: status.wedgeSignals,
        wedgeStreak,
        busyStreak,
        pid: status.pid ?? null,
        cpuUtilization: status.cpuUtilization,
      },
      incident: {
        key: 'engine-wedged',
        title: 'Search engine has a zero-progress wedge',
        class: 'service_failure',
        impact: 'The engine can consume sustained CPU while indexed queries remain starved.',
        disposition: 'action_required',
        resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
        resolution: {
          key: 'restart-engine',
          type: 'repair',
          label: 'Restart and verify the Search engine',
          actionId: 'search-engine-burn-restart',
        },
      },
    })])
  }
  if (status.wedgeSignals.length > 0) {
    return healthObserved([healthWarning({
      key: 'engine.burn',
      summary: 'Search engine emitted a possible wedge signature.',
      detail: `${status.wedgeSignals.join(', ')}. A second consecutive sample becomes actionable; this sample may be legitimate post-crash catch-up.`,
      evidence: { wedgeSignals: status.wedgeSignals, wedgeStreak, busyStreak, pid: status.pid ?? null, cpuUtilization: status.cpuUtilization },
      incident: {
        key: 'wedge-first-sample',
        title: 'Search engine wedge needs another sample',
        impact: 'A persistent zero-progress signature can consume CPU while Search remains unresponsive.',
        disposition: 'watch',
        resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Measure engine burn again' },
      },
    })])
  }
  if (busyStreak >= 2) {
    return healthObserved([healthWarning({
      key: 'engine.burn',
      summary: 'Search engine CPU use is sustained.',
      detail: `About ${Math.round((status.cpuUtilization ?? 0) * 100)}% of one core across ${busyStreak} consecutive Health runs, with no wedge signature. This can be normal during backfills and enrichment.`,
      evidence: { wedgeSignals: [], wedgeStreak, busyStreak, pid: status.pid ?? null, cpuUtilization: status.cpuUtilization },
      incident: {
        key: 'sustained-cpu',
        title: 'Search engine load needs watching',
        // service_failure, not usage_anomaly: sustained engine CPU is the
        // known precursor of the #319 zero-progress spin — demoting it to a
        // silent advisory would hide real degradation until queries fail.
        class: 'service_failure',
        impact: 'Sustained engine load can slow queries, though active index work may explain it.',
        disposition: 'watch',
        resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
        resolution: {
          key: 'inspect-stats',
          type: 'instructions',
          label: 'Inspect Search workload',
          steps: ['Inspect Search statistics and backlog to confirm active work explains the load.'],
          command: 'bakin search:stats',
        },
      },
    })])
  }
  return healthObserved([healthHealthy({
    key: 'engine.burn',
    summary: status.cpuUtilization === null
      ? 'Search engine is running; CPU rate will be available on the next sample.'
      : 'Search engine process telemetry is healthy.',
    detail: status.cpuUtilization === null
      ? undefined
      : `About ${Math.round(status.cpuUtilization * 100)}% of one CPU core with no wedge signatures.`,
    evidence: { wedgeSignals: [], wedgeStreak, busyStreak, pid: status.pid ?? null, cpuUtilization: status.cpuUtilization },
  })])
}

// ── Repair ─────────────────────────────────────────────────────────────────

/**
 * Shared repair: gracefully restart the supervised engine, then verify
 * with a REAL query — the incident proved a wedged engine keeps answering
 * status probes, so `available()` alone would report success while search
 * stays dark. Non-destructive — the outbox is durable and queries degrade
 * honestly during the bounce (D11).
 */
function engineRestartRepair(
  actionId: 'search-canary-restart' | 'search-engine-burn-restart',
  checkId: 'search-canary' | 'search-engine-burn',
  title: string,
): HealthRepairActionDefinition {
  return {
    id: actionId,
    name: title,
    async plan(target) {
      return [{
        id: `restart-engine-${checkId}`,
        actionId,
        title,
        reason: 'The engine is running but production query or process telemetry shows a persistent wedge.',
        safety: 'safe',
        ...repairTargetSelection(target),
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
      const done = (status: 'applied' | 'failed', message: string) => repairResults(items, status, message, `health.${checkId}`)
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

export function searchCanaryRepair(): HealthRepairActionDefinition {
  return engineRestartRepair('search-canary-restart', 'search-canary', 'Restart the Search engine (queries are dark)')
}

export function searchEngineBurnRepair(): HealthRepairActionDefinition {
  return engineRestartRepair('search-engine-burn-restart', 'search-engine-burn', 'Restart the Search engine (zero-progress wedge)')
}

function engineWatchStateUnknown(error: EngineWatchStateError) {
  const cause = error.cause instanceof Error ? error.cause.message : null
  return healthUnknown({
    key: 'state.persistence',
    summary: 'Search engine watch history could not be verified.',
    detail: cause ? `${error.message} ${cause}` : error.message,
    incident: {
      key: 'engine-watch-state-unknown',
      title: 'Search engine watch history is unavailable',
      class: 'evidence_gap',
      impact: 'Health cannot safely decide whether Search symptoms repeated across consecutive checks.',
      disposition: 'watch',
      resources: [{ kind: 'file', id: 'engine-watch-state', label: 'Search engine watch history' }],
      resolution: {
        key: 'restore-watch-history',
        type: 'instructions',
        label: 'Restore watch history',
        steps: [
          'Check plugin-data/health/engine-watch.json for invalid JSON or unreadable file permissions.',
          'Move an invalid file aside, then rerun Health to start a fresh observation streak.',
        ],
      },
    },
  })
}

function canaryUnknown(error: unknown) {
  return healthUnknown({
    key: 'queries.canary',
    summary: 'Production Search query behavior could not be verified.',
    detail: error instanceof Error ? error.message : String(error),
    incident: {
      key: 'canary-unknown',
      title: 'Search query canary is unknown',
      class: 'evidence_gap',
      impact: 'Health cannot confirm that the engine serves real indexed queries.',
      disposition: 'watch',
      resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
      resolution: { key: 'rerun', type: 'rerun', label: 'Rerun the canary' },
    },
  })
}

function engineBurnUnknown(error: unknown) {
  return healthUnknown({
    key: 'engine.burn',
    summary: 'Search engine process telemetry could not be verified.',
    detail: error instanceof Error ? error.message : String(error),
    incident: {
      key: 'engine-burn-unknown',
      title: 'Search engine burn status is unknown',
      class: 'evidence_gap',
      impact: 'Health cannot detect sustained CPU use or known zero-progress signatures.',
      disposition: 'watch',
      resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
      resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
    },
  })
}

function repairResults(
  items: HealthRepairPlanItem[],
  status: 'applied' | 'failed',
  message: string,
  affectedCheckId: string,
) {
  return items.map((item) => ({
    itemId: item.id,
    actionId: item.actionId,
    status,
    message,
    affectedCheckIds: [affectedCheckId],
    changes: item.changes,
  }))
}
