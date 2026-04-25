/**
 * Advisory install lock at ~/.bakin/packages/.lock — prevents two
 * concurrent `bakin agents install` invocations from racing on the
 * lockfile or overlapping projection targets.
 *
 * Release semantics: best-effort cleanup. Process exit removes the
 * lock automatically because we hold it through the lifetime of a
 * single `acquireInstallLock()` → `releaseInstallLock()` pair, never
 * across requests. Stale locks (left over from a crashed process)
 * are detected via PID liveness check.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { getInstallLockFile, getPackagesRoot } from '../../../packages/core/src/agent-packages/package-paths'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'

const log = createLogger('agent-pkg:install-lock')

interface LockContents {
  pid: number
  acquiredAt: string
}

function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 to a pid is a no-op on the receiving end but throws
    // ESRCH if the pid doesn't exist. Standard liveness check on POSIX.
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return code !== 'ESRCH'
  }
}

/**
 * Acquire the advisory lock. Throws if another live process holds it.
 * If a stale lock exists (its pid is no longer alive), claim it and log.
 */
export function acquireInstallLock(): void {
  const lockPath = getInstallLockFile(getContentDir())
  mkdirSync(getPackagesRoot(getContentDir()), { recursive: true })

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
    })
  }

  const contents: LockContents = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  }
  writeFileSync(lockPath, JSON.stringify(contents, null, 2), 'utf-8')
}

/**
 * Release the advisory lock. Idempotent — repeated calls are no-ops.
 * Safe to call from a finally block whether the install succeeded or
 * threw.
 */
export function releaseInstallLock(): void {
  const lockPath = getInstallLockFile(getContentDir())
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

/**
 * True iff the install lock is currently held by ANY process (alive or stale).
 * Used by tests + diagnostic UI; not for control-flow inside install.
 */
export function isInstallLockHeld(): boolean {
  return existsSync(getInstallLockFile(getContentDir()))
}

// Ensure dirname is referenced so the import isn't dropped by tree-shaking
// if a future refactor stops using it. Defensive and trivial.
void dirname
