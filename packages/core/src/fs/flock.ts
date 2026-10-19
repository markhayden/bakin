/**
 * An OS advisory lock (`flock(LOCK_EX | LOCK_NB)`) on a file — held by the
 * open descriptor, released by the kernel when the holder closes it OR
 * DIES. So there is never a stale lock to reclaim, and no reclaim race can
 * hand one lock to two owners (#898 E review). The file itself is never
 * deleted; its content (the holder's pid) is informational only.
 *
 * `unsupported` where the libc symbol cannot be loaded (callers pick a
 * fail-safe fallback). Never blocks.
 */
import { closeSync, ftruncateSync, openSync, writeSync } from 'fs'
import { dlopen, FFIType } from 'bun:ffi'
import { createLogger } from '../logger'

const log = createLogger('fs-flock')
const LOCK_EX = 2
const LOCK_NB = 4

type Flock = (fd: number, op: number) => number
let flockFn: Flock | null | undefined

function loadFlock(): Flock | null {
  try {
    const lib = process.platform === 'darwin' ? 'libSystem.B.dylib' : process.platform === 'linux' ? 'libc.so.6' : null
    if (!lib) return null
    const { symbols } = dlopen(lib, { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } })
    return (fd, op) => symbols.flock(fd, op)
  } catch (err) {
    log.debug('flock unavailable on this platform', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

export type FileLock = { kind: 'held'; release: () => void } | { kind: 'busy' } | { kind: 'unsupported' }

export function tryLockFile(path: string): FileLock {
  if (flockFn === undefined) flockFn = loadFlock()
  if (!flockFn) return { kind: 'unsupported' }
  const fd = openSync(path, 'a+')
  if (flockFn(fd, LOCK_EX | LOCK_NB) !== 0) {
    closeSync(fd)
    return { kind: 'busy' }
  }
  try {
    ftruncateSync(fd, 0)
    writeSync(fd, String(process.pid))
  } catch (err) {
    log.debug('Could not record the lock holder pid', { path, error: err instanceof Error ? err.message : String(err) })
  }
  return { kind: 'held', release: () => closeSync(fd) }
}
