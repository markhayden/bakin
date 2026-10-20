/**
 * Operation resources (D23) — the cross-process locks every long-running
 * flow acquires before it touches shared state.
 *
 * - `install-state` IS the historical `~/.bakin/install.lock` (packs, plugins,
 *   plugin assets and skills share `~/.bakin/bin`). `media-store` and
 *   `search-engine` live under `~/.bakin/locks/`; plugin-private resources
 *   (`<pluginId>:<name>`) under `~/.bakin/locks/<pluginId>/`.
 * - Acquisition is atomic across processes: `openSync(path, 'wx')` (O_EXCL)
 *   creates the file or fails — never check-then-write. The file records the
 *   holder `{ pid, bootId, operationId, title, acquiredAt }`; old readers
 *   only look at `pid`/`acquiredAt`.
 * - A holder is stale when its pid is dead, or when it names THIS process
 *   but no operation here holds it. Stale files are reclaimed and reported.
 * - Resources are acquired once, up front, in the canonical order
 *   (install-state → media-store → search-engine → plugin resources), so no
 *   AB/BA deadlock is possible. Waiting is abortable; a lease obtained after
 *   an abort is released immediately.
 * - ONE ownership context (AsyncLocalStorage) records what the current call
 *   chain holds. It makes acquisition reentrant within one operation and is
 *   what inner writers assert against (`assertResourceHeld`). Locks are never
 *   shared across sibling operations; bounded synchronous writers take theirs
 *   with `holdNow`, never waiting.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { closeSync, existsSync, fstatSync, ftruncateSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { dlopen, FFIType } from 'bun:ffi'
import { dirname, join } from 'node:path'

import { CORE_RESOURCES } from '@makinbakin/sdk/types'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'
import { ResourceBusyError } from './errors'

const log = createLogger('operations:resources')

export interface ResourceHolder {
  pid: number
  acquiredAt: string
  bootId?: string
  operationId?: string
  title?: string
}

export interface ResourceHolderIdentity {
  title: string
  bootId?: string
  operationId?: string
}

export interface ResourceLease {
  /** The resources THIS lease took, in acquisition order (already-held ones are excluded). */
  readonly resources: readonly string[]
  /** Idempotent; releases in reverse order. */
  release(): void
}

export interface ResourceWait {
  resource: string
  holder: ResourceHolder
}

export interface AcquireResourcesOptions {
  identity: ResourceHolderIdentity
  signal?: AbortSignal
  /** Called when a resource is found held, and again whenever the holder changes. */
  onWait?: (wait: ResourceWait) => void
  /** Called after a stale holder's file was removed. */
  onReclaim?: (wait: ResourceWait) => void
  /** Backoff while waiting. */
  pollMs?: { initial: number; max: number }
}

const PLUGIN_RESOURCE_RE = /^([a-z0-9][a-z0-9-]*):([a-z0-9][a-z0-9-]*)$/
/** Attempts to pin the inode the path names (a release between our open and our lock retries). */
const ACQUIRE_ATTEMPTS = 3

const isCoreResource = (resource: string): boolean => (CORE_RESOURCES as readonly string[]).includes(resource)

/** Pure name check: a core resource or `<pluginId>:<name>`. */
export function assertResourceName(resource: string): void {
  if (!isCoreResource(resource) && !PLUGIN_RESOURCE_RE.test(resource)) {
    throw new Error(`Invalid operation resource '${resource}': use a core resource or '<pluginId>:<name>'`)
  }
}

export function resourceLockPath(resource: string): string {
  assertResourceName(resource)
  if (resource === 'install-state') return join(getContentDir(), 'install.lock')
  if (isCoreResource(resource)) return join(getContentDir(), 'locks', `${resource}.lock`)
  const [pluginId, name] = resource.split(':') as [string, string]
  return join(getContentDir(), 'locks', pluginId, `${name}.lock`)
}

/** Canonical acquisition order: core resources in their fixed order, then plugin resources by name. */
export function sortResources(resources: Iterable<string>): string[] {
  const unique = [...new Set(resources)]
  for (const r of unique) assertResourceName(r)
  const core = CORE_RESOURCES.filter((r) => unique.includes(r))
  const rest = unique.filter((r) => !isCoreResource(r)).sort()
  return [...core, ...rest]
}

// ---------------------------------------------------------------------------
// Ownership context
// ---------------------------------------------------------------------------

const holdingContext = new AsyncLocalStorage<ReadonlySet<string>>()
/** Resources this process holds right now, by any operation. */
const heldHere = new Map<string, ResourceHolderIdentity>()

/** True only inside a call chain that holds `resource` (never for a sibling operation). */
export function heldInContext(resource: string): boolean {
  return holdingContext.getStore()?.has(resource) ?? false
}

/**
 * Inner writers call this instead of acquiring: satisfied only inside the
 * call chain of an operation (or `holdNow`) that holds `resource` — never by
 * a sibling. Every install-state writer (bins, projections, the plugin replace
 * transaction, the sync engine, migration) asserts here.
 */
