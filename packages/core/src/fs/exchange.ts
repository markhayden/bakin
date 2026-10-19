/**
 * Atomically EXCHANGE two existing paths (files or directories) — after the
 * call each name holds what the other held, with no instant where either
 * name is missing. Used to publish a verified directory over a live one a
 * separate process may be reading (#898 E: search models under a running
 * engine).
 *
 *   darwin: renamex_np(from, to, RENAME_SWAP)
 *   linux:  renameat2(AT_FDCWD, from, AT_FDCWD, to, RENAME_EXCHANGE) (glibc ≥ 2.28)
 *
 * Returns false when the platform or filesystem cannot exchange atomically
 * (the caller picks its fallback); throws only when the call itself fails
 * on a supported platform.
 */
import { dlopen, FFIType, ptr } from 'bun:ffi'
import { createLogger } from '../logger'

const log = createLogger('fs-exchange')

const RENAME_SWAP = 0x2 // darwin <stdio.h>
const RENAME_EXCHANGE = 0x2 // linux <fcntl.h>
const AT_FDCWD = -100

type Exchanger = (from: Buffer, to: Buffer) => number

let exchanger: Exchanger | null | undefined

function loadExchanger(): Exchanger | null {
  try {
    if (process.platform === 'darwin') {
      const lib = dlopen('libSystem.B.dylib', { renamex_np: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 } })
      return (from, to) => lib.symbols.renamex_np(ptr(from), ptr(to), RENAME_SWAP)
    }
    if (process.platform === 'linux') {
      const lib = dlopen('libc.so.6', { renameat2: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 } })
      return (from, to) => lib.symbols.renameat2(AT_FDCWD, ptr(from), AT_FDCWD, ptr(to), RENAME_EXCHANGE)
    }
  } catch (err) {
    // No libc symbol (musl, old glibc, a sandbox without FFI): not supported.
    log.debug('Atomic path exchange unavailable on this platform', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
  return null
}

const cString = (path: string): Buffer => Buffer.from(`${path}\0`, 'utf8')

export function exchangePaths(a: string, b: string): boolean {
  if (exchanger === undefined) exchanger = loadExchanger()
  if (!exchanger) return false
  const rc = exchanger(cString(a), cString(b))
  if (rc === 0) return true
  throw new Error(`atomic exchange of ${a} and ${b} failed (rc ${rc})`)
}
