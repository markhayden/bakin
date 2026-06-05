/**
 * Advisory install-lock primitive for the install core.
 *
 * A per-path lock file holding the owner's pid + timestamp. Acquiring while a
 * LIVE process holds the lock throws; a stale lock (holder pid gone, or an
 * unparseable file) is claimed with a warning. Release is best-effort and
 * idempotent. Process exit drops the lock implicitly because it is held only
 * across a single acquire→release pair, never across requests.
 *
 * Extracted from the agent-package install lock — the proven reference — so the
 * plugin install path can take the same concurrency guarantee in Phase 6
 * (plugins currently have no install lock). Part of the Whiskin shared install
 * core (Phase 5).
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { createLogger } from '../logger'

const log = createLogger('install-core:lock')

interface LockContents {
  pid: number
  acquiredAt: string
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 is a no-op delivery check; throws ESRCH if the pid is gone.
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/**
 * Acquire the advisory lock at `lockPath`. Creates the parent dir. Throws if
 * another live process holds it; claims (with a warning) if the existing lock
 * is stale or unparseable.
 */
export function acquireLock(lockPath: string): void {
  mkdirSync(dirname(lockPath), { recursive: true })

  if (existsSync(lockPath)) {
    let parsed: LockContents | null = null
    try {
      parsed = JSON.parse(readFileSync(lockPath, 'utf-8'))
    } catch {
      // Malformed lock file — treat as stale and overwrite.
    }
    if (parsed && isProcessAlive(parsed.pid)) {
      throw new Error(
        `Another install is in progress (pid ${parsed.pid}, since ${parsed.acquiredAt}). ` +
          `Wait for it to finish, or remove ${lockPath} if the holding process is gone.`,
      )
    }
    log.warn('Stale install lock found — claiming it', {
      stalePid: parsed?.pid ?? 'unparseable',
      lockPath,
    })
  }

  const contents: LockContents = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  }
  writeFileSync(lockPath, JSON.stringify(contents, null, 2), 'utf-8')
}

/** Release the lock at `lockPath`. Idempotent; best-effort on failure. */
export function releaseLock(lockPath: string): void {
  if (!existsSync(lockPath)) return
  try {
    unlinkSync(lockPath)
  } catch (err) {
    log.warn('Failed to release install lock', {
      lockPath,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** True iff a lock file exists at `lockPath` (held by any process, alive or stale). */
export function isLockHeld(lockPath: string): boolean {
  return existsSync(lockPath)
}
