/**
 * Search engine boot — deliberately near-empty (spec D5).
 *
 * `startSearchEngine()` ensures registered tables exist in the blue/green
 * registry (a matching registry row is ZERO adapter calls) and resumes any
 * migration a crash or park left in flight. That's it: no reconcile, no
 * warming, no scans. Writes recover through the durable outbox; deep
 * consistency is the doctor's orphan sweep; health verdicts are the
 * doctor's job.
 *
 * The boot-budget/retry shape survives because a wedged engine must never
 * brick the server boot (field-verified failure: a stuck table call held
 * the whole process at "Loading plugins" with no port open).
 */
import { createLogger } from './logger'

const log = createLogger('search-startup')

/** First retry delay after a failed bootstrap attempt. */
export const SEARCH_STARTUP_RETRY_MS = 5_000

export const SEARCH_STARTUP_RETRY_SCHEDULE_MS: readonly number[] = [
  SEARCH_STARTUP_RETRY_MS,
  15_000,
  60_000,
  300_000,
]

/**
 * How long the server boot WAITS on the first attempt. The attempt keeps
 * running past this (no client-side cancellation against a wedged engine),
 * but the boot proceeds and the server starts serving.
 */
export const SEARCH_BOOTSTRAP_BOOT_BUDGET_MS = 10_000

async function runBootstrap(opts: { retry?: boolean } = {}): Promise<boolean> {
  const { createRegisteredTables, resumeTableMigrations, startMigrationPump } = await import('./search-registry')

  const tableSetup = await createRegisteredTables()
  if (tableSetup.failures.length > 0) {
    const message = opts.retry
      ? 'Deferred search table setup still failing'
      : 'Search table setup incomplete; retrying on the backoff schedule'
    log.warn(message, { failures: tableSetup.failures })
    return false
  }

  // Finish any blue/green migration a crash or park left in flight —
  // resume of RECORDED work, never filesystem inference. Fire-and-forget:
  // queries answer from the old physical throughout.
  resumeTableMigrations().catch((err: unknown) => {
    log.error('Resuming in-flight table migrations failed', err instanceof Error ? err : undefined)
  })

  // Parked work self-heals from here on — the migrations counterpart of
  // the outbox safety tick (2026-07-21 five-lens review).
  startMigrationPump()

  return true
}

/**
 * Run the bootstrap; if table setup isn't ready, retry on the backoff
 * schedule. Never throws into the boot path; never holds the boot longer
 * than SEARCH_BOOTSTRAP_BOOT_BUDGET_MS.
 */
export async function startSearchEngine(): Promise<void> {
  const scheduleRetry = (attempt: number) => {
    if (attempt >= SEARCH_STARTUP_RETRY_SCHEDULE_MS.length) {
      log.error('Search startup gave up after all retries — table setup stays paused until restart', {
        attempts: SEARCH_STARTUP_RETRY_SCHEDULE_MS.length + 1,
      })
      return
    }
    setTimeout(() => {
      runBootstrap({ retry: true }).then((ready) => {
        if (!ready) scheduleRetry(attempt + 1)
      }).catch((err) => {
        log.warn('Deferred search startup retry failed', err)
        scheduleRetry(attempt + 1)
      })
    }, SEARCH_STARTUP_RETRY_SCHEDULE_MS[attempt]).unref?.()
  }

  // Retries only start after the previous attempt SETTLES — overlapping
  // ensureRegisteredTables runs would race table creation against itself.
  const attempt = runBootstrap()
  const outcome = await Promise.race([
    attempt,
    new Promise<'boot-budget-exceeded'>((resolve) => {
      const timer = setTimeout(() => resolve('boot-budget-exceeded'), SEARCH_BOOTSTRAP_BOOT_BUDGET_MS)
      timer.unref?.()
    }),
  ])

  if (outcome === true) return
  if (outcome === false) {
    scheduleRetry(0)
    return
  }

  log.warn(
    `Search bootstrap still running after ${SEARCH_BOOTSTRAP_BOOT_BUDGET_MS}ms — continuing boot; search is degraded until it settles. If this repeats, the engine is likely wedged.`,
  )
  attempt.then((ready) => {
    if (!ready) scheduleRetry(0)
  }).catch((err) => {
    log.warn('Search bootstrap failed after boot continued', err)
    scheduleRetry(0)
  })
}