export function assertResourceHeld(resource: string, writer: string): void {
  if (!heldInContext(resource)) {
    throw new Error(`${writer} requires ${resource} — run it inside an operation that declares it (or holdNow for a bounded synchronous writer)`)
  }
}

/** Runs `fn` as a holder of `resources` (plus whatever the enclosing chain holds). */
export function runHolding<T>(resources: Iterable<string>, fn: () => T): T {
  const merged = new Set([...(holdingContext.getStore() ?? []), ...resources])
  return holdingContext.run(merged, fn)
}

// ---------------------------------------------------------------------------
// Lock files — held by flock(2) on an open descriptor
//
// The lock IS the kernel's exclusion: a holder keeps its descriptor open and
// locked for the lease's lifetime; a holder that dies (any signal, any
// crash) has its lock released by the kernel; a waiter never judges, moves
// or unlinks another process's file. The JSON inside is purely informational
// (who holds it — for `waitingFor` and logs) and is written only AFTER the
// lock is held, so a contender can never read a half-written holder. This
// replaced the O_EXCL-create + stale-pid-reclaim scheme (#896 D3.5 review):
// every unlink-based reclaim had a window in which two contenders could both
// pass the staleness check and the second would delete the first's fresh lock.
// ---------------------------------------------------------------------------

const LOCK_EX = 2
const LOCK_NB = 4

