/**
 * Post-listen startup recovery — the ordered ledger/recovery sequence that runs
 * once the HTTP server is accepting traffic. Extracted from server.ts so its
 * invariants live in one reviewable place.
 *
 * Ordering contracts (must not change):
 *   1. Startup sweep (mark prior-boot runs lost) runs BEFORE restart recovery —
 *      otherwise stale 'running' claims suppress every legitimate re-dispatch.
 *   2. dispatch.start + watchdog.start run in a `finally` so they start even if
 *      restart recovery throws.
 *   3. doctor.start runs in a `finally` after the post-recovery dispatch.
 *
 * Fire-and-forget from the listen callback (`void runStartupRecovery(...)`);
 * every step swallows its own errors so boot is never blocked.
 */
import { createLogger } from '../logger'
import { getBootId } from '../boot-id'
import { markPriorBootRunsLost } from '../execution-ledger'
import { backfillMissingCompletionRows } from '../task-service'
import { runRestartRecovery } from '../restart-recovery'
import * as dispatch from '../dispatch'
import * as watchdog from '../watchdog'
import * as doctor from '../doctor'

const log = createLogger('startup-recovery')

export async function runStartupRecovery(contentDir: string, port: number): Promise<void> {
  // Startup sweep BEFORE restart recovery: runs left 'running' by a
  // crashed/previous process are marked lost, or their stale claims
  // would suppress every legitimate re-dispatch below.
  try {
    const swept = markPriorBootRunsLost(getBootId())
    if (swept > 0) log.info('Startup sweep: marked prior-boot runs lost', { swept })
  } catch (err) {
    log.error('Startup run sweep failed — stale claims may suppress dispatch until resolved', err)
  }

  // Ledger heal: done tasks without a completions row (pre-ledger history, or
  // rows lost to since-fixed leak paths) get synthetic rows so "row ⟺ done"
  // holds for every reader. Idempotent — a failure must not block boot, it
  // just retries next start.
  try {
    const healed = backfillMissingCompletionRows()
    if (healed > 0) log.info('Completion backfill: synthetic rows recorded for done tasks', { healed })
  } catch (err) {
    log.error('Completion backfill failed', err)
  }

  let recovered = 0
  try {
    const result = await runRestartRecovery(contentDir)
    recovered = result.recovered
  } catch (err) {
    log.error('Restart recovery failed', err)
  } finally {
    dispatch.start(contentDir, port)
    watchdog.start(contentDir)
  }

  try {
    if (recovered > 0) {
      await dispatch.dispatchTasks(contentDir, port)
    }
  } catch (err) {
    log.error('Post-recovery dispatch failed', err)
  } finally {
    doctor.start(contentDir, process.cwd())
  }

  if (process.env.BAKIN_SEED_USAGE === '1') {
    // Dev-only imitation-crab seed. Two gates: the env flag AND the dev/ tree
    // existing on a real filesystem. The specifier is computed at runtime so
    // `bun build --compile` can't statically bundle dev/ into release
    // binaries (the old static string did — audit P2 #25), and inside a
    // compiled binary this module resolves under /$bunfs where the existsSync
    // probe fails, so the flag is inert there.
    const { fileURLToPath } = await import('node:url')
    const { existsSync } = await import('node:fs')
    const { dirname, join, resolve } = await import('node:path')
    let here = ''
    try { here = fileURLToPath(import.meta.url) } catch { /* non-file URL: stay gated off */ }
    const repoRoot = here ? resolve(dirname(here), '..', '..', '..') : ''
    const seedModule = repoRoot ? join(repoRoot, 'dev', 'imitation-crab', 'usage-seed.ts') : ''
    if (seedModule && existsSync(seedModule)) {
      import(seedModule)
        .then(m => (m as { seedMockUsage: () => void }).seedMockUsage())
        .catch(err => log.warn('Mock usage seed failed', err))
    } else {
      log.warn('BAKIN_SEED_USAGE=1 ignored — dev/imitation-crab is not present (compiled binary or trimmed tree)')
    }
  }
}
