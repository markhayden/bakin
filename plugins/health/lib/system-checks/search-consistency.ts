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
import type {
  HealthCheckRunInput,
  HealthObservationInput,
  HealthRepairActionDefinition,
  HealthRepairApplyResult,
  HealthRepairPlanItem,
  HealthRepairTarget,
} from '@makinbakin/sdk'
import { stableKeyPart } from './key'

const SWEEP_INTERVAL_MS = 60 * 60 * 1000
const SEARCH_CONSISTENCY_CHECK_ID = 'health.search-consistency'
const SEARCH_CONSISTENCY_ACTION_ID = 'search-consistency-rebuild'

interface SearchRepairTableState {
  logical: string
  physical: string
  state: string
  phase?: string | null
}

function tableObservationId(logical: string): string {
  return `${SEARCH_CONSISTENCY_CHECK_ID}:indexes.table:${stableKeyPart(logical)}`
}

/** Engine-side table names, or null when the list itself is unavailable. */
async function engineTableNames(
  search: { tables: { list(): Promise<Array<{ name: string }>> } },
): Promise<Set<string> | null> {
  try {
    return new Set((await search.tables.list()).map((table) => table.name))
  } catch {
    return null
  }
}

/**
 * Rebuild-worthy = the engine's table LIST confirms the physical is gone.
 * A null stats read alone can also mean a dead shard in a live engine
 * (restart territory) — and when the list can't be fetched, ambiguity
 * must never resolve to a rebuild. A THROWN stats read propagates so
 * repair outcomes report the real error instead of a silent skip.
 */
async function confirmedMissing(
  search: { tables: { list(): Promise<Array<{ name: string }>>; stats(name: string): Promise<unknown> } },
  physical: string,
  listedNames?: Set<string> | null,
): Promise<boolean> {
  const stats = await search.tables.stats(physical)
  if (stats !== null) return false
  const listed = listedNames === undefined ? await engineTableNames(search) : listedNames
  return listed !== null && !listed.has(physical)
}

function tableIncidentId(table: SearchRepairTableState): string | null {
  const tableId = stableKeyPart(table.logical)
  if (table.state === 'migrating' && table.phase === 'parked') {
    return `health:search:migration-parked:${tableId}`
  }
  if (table.state === 'active') return `health:search:table-missing:${tableId}`
  return null
}

function targetSelectsTable(target: HealthRepairTarget, table: SearchRepairTableState): boolean {
  if (target.type === 'all_actionable') return true
  const selected = new Set(target.ids)
  if (target.type === 'observations') return selected.has(tableObservationId(table.logical))
  const incidentId = tableIncidentId(table)
  return incidentId !== null && selected.has(incidentId)
}

function planItemForTable(table: SearchRepairTableState): HealthRepairPlanItem {
  return {
    id: `rebuild-index:${table.logical}`,
    actionId: SEARCH_CONSISTENCY_ACTION_ID,
    title: `Rebuild ${table.logical} (blue/green)`,
    reason: `${table.logical} is parked or points to a missing physical table.`,
    safety: 'destructive',
    incidentIds: [],
    observationIds: [tableObservationId(table.logical)],
    preconditions: [],
    changes: [{
      kind: 'other',
      target: table.logical,
      action: 'update',
      description: 'Backfill a fresh physical table from source data and flip on convergence; queries keep answering from the current table throughout.',
    }],
  }
}

function logicalTableFromPlanItem(item: HealthRepairPlanItem): string {
  const changes = item.changes.filter((change) => change.kind === 'other' && change.action === 'update')
  if (changes.length !== 1 || changes[0]!.target.trim().length === 0) {
    throw new Error(`Repair item ${item.id} does not identify exactly one Search index.`)
  }
  const logical = changes[0]!.target
  if (item.observationIds.length !== 1 || item.observationIds[0] !== tableObservationId(logical)) {
    throw new Error(`Repair item ${item.id} has inconsistent Search index scope.`)
  }
  return logical
}

function repairResult(
  item: HealthRepairPlanItem,
  status: HealthRepairApplyResult['status'],
  message: string,
): HealthRepairApplyResult {
  return {
    itemId: item.id,
    actionId: item.actionId,
    status,
    message,
    affectedCheckIds: [SEARCH_CONSISTENCY_CHECK_ID],
    changes: item.changes,
  }
}

