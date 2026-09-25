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
 * Ownership model: the OUTER operation acquires (`withInstallLock` is
 * reentrant within the process, so a sync called from an update does not
 * try to lock twice); inner writers call `assertInstallLockHeld(name)` and
 * never acquire.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'fs'
import { dirname, join } from 'path'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'

const log = createLogger('install-core:lock')

interface LockContents {
  pid: number
  acquiredAt: string
}

/** True while THIS process holds the lock (set by acquire, cleared by release). */
let heldByThisProcess = false

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
    throw new Error(
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
      throw new Error(
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
  throw new Error(`Could not acquire the install lock at ${lockPath} (contended)`)
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

/** Inner writers (bin installers, projections) call this instead of acquiring. */
export function assertInstallLockHeld(writer: string): void {
  if (!heldByThisProcess) {
    throw new Error(`${writer} requires the install lock — the outer operation must acquire it (withInstallLock)`)
  }
}

/**
 * Run `fn` under the install lock. Reentrant: when this process already
 * holds it, `fn` runs directly and the outer holder keeps the lock.
 */
export async function withInstallLock<T>(fn: () => Promise<T>): Promise<T> {
  if (heldByThisProcess) return fn()
  acquireInstallLock()
  try {
    return await fn()
  } finally {
    releaseInstallLock()
  }
}
