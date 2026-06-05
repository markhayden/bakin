/**
 * Advisory install lock at ~/.bakin/packages/.lock — prevents two concurrent
 * `bakin agents install` / `bakin packages install` invocations from racing on
 * the lockfile or overlapping projection targets.
 *
 * Thin wrapper over the shared install-core lock primitive (Whiskit P5). The
 * agent lock path and this module's public API (acquire/release/isHeld) are
 * preserved exactly; the mechanics live in `install-core/install-lock`.
 */
import { getInstallLockFile } from '../../../packages/core/src/agent-packages/package-paths'
import { getContentDir } from '../content-dir'
import { acquireLock, isLockHeld, releaseLock } from '../install-core/install-lock'

function agentInstallLockPath(): string {
  return getInstallLockFile(getContentDir())
}

/**
 * Acquire the advisory lock. Throws if another live process holds it. A stale
 * lock (holder pid gone) is claimed with a warning.
 */
export function acquireInstallLock(): void {
  acquireLock(agentInstallLockPath())
}

/**
 * Release the advisory lock. Idempotent — repeated calls are no-ops. Safe to
 * call from a finally block whether the install succeeded or threw.
 */
export function releaseInstallLock(): void {
  releaseLock(agentInstallLockPath())
}

/**
 * True iff the install lock is currently held by ANY process (alive or stale).
 * Used by tests + diagnostic UI; not for control-flow inside install.
 */
export function isInstallLockHeld(): boolean {
  return isLockHeld(agentInstallLockPath())
}
