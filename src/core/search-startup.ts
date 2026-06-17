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

/**
 * Run the search bootstrap once; if table setup isn't ready, schedule a single
 * deferred retry SEARCH_STARTUP_RETRY_MS later. Fire-and-forget — never throws
 * into the boot path.
 */
export async function bootSearch(migration: SearchMigrationResult): Promise<void> {
  const ready = await runSearchStartupBootstrap(migration)
  if (!ready) {
    setTimeout(() => {
      runSearchStartupBootstrap(migration, { retry: true }).catch((err) => {
        log.warn('Deferred search startup retry failed', err)
      })
    }, SEARCH_STARTUP_RETRY_MS)
  }
}