// Module-level throttle: doctor runs this check every cycle; the heavy
// sweep only actually executes hourly.
let lastSweepAt = 0

export function resetSearchConsistencyStateForTests(): void {
  lastSweepAt = 0
}

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
        class: 'evidence_gap',
        impact: 'Health cannot confirm that logical indexes point to available engine tables.',
        disposition: 'watch',
        resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })])
  }

  const { listTableStates } = await import('@bakin/core/search/tables')
  const observations: HealthObservationInput[] = []
  // Fetched lazily on the first null stats read, shared across the loop.
  let listedNames: Set<string> | null | undefined

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
            class: 'service_failure',
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

    // Active table: the physical must exist engine-side. stats() === null is
    // the engine's 404 on the index-status read — but that alone is NOT
    // proof the table is gone: a dead shard actor inside a running engine
    // 404s the status path while the table still appears in tables.list()
    // (field-diagnosed 2026-07-21; the wrong verdict sends the operator to
    // a rebuild when a 20-second engine restart is the fix). Corroborate
    // before claiming missing.
    try {
      const stats = await search.tables.stats(table.physical)
      if (stats === null) {
        if (listedNames === undefined) listedNames = await engineTableNames(search)
        if (listedNames?.has(table.physical)) {
          observations.push(healthError({
            key: `indexes.table:${tableId}`,
            summary: `${table.logical} exists but is unreadable.`,
            detail: `The engine lists ${table.physical}, but its index status reads as not found — a dead shard inside a running engine. An engine restart reloads it; a rebuild is not needed.`,
            evidence: { logicalTable: table.logical, physicalTable: table.physical, listed: true, statusReadable: false },
            incident: {
              key: `table-unreadable:${tableId}`,
              title: 'Search index is unreadable inside a running engine',
              class: 'service_failure',
              impact: 'Queries touching this index hang or fail while the rest of Search stays up.',
              disposition: 'action_required',
              resources: [{ kind: 'search_table', id: tableId, label: table.logical.slice(0, 120) }],
              resolution: {
                key: 'restart-engine',
                type: 'repair',
                label: 'Restart the Search engine',
                actionId: 'search-consistency-restart',
              },
            },
          }))
        } else if (listedNames === null) {
          observations.push(healthUnknown({
            key: `indexes.table:${tableId}`,
            summary: `${table.logical} could not be verified.`,
            detail: 'The index status read came back not-found, and the engine table list could not be fetched to distinguish a missing table from an unreadable one.',
            incident: {
              key: `table-unknown:${tableId}`,
              title: 'Search index status is unknown',
              class: 'evidence_gap',
              impact: 'Health cannot confirm that this logical index has an active physical table.',
              disposition: 'watch',
              resources: [{ kind: 'search_table', id: tableId, label: table.logical.slice(0, 120) }],
              resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
            },
          }))
        } else {
          observations.push(healthError({
            key: `indexes.table:${tableId}`,
            summary: `${table.logical} points to a missing engine table.`,
            detail: `The active physical table ${table.physical} does not exist in the Search engine.`,
            evidence: { logicalTable: table.logical, physicalTable: table.physical, exists: false },
            incident: {
              key: `table-missing:${tableId}`,
              title: 'Active Search index is missing',
              class: 'service_failure',
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
      }
    } catch (err) {
      observations.push(healthUnknown({
        key: `indexes.table:${tableId}`,
        summary: `${table.logical} could not be verified.`,
        detail: err instanceof Error ? err.message : String(err),
        incident: {
          key: `table-unknown:${tableId}`,
          title: 'Search index status is unknown',
          class: 'evidence_gap',
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
    try {
      const { runOrphanSweep, sweepOrphanRegistryRows } = await import('../../../../src/core/search-orphan-sweep')
      const { sweepTombstones, sweepOrphanEngineTables } = await import('@bakin/core/search/tables')
      const orphanStats = await runOrphanSweep()
      const removed = orphanStats.reduce((sum, s) => sum + s.orphans, 0)
      const orphanRows = await sweepOrphanRegistryRows()
      // Isolated: a transient tables.list() failure must not cost the
      // tombstone retry its hourly slot (review finding).
      let orphanTables: Awaited<ReturnType<typeof sweepOrphanEngineTables>> | null = null
      let sweepVerified = true
      try {
        orphanTables = await sweepOrphanEngineTables(search)
      } catch (err) {
        sweepVerified = false
        observations.push(healthUnknown({
          key: 'indexes.sweep.engine-tables',
          summary: 'Stale engine-table sweep could not be completed.',
          detail: err instanceof Error ? err.message : String(err),
          incident: {
            key: 'engine-table-sweep-failed',
            title: 'Stale Search tables could not be verified',
            class: 'cleanup_backlog',
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
            class: 'cleanup_backlog',
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
            class: 'cleanup_backlog',
            impact: 'Old physical tables continue consuming engine storage.',
            disposition: 'watch',
            resources: [{ kind: 'service', id: 'search-engine', label: 'Search engine' }],
            resolution: { key: 'rerun', type: 'rerun', label: 'Retry during the next sweep' },
          },
        }))
      }
      if (sweepVerified) lastSweepAt = Date.now()
    } catch (err) {
      observations.push(healthUnknown({
        key: 'indexes.sweep',
        summary: 'Search index deep sweep could not be completed.',
        detail: err instanceof Error ? err.message : String(err),
        incident: {
          key: 'deep-sweep-failed',
          title: 'Search index maintenance status is unknown',
          class: 'evidence_gap',
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
    id: SEARCH_CONSISTENCY_ACTION_ID,
    name: 'Rebuild inconsistent Search indexes',
    async plan(target) {
      const { listTableStates } = await import('@bakin/core/search/tables')
      const selected = listTableStates().filter((table) => targetSelectsTable(target, table))

      if (target.type !== 'all_actionable') {
        return selected
          .filter((table) => table.state === 'active' || (table.state === 'migrating' && table.phase === 'parked'))
          .map(planItemForTable)
      }

      const { getAppServices } = await import('../../../../src/core/app-services')
      const search = getAppServices().search
      const listedNames = await engineTableNames(search)
      const repairable: SearchRepairTableState[] = []
      for (const table of selected) {
        if (table.state === 'migrating' && table.phase === 'parked') {
          repairable.push(table)
          continue
        }
        if (table.state === 'active' && await confirmedMissing(search, table.physical, listedNames)) {
          repairable.push(table)
        }
      }
      return repairable.map(planItemForTable)
    },
    async apply(items) {
      if (items.length === 0) return []
      try {
        const { listTableStates } = await import('@bakin/core/search/tables')
        const { rebuildRegisteredTables } = await import('../../../../src/core/search-registry')
        const { getAppServices } = await import('../../../../src/core/app-services')
        const search = getAppServices().search

        const tablesByLogical = new Map(listTableStates().map((table) => [table.logical, table]))
        const processed = new Set<string>()
        const outcomes: HealthRepairApplyResult[] = []

        for (const item of items) {
          try {
            const logical = logicalTableFromPlanItem(item)
            if (processed.has(logical)) {
              outcomes.push(repairResult(item, 'skipped', `${logical} was already handled by this repair.`))
              continue
            }
            processed.add(logical)

            const table = tablesByLogical.get(logical)
            if (!table) {
              outcomes.push(repairResult(item, 'skipped', `${logical} is no longer registered.`))
              continue
            }

            let needsRebuild = table.state === 'migrating' && table.phase === 'parked'
            if (table.state === 'active') {
              needsRebuild = await confirmedMissing(search, table.physical)
            }
            if (!needsRebuild) {
              outcomes.push(repairResult(item, 'skipped', `${logical} no longer needs rebuilding (or is unreadable rather than missing — restart the engine instead).`))
              continue
            }

            const [result] = await rebuildRegisteredTables(logical)
            const message = `${logical}: ${result?.error ?? result?.result ?? 'no registered definition'}`
            const failed = !result || Boolean(result.error) || result.result === 'parked' || result.result === 'failed'
            outcomes.push(repairResult(item, failed ? 'failed' : 'applied', message))
          } catch (err) {
            outcomes.push(repairResult(item, 'failed', err instanceof Error ? err.message : String(err)))
          }
        }
        return outcomes
      } catch (err) {
        return items.map((item) => repairResult(item, 'failed', err instanceof Error ? err.message : String(err)))
      }
    },
  }
}
