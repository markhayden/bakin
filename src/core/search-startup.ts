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

    // Verdict on REAL signals only: genuine enrichment failures (embedder worker
    // dead / fatal embed errors / dead backfill — surfaced as indexHealth.error)
    // and docs still pending embedding (walBacklog). Deliberately NOT inferred by
    // comparing index doc-counts — those legitimately differ (stale orphans,
    // empty/partial templates, field projections) and produced false "stall"
    // alarms that sent us chasing ghosts.
    const failed: string[] = []
    const pendingTables: string[] = []
    let totalDocs = 0
    for (const t of health.tables) {
      const idx = t.indexHealth ?? []
      if (idx.length === 0) continue
      totalDocs += Math.max(0, ...idx.map((i) => i.totalIndexed ?? 0))
      const errored = idx.find((i) => i.error)
      if (errored) failed.push(`${t.table} (${errored.error})`)
      else if (idx.some((i) => (i.walBacklog ?? 0) > 0)) pendingTables.push(t.table)
    }

    // Let transient "still embedding" drain before the verdict, up to the ceiling.
    if (failed.length === 0 && pendingTables.length > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, SEARCH_HEALTH_POLL_MS))
      continue
    }

    const n = health.tables.length
    if (failed.length === 0 && pendingTables.length === 0) {
      log.info(`✓ Search healthy — ${n} tables, ${totalDocs.toLocaleString()} docs indexed. No enrichment errors.`)
      return
    }
    if (failed.length > 0) {
      log.warn(`⚠ Search: ${failed.length} table(s) have ENRICHMENT errors — semantic search is incomplete there (full-text still works): ${failed.join('; ')}. Rebuild the index (Health tab → ⟳) and check the embedder/model.`)
    }
    if (pendingTables.length > 0) {
      log.info(`Search still embedding (queryable now, no action): ${pendingTables.join(', ')}.`)
    }
    log.info(`Search status — ${n} tables, ${totalDocs.toLocaleString()} docs indexed.`)
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
