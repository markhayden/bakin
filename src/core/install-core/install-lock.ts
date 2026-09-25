/**
 * THE install lock — one file, `~/.bakin/install.lock`, for every writer of
 * Bakin's install state: capability packs (install/update/sync/remove),
 * plugins (install/upgrade/remove) and the plugin-assets repair. They share
 * `~/.bakin/bin`, so they must exclude each other; two lock paths (packs
 * had `packages/.lock`, artifact upgrades had `plugins/.install.lock`) never
 * did.
 *
 * Acquisition is atomic across processes: `openSync(path, 'wx')` (O_EXCL)
 * creates the file or fails with EEXIST — never check-then-write. A file
 * whose recorded pid is dead is reclaimed. Only the holder pid releases.
 *
 * Ownership model: the OUTER operation acquires via `withInstallLock`, which
 * is reentrant only within THAT operation's async continuation
 * (AsyncLocalStorage — a sync called from an update does not lock twice, but
 * an unrelated request arriving while the lock is held contends exactly like
 * a second process and is refused). Inner writers call
 * `assertInstallLockHeld(name)`, which is satisfied only inside a
 * `withInstallLock` body, and never acquire.
 */
import { AsyncLocalStorage } from 'async_hooks'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'fs'
import { dirname, join } from 'path'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'

const log = createLogger('install-core:lock')

interface LockContents {
  pid: number
  acquiredAt: string
}

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

/** True while THIS process holds the lock (set by acquire, cleared by release). */
let heldByThisProcess = false

/** The async operation that holds the lock — set for the continuation of a `withInstallLock` body only. */
const holdingOperation = new AsyncLocalStorage<{ readonly token: symbol }>()

export function getInstallLockPath(): string {
  return join(getContentDir(), 'install.lock')
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function readHolder(lockPath: string): LockContents | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf-8')) as Partial<LockContents>
    return typeof parsed.pid === 'number' ? { pid: parsed.pid, acquiredAt: String(parsed.acquiredAt ?? '') } : null
  } catch {
    return null
  }
}

function tryCreateExclusive(lockPath: string): boolean {
  let fd: number
  try {
    fd = openSync(lockPath, 'wx')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  }
  try {
    const contents: LockContents = { pid: process.pid, acquiredAt: new Date().toISOString() }
    writeSync(fd, JSON.stringify(contents, null, 2))
  } finally {
    closeSync(fd)
  }
  return true
}

export function acquireInstallLock(): void {
  const lockPath = getInstallLockPath()
  if (heldByThisProcess) {
    // Two operations in ONE process (e.g. two concurrent REST installs in the
    // server) contend exactly like two processes do — same refusal, same
    // words; inner writers of a held operation never reach here (they assert).
    const holder = readHolder(lockPath)
    throw new InstallLockBusyError(
      `Another install is in progress (pid ${process.pid}, since ${holder?.acquiredAt ?? 'now'}). ` +
        'Wait for it to finish.',
    )
  }
  mkdirSync(dirname(lockPath), { recursive: true })

  // Bounded: a stale file is reclaimed once; a live holder is refused.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (tryCreateExclusive(lockPath)) {
      heldByThisProcess = true
      return
    }
    const holder = readHolder(lockPath)
    if (holder && isProcessAlive(holder.pid)) {
      throw new InstallLockBusyError(
        `Another install is in progress (pid ${holder.pid}, since ${holder.acquiredAt}). ` +
          `Wait for it to finish, or remove ${lockPath} if the holding process is gone.`,
      )
    }
    log.warn('Stale install lock found — claiming it', { stalePid: holder?.pid ?? 'unparseable', lockPath })
    try {
      unlinkSync(lockPath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
  throw new InstallLockBusyError(`Could not acquire the install lock at ${lockPath} (contended)`)
}

export function releaseInstallLock(): void {
  const lockPath = getInstallLockPath()
  if (!existsSync(lockPath)) {
    heldByThisProcess = false
    return
  }
  const holder = readHolder(lockPath)
  if (holder && holder.pid !== process.pid && isProcessAlive(holder.pid)) {
    log.warn('Refusing to release an install lock held by another live process', { holderPid: holder.pid, lockPath })
    return
  }
  try {
    unlinkSync(lockPath)
  } catch (err) {
    log.warn('Failed to release install lock', { lockPath, error: err instanceof Error ? err.message : String(err) })
  }
  heldByThisProcess = false
}

/** True when SOME live process holds the lock (this one or another). */
export function isInstallLockHeld(): boolean {
  const lockPath = getInstallLockPath()
  if (!existsSync(lockPath)) return false
  const holder = readHolder(lockPath)
  return holder ? isProcessAlive(holder.pid) : true
}

/**
 * Inner writers (bin installers, projections) call this instead of
 * acquiring. It is satisfied only inside the async continuation of the
 * `withInstallLock` body that holds the lock — never by a sibling operation
 * that merely observes the process-wide flag.
 */
export function assertInstallLockHeld(writer: string): void {
  if (!holdingOperation.getStore()) {
    throw new Error(`${writer} requires the install lock — the outer operation must acquire it (withInstallLock)`)
  }
}

/**
 * Run `fn` under the install lock. Reentrant within the SAME operation
 * (nested calls in the holder's async continuation run directly); a second
 * independent operation in this process is refused while the first holds
 * the lock, exactly as a second process would be.
 */
export async function withInstallLock<T>(fn: () => Promise<T>): Promise<T> {
  if (holdingOperation.getStore()) return fn()
  acquireInstallLock()
  try {
    return await holdingOperation.run({ token: Symbol('install-lock') }, fn)
  } finally {
    releaseInstallLock()
  }
}
