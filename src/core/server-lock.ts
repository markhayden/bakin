/**
 * Server singleton lock — two Bakin server processes can never run against
 * one content dir. Orphaned half-dead generations (dual `bakin start`,
 * launchd respawn over a wedged process — #459) each ran their own dispatch
 * loop and doubled work; the lock makes the second process refuse loudly
 * before any side effect starts.
 *
 * Lock file: ~/.bakin/server.lock — { pid, port, startedAt, bootId }.
 * A live holder refuses acquisition; a stale lock (dead pid) or corrupt
 * file is replaced. Acquisition uses exclusive create (wx) with one
 * stale-sweep retry.
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { getContentDir } from './content-dir'
import { createLogger } from './logger'

const log = createLogger('server-lock')

export interface ServerLock {
  pid: number
  port: number
  startedAt: number
  bootId: string
}

function lockPath(): string {
  return join(getContentDir(), 'server.lock')
}

export function readServerLock(): ServerLock | null {
  try {
    if (!existsSync(lockPath())) return null
    const parsed = JSON.parse(readFileSync(lockPath(), 'utf-8')) as Partial<ServerLock>
    if (typeof parsed.pid !== 'number') return null
    return {
      pid: parsed.pid,
      port: typeof parsed.port === 'number' ? parsed.port : 0,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
      bootId: typeof parsed.bootId === 'string' ? parsed.bootId : '',
    }
  } catch {
    return null // corrupt → treated as stale
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM = the process exists but belongs to another user — alive.
    // ESRCH = no such process — dead.
    return (err as { code?: string }).code === 'EPERM'
  }
}

export type AcquireResult = { acquired: true } | { acquired: false; holder: ServerLock }

export function acquireServerLock(port: number, bootId: string): AcquireResult {
  const payload = JSON.stringify({ pid: process.pid, port, startedAt: Date.now(), bootId } satisfies ServerLock, null, 2)

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath(), payload, { encoding: 'utf-8', flag: 'wx' })
      return { acquired: true }
    } catch {
      const holder = readServerLock()
      // Live holder that isn't us → refuse. Our own pid re-acquiring is
      // fine (in-process restart / HMR re-evaluation).
      if (holder && holder.pid !== process.pid && isPidAlive(holder.pid)) {
        return { acquired: false, holder }
      }
      // Stale (dead pid) or corrupt — sweep and retry the exclusive create.
      log.warn('Replacing stale server lock', { stalePid: holder?.pid ?? null })
      try {
        unlinkSync(lockPath())
      } catch {
        // raced with another sweeper; the retry's wx decides
        log.debug('Stale lock already removed by a concurrent sweeper')
      }
    }
  }
  // Two sweep attempts lost the wx race both times — someone else acquired.
  const holder = readServerLock()
  return holder ? { acquired: false, holder } : { acquired: false, holder: { pid: -1, port, startedAt: 0, bootId: '' } }
}

/** Removes the lock iff this process owns it. Safe to call repeatedly. */
export function releaseServerLock(): void {
  const holder = readServerLock()
  if (!holder || holder.pid !== process.pid) return
  try {
    unlinkSync(lockPath())
  } catch (err) {
    log.warn('Failed to release server lock', { err: err instanceof Error ? err.message : String(err) })
  }
}

/** Operator guidance when a port is squatted by a non-Bakin process. */
export function formatBindFailureHelp(port: number): string {
  return `Port ${port} is already in use. Find the holder with: lsof -nP -iTCP:${port} -sTCP:LISTEN`
}
