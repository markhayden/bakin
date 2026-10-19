/**
 * Server singleton lock — two Bakin server processes can never run against
 * one content dir. Orphaned half-dead generations (dual `bakin start`,
 * launchd respawn over a wedged process — #459) each ran their own dispatch
 * loop and doubled work; the lock makes the second process refuse loudly
 * before any side effect starts.
 *
 * Lock file: ~/.bakin/server.lock — { pid, port, startedAt, bootId, cliSecret },
 * written 0600. `cliSecret` is fresh per boot and never served over HTTP: a
 * CLI that can read this file proves it is this home's operator, which is
 * what authorizes a service claim (#895 D11).
 * A live holder refuses acquisition; a stale lock (dead pid) or corrupt
 * file is replaced. The lock is published complete via temp + `link`, and a
 * stale one is claimed by rename before it is deleted (see acquireServerLock).
 */
import { randomBytes, timingSafeEqual } from 'crypto'
import { existsSync, linkSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getContentDir } from './content-dir'
import { createLogger } from './logger'

const log = createLogger('server-lock')

export interface ServerLock {
  pid: number
  port: number
  startedAt: number
  bootId: string
  /** Per-boot local secret (#895 D11); absent in a lock written before it existed. */
  cliSecret?: string
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
      ...(typeof parsed.cliSecret === 'string' && parsed.cliSecret ? { cliSecret: parsed.cliSecret } : {}),
    }
  } catch {
    return null // corrupt → treated as stale
  }
}

/**
 * The lock of a server that is actually running for this content dir, or
 * null (no lock, a corrupt one, or a dead pid). The CLI uses it to target its
 * own home's server (#895 D11).
 */
export function readLiveServerLock(): ServerLock | null {
  const lock = readServerLock()
  return lock && isPidAlive(lock.pid) ? lock : null
}

/**
 * Which server a client process talks to (#895 D11) — the ONE rule for the
 * CLI and every core probe that runs outside the server:
 * - an explicit `BAKIN_URL` is used as given (unreachable is an error);
 * - otherwise the live `server.lock` in this home gives the port — a lock
 *   without a valid port is no target;
 * - otherwise no server is running for this home. Never a guess at port
 *   3737, which may belong to another home. (`baseUrl` on `none` is for
 *   display only.)
 */
export interface CliTarget {
  baseUrl: string
  source: 'env' | 'lock' | 'none'
  pid?: number
}

export function resolveCliTarget(
  env: Record<string, string | undefined>,
  lock: Pick<ServerLock, 'pid' | 'port'> | null,
): CliTarget {
  if (env.BAKIN_URL) return { baseUrl: env.BAKIN_URL.replace(/\/+$/, ''), source: 'env' }
  if (lock && Number.isInteger(lock.port) && lock.port > 0) return { baseUrl: `http://localhost:${lock.port}`, source: 'lock', pid: lock.pid }
  return { baseUrl: `http://localhost:${env.PORT || 3737}`, source: 'none' }
}

/** This home's server base URL resolved NOW (re-reads the lock), or null when none runs. */
export function liveServerBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const target = resolveCliTarget(env, readLiveServerLock())
  return target.source === 'none' ? null : target.baseUrl
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

/** The header a CLI presents its home's lock secret in (#895 D11). */
export const CLI_SECRET_HEADER = 'X-Bakin-Cli-Secret'

/** The secret this process wrote into the lock it holds; null until it acquires one. */
let ownCliSecret: string | null = null

/**
 * True when `presented` is the secret in the lock THIS server holds — the
 * proof a request came from a CLI that can read this home's server.lock.
 */
export function cliSecretMatches(presented: string | null | undefined): boolean {
  if (!ownCliSecret || !presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(ownCliSecret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Acquire this home's singleton lock (#898 K hardening):
 *   - the lock is written COMPLETE to a private temp file and published with
 *     `link`, which fails if a lock exists — it is never visible half-written
 *     (a partial file would read as corrupt and be swept as stale);
 *   - a stale lock (dead holder, or corrupt) is CLAIMED by renaming it to a
 *     private name and re-read there: only the exact content judged stale is
 *     deleted. A live lock another starter published in between is linked
 *     back — never removed.
 */
export function acquireServerLock(port: number, bootId: string): AcquireResult {
  const cliSecret = randomBytes(32).toString('hex')
  const payload = JSON.stringify({ pid: process.pid, port, startedAt: Date.now(), bootId, cliSecret } satisfies ServerLock, null, 2)
  const unique = () => `${lockPath()}.${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`

  for (let attempt = 0; attempt < 3; attempt++) {
    const temp = unique()
    // 0600: the secret inside authorizes service claims for this home.
    writeFileSync(temp, payload, { encoding: 'utf-8', flag: 'wx', mode: 0o600 })
    try {
      linkSync(temp, lockPath())
      ownCliSecret = cliSecret
      return { acquired: true }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    } finally {
      unlinkSync(temp)
    }
    const seenText = readText(lockPath())
    if (seenText === null) continue // released meanwhile: try again
    const holder = readServerLock()
    // Live holder that isn't us → refuse. Our own pid re-acquiring is fine
    // (in-process restart / HMR re-evaluation).
    if (holder && holder.pid !== process.pid && isPidAlive(holder.pid)) {
      return { acquired: false, holder }
    }
    // Stale (dead pid), corrupt, or our own: claim the FILE, then judge it.
    const claimed = unique()
    try {
      renameSync(lockPath(), claimed)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue // another sweeper took it
      throw err
    }
    if (readText(claimed) === seenText) {
      log.warn('Replacing stale server lock', { stalePid: holder?.pid ?? null })
      unlinkSync(claimed)
      continue
    }
    // A live lock was published between our read and our rename: put it back.
    try {
      linkSync(claimed, lockPath())
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    unlinkSync(claimed)
    const current = readServerLock()
    return { acquired: false, holder: current ?? { pid: -1, port, startedAt: 0, bootId: '' } }
  }
  // Three attempts lost every race — someone else acquired.
  const holder = readServerLock()
  return holder ? { acquired: false, holder } : { acquired: false, holder: { pid: -1, port, startedAt: 0, bootId: '' } }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** Removes the lock iff this process owns it. Safe to call repeatedly. */
export function releaseServerLock(): void {
  const holder = readServerLock()
  if (!holder || holder.pid !== process.pid) return
  ownCliSecret = null
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
