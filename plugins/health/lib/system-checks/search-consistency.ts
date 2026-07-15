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
 * The deep sweep (orphan rows + tombstone drops + stale engine-table
 * generations) rides THIS check's run — i.e. the existing doctor interval —
 * throttled to once an hour so doctor cycles stay cheap. No timers of its
 * own, nothing at boot.
 */
import { healthError, healthHealthy, healthNotApplicable, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthObservationInput, HealthRepairActionDefinition } from '@makinbakin/sdk'
import { stableKeyPart } from './key'
import { repairTargetSelection } from './repair-support'

const SWEEP_INTERVAL_MS = 60 * 60 * 1000

// Module-level throttle: doctor runs this check every cycle; the heavy
// sweep only actually executes hourly.
let lastSweepAt = 0

export async function checkSearchConsistency(): Promise<HealthCheckRunInput> {
  const { getSettings } = await import('../../../../src/core/settings')
  if (!getSettings().search.settings.enabled) {
    return healthNotApplicable('Search is disabled; the main Search check owns enablement.')
  }

  const { getAppServices } = await import('../../../../src/core/app-services')
  const search = getAppServices().search
  try {
    if (!await search.available()) {
      return healthNotApplicable('The Search engine is unavailable; the main Search check owns engine availability.')
    }
  } catch (err) {
    return healthObserved([healthUnknown({
      key: 'indexes.availability',
      summary: 'Search index consistency could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'availability-unknown',
        title: 'Search index consistency is unknown',
        impact: 'Health cannot confirm that logical indexes point to available engine tables.',
        disposition: 'watch',
        resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })])
  }

  const { listTableStates } = await import('@bakin/core/search/tables')
  const observations: HealthObservationInput[] = []

  for (const table of listTableStates()) {
    const tableId = stableKeyPart(table.logical)
    if (table.state === 'migrating') {
      const stuck = table.phase === 'parked'
      const evidence = {
        logicalTable: table.logical,
        physicalTable: table.physical,
        migratingTo: table.migratingTo ?? '',
        phase: table.phase ?? 'running',
        backfillDone: table.backfillDone ?? 0,
      }
      observations.push(stuck
        ? healthError({
          key: `indexes.table:${tableId}`,
          summary: `${table.logical} migration is parked.`,
          detail: 'The replacement table never converged; queries continue using the previous physical table.',
          evidence,
          incident: {
            key: `migration-parked:${tableId}`,
            title: 'Search index migration is parked',
            impact: 'The index cannot advance to its replacement table and may remain stale.',
            disposition: 'action_required',
            resources: [{ kind: 'search_table', id: tableId, label: table.logical.slice(0, 120) }],
            resolution: {
              key: 'rebuild-table',
              type: 'repair',
              label: 'Rebuild the index blue/green',
              actionId: 'search-consistency-rebuild',
            },
          },
        })
        : healthWarning({
          key: `indexes.table:${tableId}`,
          summary: `${table.logical} migration is in progress.`,
          detail: `${table.phase ?? 'running'}${table.backfillDone != null ? `, ${table.backfillDone} rows backfilled` : ''}. Queries remain available during migration.`,
          evidence,
          incident: {
            key: `migration-running:${tableId}`,
            title: 'Search index migration is still running',
            impact: 'Search remains available, but the replacement index is not ready yet.',
            disposition: 'watch',
            resources: [{ kind: 'search_table', id: tableId, label: table.logical.slice(0, 120) }],
            resolution: { key: 'rerun', type: 'rerun', label: 'Check migration again' },
          },
        }))
      continue
    }

    // Active table: the physical must exist engine-side. stats() === null
    // is the real 404 signal (never a boot scan — this runs on the doctor).
    try {
      const stats = await search.tables.stats(table.physical)
      if (stats === null) {
        observations.push(healthError({
          key: `indexes.table:${tableId}`,
          summary: `${table.logical} points to a missing engine table.`,
          detail: `The active physical table ${table.physical} does not exist in the Search engine.`,
          evidence: { logicalTable: table.logical, physicalTable: table.physical, exists: false },
          incident: {
            key: `table-missing:${tableId}`,
            title: 'Active Search index is missing',
            impact: 'Queries against this logical index cannot return its source data.',
            disposition: 'action_required',
            resources: [{ kind: 'search_table', id: tableId, label: table.logical.slice(0, 120) }],
            resolution: {
              key: 'rebuild-table',
              type: 'repair',
              label: 'Rebuild the index blue/green',
              actionId: 'search-consistency-rebuild',
            },
          },
        }))
      }
    } catch (err) {
      observations.push(healthUnknown({
        key: `indexes.table:${tableId}`,
        summary: `${table.logical} could not be verified.`,
        detail: err instanceof Error ? err.message : String(err),
        incident: {
          key: `table-unknown:${tableId}`,
          title: 'Search index status is unknown',
          impact: 'Health cannot confirm that this logical index has an active physical table.',
          disposition: 'watch',
          resources: [{ kind: 'search_table', id: tableId, label: table.logical.slice(0, 120) }],
          resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
        },
      }))
    }
  }

  // Hourly deep sweep: orphaned index rows + tombstoned physicals + stale
  // engine-side table generations the registry no longer references.
  if (Date.now() - lastSweepAt >= SWEEP_INTERVAL_MS) {
    lastSweepAt = Date.now()
    try {
      const { runOrphanSweep, sweepOrphanRegistryRows } = await import('../../../../src/core/search-orphan-sweep')
      const { sweepTombstones, sweepOrphanEngineTables } = await import('@bakin/core/search/tables')
      const orphanStats = await runOrphanSweep()
      const removed = orphanStats.reduce((sum, s) => sum + s.orphans, 0)
      const orphanRows = await sweepOrphanRegistryRows()
      // Isolated: a transient tables.list() failure must not cost the
      // tombstone retry its hourly slot (review finding).
      let orphanTables: Awaited<ReturnType<typeof sweepOrphanEngineTables>> | null = null
      try {
        orphanTables = await sweepOrphanEngineTables(search)
      } catch (err) {
        observations.push(healthUnknown({
          key: 'indexes.sweep.engine-tables',
          summary: 'Stale engine-table sweep could not be completed.',
          detail: err instanceof Error ? err.message : String(err),
          incident: {
            key: 'engine-table-sweep-failed',
            title: 'Stale Search tables could not be verified',
            impact: 'Unused engine tables may continue consuming storage until the next successful sweep.',
            disposition: 'watch',
            resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
            resolution: { key: 'rerun', type: 'rerun', label: 'Retry the sweep' },
          },
        }))
      }
      const tombstonesLeft = await sweepTombstones(search)
      if (removed > 0) {
        observations.push(healthHealthy({
          key: 'indexes.sweep.rows',
          summary: `Deep sweep removed ${removed} orphaned index row${removed === 1 ? '' : 's'}.`,
          evidence: { removed },
        }))
      }
      if (orphanRows.length > 0) {
        observations.push(healthHealthy({
          key: 'indexes.sweep.registry',
          summary: `Deep sweep purged ${orphanRows.length} orphaned registry row${orphanRows.length === 1 ? '' : 's'}.`,
          detail: orphanRows.join(', '),
          evidence: { removed: orphanRows },
        }))
      }
      if (orphanTables && orphanTables.dropped.length > 0) {
        observations.push(healthHealthy({
          key: 'indexes.sweep.stale-tables',
          summary: `Deep sweep dropped ${orphanTables.dropped.length} stale engine table${orphanTables.dropped.length === 1 ? '' : 's'}.`,
          detail: orphanTables.dropped.join(', '),
          evidence: { dropped: orphanTables.dropped },
        }))
      }
      if (orphanTables && orphanTables.unclaimed.length > 0) {
        observations.push(healthWarning({
          key: 'indexes.sweep.unclaimed',
          summary: `${orphanTables.unclaimed.length} unreferenced engine table${orphanTables.unclaimed.length === 1 ? ' was' : 's were'} left untouched.`,
          detail: `${orphanTables.unclaimed.join(', ')}. Another Bakin instance may own them.`,
          evidence: { unclaimed: orphanTables.unclaimed },
          incident: {
            key: 'unclaimed-tables',
            title: 'Unclaimed Search tables need review',
            impact: 'Stale unclaimed tables consume engine storage, but deleting tables owned by another instance would lose its index data.',
            disposition: 'advisory',
            resources: orphanTables.unclaimed.slice(0, 50).map((table) => ({ kind: 'search_table' as const, id: stableKeyPart(table), label: table.slice(0, 120) })),
            resolution: {
              key: 'review-tables',
              type: 'instructions',
              label: 'Review unclaimed tables',
              steps: ['Confirm table ownership, then manually drop only tables that are known to be stale.'],
            },
          },
        }))
      }
      if (tombstonesLeft > 0) {
        observations.push(healthWarning({
          key: 'indexes.sweep.tombstones',
          summary: `${tombstonesLeft} retired physical table${tombstonesLeft === 1 ? ' is' : 's are'} still awaiting deletion.`,
          detail: 'Health will retry during the next deep sweep.',
          evidence: { remaining: tombstonesLeft },
          incident: {
            key: 'tombstones-remain',
            title: 'Retired Search tables could not be dropped',
            impact: 'Old physical tables continue consuming engine storage.',
            disposition: 'watch',
            resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
            resolution: { key: 'rerun', type: 'rerun', label: 'Retry during the next sweep' },
          },
        }))
      }
    } catch (err) {
      observations.push(healthUnknown({
        key: 'indexes.sweep',
        summary: 'Search index deep sweep could not be completed.',
        detail: err instanceof Error ? err.message : String(err),
        incident: {
          key: 'deep-sweep-failed',
          title: 'Search index maintenance status is unknown',
          impact: 'Orphaned rows and retired tables may remain until the next successful sweep.',
          disposition: 'watch',
          resources: [{ kind: 'system', id: 'search-index-maintenance', label: 'Search index maintenance' }],
          resolution: { key: 'rerun', type: 'rerun', label: 'Retry the sweep' },
        },
      }))
    }
  }

  if (observations.length === 0) {
    observations.push(healthHealthy({
      key: 'indexes.tables',
      summary: 'All logical indexes point to their expected physical tables.',
      evidence: { consistent: true },
    }))
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

export function searchConsistencyRepair(): HealthRepairActionDefinition {
  return {
    id: 'search-consistency-rebuild',
    name: 'Rebuild inconsistent Search indexes',
    async plan(target) {
      return [{
        id: 'rebuild-inconsistent-indexes',
        actionId: 'search-consistency-rebuild',
        title: 'Rebuild affected search tables (blue/green)',
        reason: 'One or more logical indexes are parked or point to missing physical tables.',
        safety: 'destructive',
        ...repairTargetSelection(target),
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
      try {
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
            const stats = await search.tables.stats(table.physical)
            if (stats === null) targets.push(table.logical)
          }
        }

        const outcomes: string[] = []
        let failed = 0
        for (const logical of targets) {
          const [result] = await rebuildRegisteredTables(logical)
          if (!result || result.error || result.result === 'parked') failed++
          outcomes.push(`${logical}: ${result?.error ?? result?.result ?? 'no registered definition'}`)
        }
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: failed > 0 ? 'failed' as const : 'applied' as const,
          message: targets.length === 0 ? 'Nothing needs rebuilding.' : outcomes.join('; '),
          affectedCheckIds: ['health.search-consistency'],
          changes: item.changes,
        }))
      } catch (err) {
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: err instanceof Error ? err.message : String(err),
          affectedCheckIds: ['health.search-consistency'],
          changes: item.changes,
        }))
      }
    },
  }
}
