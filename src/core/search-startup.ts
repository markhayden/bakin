/**
 * Search boot logic, extracted from server.ts so it sits beside search-migration.ts
 * / search-registry.ts and can be unit-tested with mocked registries.
 *
 * `bootSearch` runs the one-shot bootstrap and, if table setup isn't ready yet,
 * schedules a single deferred retry. `runSearchStartupBootstrap` is the bootstrap
 * itself (table creation → reconcile drain → post-migration reindex).
 */
import { createLogger } from './logger'
import { migrateIfNeeded } from './search-migration'

const log = createLogger('search-startup')

export type SearchMigrationResult = Awaited<ReturnType<typeof migrateIfNeeded>>

export const SEARCH_STARTUP_RETRY_MS = 5000

export async function runSearchStartupBootstrap(
  migration: SearchMigrationResult,
  opts: { retry?: boolean } = {},
): Promise<boolean> {
  const {
    createRegisteredTables,
    reindexContentTypes,
    runPendingReconciles,
  } = await import('./search-registry')

  const tableSetup = await createRegisteredTables()
  if (tableSetup.failures.length > 0) {
    const message = opts.retry
      ? 'Deferred search table setup still failing; startup reconcile and reindex remain paused'
      : 'Search table setup incomplete; pausing startup reconcile and reindex until tables are ready'
    log.warn(message, { failures: tableSetup.failures })
    return false
  }

  // Drain any startup reconciles enqueued by registerFileBackedContentType.
  // Tables exist by this point so reconcile scans hit real data. Failures
  // are logged inside the helper and do not block startup.
  await runPendingReconciles()

  // If the schema migration dropped tables, kick off a full background
  // reindex so the freshly-recreated tables get populated with content.
  // Fire-and-forget: Bakin is usable immediately with empty tables;
  // indexing completes in the background and streams progress over SSE.
  if (migration.migrated) {
    const message = opts.retry
      ? 'Running deferred full reindex after schema migration'
      : 'Running full reindex after schema migration'
    log.info(message, {
      from: migration.from,
      to: migration.to,
    })
    reindexContentTypes().then((results) => {
      const total = results.reduce((sum: number, r) => sum + (r.indexed || 0), 0)
      log.info('Schema migration reindex complete', { tables: results.length, total })
    }).catch((err) => {
      log.error('Schema migration reindex failed', err)
    })
  }

  return true
}

// How long the startup health summary waits for the normal post-boot
// convergence (loading persisted vectors, draining any backfill) to settle
// before logging its verdict. Indexes stay queryable throughout.
const SEARCH_HEALTH_SETTLE_TIMEOUT_MS = 90_000
const SEARCH_HEALTH_POLL_MS = 5000

/**
 * After boot, log ONE clear verdict on search health so you can tell at a glance
 * whether anything needs a reindex or repair — instead of having to read raw
 * per-index rebuilding/backfill flags. Waits for the normal startup convergence
 * to settle (or a timeout), then reports: healthy, or exactly which tables are
 * EMPTY (need a reindex), FAILED (enrichment error), or still converging
 * (transient, no action). Fire-and-forget; never throws into the boot path.
 */