type LibcFlock = { symbols: { flock: (fd: number, operation: number) => number } }
let libc: LibcFlock | null = null
function flock(fd: number, operation: number): number {
  if (!libc) {
    const candidates = process.platform === 'darwin'
      ? ['libSystem.B.dylib']
      : ['libc.so.6', 'libc.musl-x86_64.so.1', 'libc.musl-aarch64.so.1', 'libc.so']
    let lastError: unknown
    for (const name of candidates) {
      try {
        libc = dlopen(name, { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } }) as unknown as LibcFlock
        break
      } catch (err) {
        lastError = err
      }
    }
    if (!libc) throw new Error(`operation locks need flock(2) from libc: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
  }
  return libc.symbols.flock(fd, operation)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function readHolderAt(path: string): ResourceHolder | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ResourceHolder>
    if (typeof parsed.pid !== 'number') return null
    return {
      pid: parsed.pid,
      acquiredAt: String(parsed.acquiredAt ?? ''),
      ...(parsed.bootId ? { bootId: String(parsed.bootId) } : {}),
      ...(parsed.operationId ? { operationId: String(parsed.operationId) } : {}),
      ...(parsed.title ? { title: String(parsed.title) } : {}),
    }
  } catch {
    return null
  }
}

export function readResourceHolder(resource: string): ResourceHolder | null {
  return readHolderAt(resourceLockPath(resource))
}

/** True when some live process holds `resource` (this one or another): the kernel lock is taken. */
export function isResourceHeld(resource: string): boolean {
  const path = resourceLockPath(resource)
  if (!existsSync(path)) return false
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    return false
  }
  try {
    return flock(fd, LOCK_EX | LOCK_NB) !== 0
  } finally {
    closeSync(fd) // closing drops the probe lock if the probe took it
  }
}

/** Descriptors this process holds locks on, by resource (closed on release). */
const heldFds = new Map<string, number>()

function writeHolder(fd: number, identity: ResourceHolderIdentity): void {
  const holder: ResourceHolder = {
    pid: process.pid,
    ...(identity.bootId ? { bootId: identity.bootId } : {}),
    ...(identity.operationId ? { operationId: identity.operationId } : {}),
    title: identity.title,
    acquiredAt: new Date().toISOString(),
  }
  ftruncateSync(fd, 0)
  writeSync(fd, JSON.stringify(holder, null, 2), 0)
}

type TryOne = { ok: true } | { ok: false; holder: ResourceHolder }

/** One non-blocking attempt: take the kernel lock on the inode the path names. */
function tryAcquireOne(resource: string, identity: ResourceHolderIdentity, onReclaim?: (wait: ResourceWait) => void): TryOne {
  const path = resourceLockPath(resource)
  mkdirSync(dirname(path), { recursive: true })
  for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt++) {
    const fd = openSync(path, 'a+') // creates when absent; never truncates another holder's metadata
    // The descriptor is ours until ownership is recorded in `heldFds`: every
    // exit before that — a refused lock, a stale inode, libc failing to load
    // on the first flock (review r4), a metadata write on a full disk — must
    // close it, or the open file (and any kernel lock on it) outlives the
    // attempt until the process exits.
    let transferred = false
    try {
      if (flock(fd, LOCK_EX | LOCK_NB) !== 0) {
        const holder = readHolderAt(path)
        return { ok: false, holder: holder ?? { pid: -1, acquiredAt: '', title: 'Another operation' } }
      }
      // A holder may have released (unlinked) between our open and our lock: we
      // would then hold an orphaned inode while a newcomer locks a fresh file.
      // Hold only the inode the path names right now; otherwise retry.
      let namesOurInode = false
      try {
        namesOurInode = fstatSync(fd).ino === statSync(path).ino
      } catch {
        namesOurInode = false
      }
      if (!namesOurInode) continue
      const previous = readHolderAt(path)
      writeHolder(fd, identity)
      heldHere.set(resource, identity)
      heldFds.set(resource, fd)
      transferred = true
      if (previous && (previous.pid === process.pid || !isProcessAlive(previous.pid))) {
        // The file still named a holder that is gone: the kernel had already
        // released its lock; this is the (informational) reclaim report.
        log.warn('Took over an operation lock whose holder died', { resource, path, stalePid: previous.pid, staleOperation: previous.operationId })
        try {
          onReclaim?.({ resource, holder: previous })
        } catch (err) {
          releaseResource(resource)
          throw err
        }
      }
      return { ok: true }
    } finally {
      if (!transferred) closeSync(fd)
    }
  }
  const holder = readHolderAt(path)
  return { ok: false, holder: holder ?? { pid: -1, acquiredAt: '', title: 'Another operation' } }
}

/** Releases one resource this process holds: unlink the path, then drop the kernel lock. */
export function releaseResource(resource: string): void {
  const fd = heldFds.get(resource)
  heldHere.delete(resource)
  heldFds.delete(resource)
  if (fd === undefined) return
  const path = resourceLockPath(resource)
  // Unlink BEFORE closing: a waiter that already opened this inode gets the
  // lock when we close, sees the path no longer names its inode, and retries
  // on the fresh file — never two holders on two inodes.
  try {
    unlinkSync(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('Failed to remove an operation lock file', { resource, path, error: err instanceof Error ? err.message : String(err) })
    }
  }
  try {
    closeSync(fd)
  } catch (err) {
    log.warn('Failed to close an operation lock descriptor', { resource, path, error: err instanceof Error ? err.message : String(err) })
  }
}

function lease(resources: string[]): ResourceLease {
  let released = false
  return {
    resources,
    release() {
      if (released) return
      released = true
      for (const r of [...resources].reverse()) releaseResource(r)
    },
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('Aborted')
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortReason(signal!))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// ---------------------------------------------------------------------------
// Public acquisition
// ---------------------------------------------------------------------------

/**
 * Acquires every resource in canonical order, waiting (abortably) on held
 * ones. Resources the current call chain already holds are skipped.
 */
export async function acquireResources(resources: Iterable<string>, opts: AcquireResourcesOptions): Promise<ResourceLease> {
  const wanted = sortResources(resources).filter((r) => !heldInContext(r))
  const taken: string[] = []
  const initial = opts.pollMs?.initial ?? 100
  const max = opts.pollMs?.max ?? 1_000
  try {
    for (const resource of wanted) {
      let delay = initial
      let lastHolderKey: string | undefined
      for (;;) {
        if (opts.signal?.aborted) throw abortReason(opts.signal)
        const attempt = tryAcquireOne(resource, opts.identity, opts.onReclaim)
        if (attempt.ok) {
          taken.push(resource)
          if (opts.signal?.aborted) throw abortReason(opts.signal)
          break
        }
        const key = `${attempt.holder.pid}:${attempt.holder.operationId ?? ''}:${attempt.holder.acquiredAt}`
        if (key !== lastHolderKey) {
          lastHolderKey = key
          opts.onWait?.({ resource, holder: attempt.holder })
        }
        await sleep(delay, opts.signal)
        delay = Math.min(delay * 2, max)
      }
    }
  } catch (err) {
    lease(taken).release()
    throw err
  }
  return lease(taken)
}

/**
 * Never waits: either every resource is acquired (in canonical order) or
 * nothing is held and the first busy holder is returned. Background work
 * (the migration pump, boot resumption, the wedge watchdog) and the bounded
 * synchronous writers use this and defer or answer 409.
 */
export function tryAcquireResources(resources: Iterable<string>, identity: ResourceHolderIdentity): ResourceLease | { busy: ResourceWait } {
  const wanted = sortResources(resources).filter((r) => !heldInContext(r))
  const taken: string[] = []
  try {
    for (const resource of wanted) {
      const attempt = tryAcquireOne(resource, identity)
      if (!attempt.ok) {
        lease(taken).release()
        return { busy: { resource, holder: attempt.holder } }
      }
      taken.push(resource)
    }
  } catch (err) {
    lease(taken).release() // a later acquisition threw: nothing stays held
    throw err
  }
  return lease(taken)
}

/**
 * Run `fn` holding `resources` RIGHT NOW or not at all — the bounded
 * synchronous writers' path (lesson toggle, plugin unlink, skill-map apply).
 * Already-held resources (this call chain owns them) are reused; anything
 * another holder has throws `ResourceBusyError` before `fn` runs.
 */
export async function holdNow<T>(resources: Iterable<string>, identity: ResourceHolderIdentity, fn: () => Promise<T>): Promise<T> {
  const wanted = [...resources]
  const result = tryAcquireResources(wanted, identity)
  if ('busy' in result) throw new ResourceBusyError(result.busy.resource, result.busy.holder)
  try {
    return await runHolding(wanted, fn)
  } finally {
    result.release()
  }
}
