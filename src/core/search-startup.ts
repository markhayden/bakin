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

/**
 * Backoff schedule for deferred bootstrap retries. A single retry used to be
 * the whole story: two transient failures (antfly slow to accept connections,
 * a momentary 500 during table create) left the process with tables missing
 * and the warm signal stuck on 'cold' until a manual restart — even after
 * antfly recovered seconds later.
 */
export const SEARCH_STARTUP_RETRY_SCHEDULE_MS: readonly number[] = [
  SEARCH_STARTUP_RETRY_MS,
  15_000,
  60_000,
  300_000,
]

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
 * How long the server boot is willing to WAIT on the first bootstrap attempt.
 * The attempt itself keeps running past this — table ops against a wedged
 * antfly have no client-side cancellation — but the boot proceeds and the
 * server starts serving. Field-verified failure mode: antfly stuck in a
 * `provisioned startup catch-up failed ... error.FileNotFound` retry loop
 * held a table call open forever and the whole server sat silent at
 * "Loading plugins" — no UI, no logs, no recovery without a kill.
 */
export const SEARCH_BOOTSTRAP_BOOT_BUDGET_MS = 10_000

let bootstrapSettle: ((ready: boolean) => void) | null = null
const bootstrapSettled: Promise<boolean> = new Promise((resolve) => {
  bootstrapSettle = resolve
})

/**
 * Resolves true once the search bootstrap (table creation + reconciles) has
 * actually succeeded, false when it gave up for this process lifetime.
 * Boot-time writers (e.g. the memory backfill) MUST await this before writing:
 * writing into missing tables silently drops rows while byte offsets advance —
 * the exact failure that once produced a permanently empty dashboard.
 */
export function whenSearchBootstrapSettled(): Promise<boolean> {
  return bootstrapSettled
}

/**
 * Run the search bootstrap; if table setup isn't ready, retry on the backoff
 * schedule until it succeeds or the schedule is exhausted. Fire-and-forget —
 * never throws into the boot path, and never holds the boot longer than
 * SEARCH_BOOTSTRAP_BOOT_BUDGET_MS (the attempt continues in the background).
 */
export async function bootSearch(migration: SearchMigrationResult): Promise<void> {
  const onReady = () => {
    bootstrapSettle?.(true)
    // Warm the query-embedding path up front so the first user search isn't a
    // 15s cold-compile dead query; the warm state is surfaced via search-status.
    void import('./search-warmup')
      .then(({ warmSearchQueryPath }) => warmSearchQueryPath())
      .catch((err) => log.warn('Search warm-up failed', err))
    void logSearchHealthSummary().catch((err) => log.warn('Search health summary failed', err))
  }

  const scheduleRetry = (attempt: number) => {
    if (attempt >= SEARCH_STARTUP_RETRY_SCHEDULE_MS.length) {
      log.error('Search startup bootstrap gave up after all retries — search stays paused until restart', {
        attempts: SEARCH_STARTUP_RETRY_SCHEDULE_MS.length + 1,
      })
      bootstrapSettle?.(false)
      return
    }
    setTimeout(() => {
      runSearchStartupBootstrap(migration, { retry: true }).then((retried) => {
        if (retried) {
          onReady()
          return
        }
        scheduleRetry(attempt + 1)
      }).catch((err) => {
        log.warn('Deferred search startup retry failed', err)
        scheduleRetry(attempt + 1)
      })
    }, SEARCH_STARTUP_RETRY_SCHEDULE_MS[attempt]).unref?.()
  }

  // Retries only ever start after the previous attempt SETTLES — overlapping
  // ensureRegisteredTables runs would race table creation against itself.
  const attempt = runSearchStartupBootstrap(migration)
  const outcome = await Promise.race([
    attempt,
    new Promise<'boot-budget-exceeded'>((resolve) => {
      const timer = setTimeout(() => resolve('boot-budget-exceeded'), SEARCH_BOOTSTRAP_BOOT_BUDGET_MS)
      timer.unref?.()
    }),
  ])

  if (outcome === true) {
    onReady()
    return
  }
  if (outcome === false) {
    scheduleRetry(0)
    return
  }

  // Boot budget exceeded: let the server come up now; settle in the background.
  log.warn(
    `Search bootstrap still running after ${SEARCH_BOOTSTRAP_BOOT_BUDGET_MS}ms — continuing boot; search is degraded until it settles. If this repeats, antfly is likely wedged (check its startup catch-up log lines).`,
  )
  attempt.then((ready) => {
    if (ready) {
      onReady()
      return
    }
    scheduleRetry(0)
  }).catch((err) => {
    log.warn('Search bootstrap failed after boot continued', err)
    scheduleRetry(0)
  })
}
