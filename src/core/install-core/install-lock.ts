/**
 * The legacy throw-on-busy face of the `install-state` operation resource
 * (#895, D23). The lock itself — `~/.bakin/install.lock`, O_EXCL acquisition,
 * holder metadata, stale reclaim and the ONE ownership context — lives in
 * `@bakin/core/operations` (resources.ts). This module keeps the API the
 * not-yet-converted writers call (packs, plugins, plugin assets share
 * `~/.bakin/bin`) until PR4 converts them and deletes it.
 *
 * Ownership model: an outer operation acquires (`withInstallLock`, or an
 * operation that declares `install-state`); nested calls in the holder's own
 * async continuation are reentrant; inner writers call
 * `assertInstallLockHeld(name)`, satisfied only inside that continuation. A
 * sibling request contends exactly like a second process and is refused.
 */
import {
  heldInContext,
  isResourceHeld,
  releaseResource,
  resourceLockPath,
  runHolding,
  tryAcquireResources,
} from '@bakin/core/operations'

const RESOURCE = 'install-state'

/** Thrown when another operation (this process or another) holds the lock — routes map it to 409. */
export class InstallLockBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InstallLockBusyError'
  }
}

export function isInstallLockBusy(err: unknown): err is InstallLockBusyError {
  return err instanceof InstallLockBusyError
}

export function getInstallLockPath(): string {
  return resourceLockPath(RESOURCE)
}

export function acquireInstallLock(): void {
  const result = tryAcquireResources([RESOURCE], { title: 'Install' })
  if ('busy' in result) {
    const { holder } = result.busy
    throw new InstallLockBusyError(
      `Another install is in progress (pid ${holder.pid}, since ${holder.acquiredAt || 'now'}). ` +
        `Wait for it to finish, or remove ${getInstallLockPath()} if the holding process is gone.`,
    )
  }
}

export function releaseInstallLock(): void {
  releaseResource(RESOURCE)
}

/** True when SOME live process holds the lock (this one or another). */
export function isInstallLockHeld(): boolean {
  return isResourceHeld(RESOURCE)
}

/**
 * Inner writers (bin installers, projections) call this instead of
 * acquiring. It is satisfied only inside the async continuation of the
 * operation that holds `install-state` — never by a sibling operation.
 */
export function assertInstallLockHeld(writer: string): void {
  if (!heldInContext(RESOURCE)) {
    throw new Error(`${writer} requires the install lock — the outer operation must acquire it (withInstallLock)`)
  }
}

/**
 * Run `fn` under the install lock. Reentrant within the SAME operation; a
 * second independent operation in this process is refused while the first
 * holds the lock, exactly as a second process would be.
 */
export async function withInstallLock<T>(fn: () => Promise<T>): Promise<T> {
  if (heldInContext(RESOURCE)) return fn()
  acquireInstallLock()
  try {
    return await runHolding([RESOURCE], fn)
  } finally {
    releaseInstallLock()
  }
}