export async function logSearchHealthSummary(): Promise<void> {
  const { getSearchHealth } = await import('./search-registry')
  const deadline = Date.now() + SEARCH_HEALTH_SETTLE_TIMEOUT_MS
  // First-observed indexed count per still-building table, so we can tell a
  // backfill that is PROGRESSING (just slow) from one that is STALLED (frozen
  // — needs a reindex to finish embedding).
  const firstIndexed = new Map<string, number>()

  while (true) {
    let health: Awaited<ReturnType<typeof getSearchHealth>>
    try {
      health = await getSearchHealth()
    } catch (err) {
      log.warn('Search health summary unavailable', err)
      return
    }
    if (!health.enabled) {
      log.warn('⚠ Search backend is DISABLED — search is unavailable until it is re-enabled in settings')
      return
    }

    type Building = { table: string; indexed: number; expected: number; pct: number }
    const failed: string[] = []
    const empty: string[] = []
    const building: Building[] = []
    let ready = 0
    let totalDocs = 0
    for (const t of health.tables) {
      const idx = t.indexHealth ?? []
      if (idx.length === 0) continue // no index status reported — can't classify
      const indexed = Math.max(0, ...idx.map((i) => i.totalIndexed ?? 0))
      totalDocs += indexed
      const errored = idx.find((i) => i.error)
      const dense = idx.filter((i) => i.type === 'embeddings')
      const stillBuilding = idx.some((i) => i.rebuilding || (i.walBacklog ?? 0) > 0 || (i.backfillProgress ?? 1) < 1)
      if (errored) {
        failed.push(`${t.table} (${errored.error})`)
      } else if (stillBuilding) {
        const pct = Math.round(Math.min(1, Math.min(...dense.map((i) => i.backfillProgress ?? 1))) * 100)
        building.push({ table: t.table, indexed, expected: indexed, pct })
        if (!firstIndexed.has(t.table)) firstIndexed.set(t.table, indexed)
      } else if (indexed === 0) {
        empty.push(t.table)
      } else {
        ready++
      }
    }

    // Keep waiting while indexes are still building, up to the ceiling.
    if (building.length > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, SEARCH_HEALTH_POLL_MS))
      continue
    }

    // Split still-building tables into progressing (slow, fine) vs stalled
    // (no progress over the observation window — needs a reindex).
    const stalled = building.filter((b) => b.indexed <= (firstIndexed.get(b.table) ?? 0))
    const converging = building.filter((b) => b.indexed > (firstIndexed.get(b.table) ?? 0))

    const n = health.tables.length
    if (failed.length === 0 && empty.length === 0 && building.length === 0) {
      log.info(`✓ Search healthy — ${ready}/${n} tables ready, ${totalDocs.toLocaleString()} docs indexed. No reindex needed.`)
      return
    }
    if (failed.length > 0) {
      log.warn(`⚠ Search: ${failed.length} table(s) FAILED enrichment — ${failed.join('; ')}. Reindex them (Health tab → ⟳, or 'bakin reindex --table <name>') and check the embedder/model.`)
    }
    if (empty.length > 0) {
      log.warn(`⚠ Search: ${empty.length} table(s) indexed 0 docs and need a reindex — ${empty.join(', ')} (Health tab → ⟳ per table, or 'bakin reindex --table <name>').`)
    }
    if (stalled.length > 0) {
      log.warn(`⚠ Search: ${stalled.length} table(s) have a STALLED embedding backfill (not progressing — semantic search is incomplete; full-text still works). Reindex to finish embedding: ${stalled.map((b) => `${b.table} (${b.pct}%)`).join(', ')}.`)
    }
    if (converging.length > 0) {
      log.info(`Search still converging (progressing, queryable now, no action): ${converging.map((b) => `${b.table} (${b.pct}%)`).join(', ')}.`)
    }
    log.info(`Search status — ready ${ready}/${n}, ${totalDocs.toLocaleString()} docs indexed.`)
    return
  }
}

/**
 * Run the search bootstrap once; if table setup isn't ready, schedule a single
 * deferred retry SEARCH_STARTUP_RETRY_MS later. Fire-and-forget — never throws
 * into the boot path.
 */
export async function bootSearch(migration: SearchMigrationResult): Promise<void> {
  const ready = await runSearchStartupBootstrap(migration)
  if (ready) {
    void logSearchHealthSummary().catch((err) => log.warn('Search health summary failed', err))
    return
  }
  setTimeout(() => {
    runSearchStartupBootstrap(migration, { retry: true }).then((retried) => {
      if (retried) void logSearchHealthSummary().catch((err) => log.warn('Search health summary failed', err))
    }).catch((err) => {
      log.warn('Deferred search startup retry failed', err)
    })
  }, SEARCH_STARTUP_RETRY_MS)
}
