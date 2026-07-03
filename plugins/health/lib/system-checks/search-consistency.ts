/**
 * System check — blue/green table consistency + the deep maintenance sweep.
 *
 * Surfaces: parked/stuck migrations (a green table that never converged —
 * the migrator deliberately NEVER flips early), active tables whose
 * physical is missing engine-side (black-swan: wiped index), and
 * undroppable tombstoned physicals. Repair = blue/green rebuild (fresh
 * physical, queries stay on the old one throughout) behind a destructive-
 * tier confirmation.
 *
 * The deep sweep (orphan rows + tombstone drops) rides THIS check's run —
 * i.e. the existing doctor interval — throttled to once an hour so doctor
 * cycles stay cheap. No timers of its own, nothing at boot.
 */
import { healthOk, healthWarn } from '@makinbakin/sdk/utils'
import type { HealthCheckResult, HealthRepairHandler } from '../../../../packages/core/src/plugin-types'

const SWEEP_INTERVAL_MS = 60 * 60 * 1000

// Module-level throttle: doctor runs this check every cycle; the heavy
// sweep only actually executes hourly.
let lastSweepAt = 0

export async function checkSearchConsistency(): Promise<HealthCheckResult[]> {
  const { getSettings } = await import('../../../../src/core/settings')
  if (!getSettings().search.settings.enabled) return []

  const { getAppServices } = await import('../../../../src/core/app-services')
  const search = getAppServices().search
  if (!await search.available()) return [] // the base search check owns "engine down"

  const { listTableStates } = await import('@bakin/core/search/tables')
  const results: HealthCheckResult[] = []

  for (const table of listTableStates()) {
    if (table.state === 'migrating') {
      const stuck = table.phase === 'parked'
      results.push(stuck
        ? {
            check: 'search-consistency',
            status: 'error',
            message: `Migration of ${table.logical} is PARKED (green table never converged) — queries still answer from the old table; repair rebuilds`,
            autoFixable: true,
          }
        : healthWarn(
            'search-consistency',
            `Migration of ${table.logical} in flight (${table.phase ?? 'running'}${table.backfillDone != null ? `, ${table.backfillDone} rows` : ''}) — search stays available throughout`,
          ))
      continue
    }

    // Active table: the physical must exist engine-side. stats() === null
    // is the real 404 signal (never a boot scan — this runs on the doctor).
    try {
      const stats = await search.tables.stats(table.physical)
      if (stats === null) {
        results.push({
          check: 'search-consistency',
          status: 'error',
          message: `${table.logical} points at ${table.physical} but the engine has no such table (index wiped?) — repair rebuilds from source`,
          autoFixable: true,
        })
      }
    } catch {
      // transient engine trouble — the base search check reports it
    }
  }

  // Hourly deep sweep: orphaned index rows + tombstoned physicals.
  if (Date.now() - lastSweepAt >= SWEEP_INTERVAL_MS) {
    lastSweepAt = Date.now()
    try {
      const { runOrphanSweep } = await import('../../../../src/core/search-orphan-sweep')
      const { sweepTombstones } = await import('@bakin/core/search/tables')
      const orphanStats = await runOrphanSweep()
      const removed = orphanStats.reduce((sum, s) => sum + s.orphans, 0)
      const tombstonesLeft = await sweepTombstones(search)
      if (removed > 0) {
        results.push(healthOk('search-consistency', `Deep sweep removed ${removed} orphaned index row(s)`))
      }
      if (tombstonesLeft > 0) {
        results.push(healthWarn('search-consistency', `${tombstonesLeft} old physical table(s) still refusing to drop — retrying next sweep`))
      }
    } catch (err) {
      results.push(healthWarn('search-consistency', `Deep sweep failed: ${err instanceof Error ? err.message : String(err)}`))
    }
  }

  if (results.length === 0) {
    results.push(healthOk('search-consistency', 'All tables active on their expected physicals'))
  }
  return results
}

export function searchConsistencyRepair(): HealthRepairHandler {
  return {
    async plan(rows) {
      const matching = rows.filter((row) => row.check === 'search-consistency' && row.autoFixable)
      if (matching.length === 0) return []
      return [{
        id: 'health.repair-search-consistency',
        checkId: 'search-consistency',
        title: 'Rebuild affected search tables (blue/green)',
        reason: matching.map((row) => row.message).join('; '),
        safety: 'destructive',
        requiresConfirmation: true,
        changes: [{
          kind: 'other',
          target: 'search tables',
          action: 'update',
          description: 'Backfill fresh physical tables from source data and flip on convergence; queries keep answering from the current tables throughout.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const { listTableStates } = await import('@bakin/core/search/tables')
      const { rebuildRegisteredTables } = await import('../../../../src/core/search-registry')
      const { getAppServices } = await import('../../../../src/core/app-services')
      const search = getAppServices().search

      const targets: string[] = []
      for (const table of listTableStates()) {
        if (table.state === 'migrating' && table.phase === 'parked') {
          targets.push(table.logical)
          continue
        }
        if (table.state === 'active') {
          const stats = await search.tables.stats(table.physical).catch(() => null)
          if (stats === null) targets.push(table.logical)
        }
      }

      const outcomes: string[] = []
      let failed = 0
      for (const logical of targets) {
        const [result] = await rebuildRegisteredTables(logical)
        if (!result || result.error || result.result === 'parked') failed++
        outcomes.push(`${logical}: ${result?.error ?? result?.result ?? 'no registered def'}`)
      }
      return [{
        id: 'health.repair-search-consistency',
        checkId: 'search-consistency',
        status: failed > 0 ? 'failed' : 'applied',
        message: targets.length === 0 ? 'Nothing to rebuild' : outcomes.join('; '),
        changes: [],
      }]
    },
  }
}
