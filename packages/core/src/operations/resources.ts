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
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs'
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
/** A lock file younger than this with no parseable holder is mid-write, not stale. */
const UNPARSEABLE_GRACE_MS = 2_000
const RECLAIM_ATTEMPTS = 3
/** A `.reclaim` marker older than this belongs to a reclaimer that died mid-reclaim; it is ignored. */
const RECLAIM_MARKER_GRACE_MS = 10_000

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
// Lock files
// ---------------------------------------------------------------------------

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

/** True when some live process holds `resource` (this one or another). */
export function isResourceHeld(resource: string): boolean {
  const path = resourceLockPath(resource)
  if (!existsSync(path)) return false
  const holder = readHolderAt(path)
  return holder ? isProcessAlive(holder.pid) : true
}

function isStale(resource: string, path: string, holder: ResourceHolder | null): boolean {
  if (!holder) {
    try {
      return Date.now() - statSync(path).mtimeMs > UNPARSEABLE_GRACE_MS
    } catch {
      return false
    }
  }
  if (!isProcessAlive(holder.pid)) return true
  return holder.pid === process.pid && !heldHere.has(resource)
}

function reclaimMarkerPath(path: string): string {
  return `${path}.reclaim`
}

/** O_EXCL claim on the reclaim of `path`; a marker left by a dead reclaimer is ignored after a short grace. */
function takeReclaimMarker(path: string): boolean {
  const marker = reclaimMarkerPath(path)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      closeSync(openSync(marker, 'wx'))
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    let age = 0
    try {
      age = Date.now() - statSync(marker).mtimeMs
    } catch {
      continue // vanished between the open and the stat — retry the claim
    }
    if (age < RECLAIM_MARKER_GRACE_MS) return false
    log.warn('Ignoring a reclaim marker left by a dead reclaimer', { marker, ageMs: Math.round(age) })
    releaseReclaimMarker(path)
  }
  return false
}

function releaseReclaimMarker(path: string): void {
  try {
    unlinkSync(reclaimMarkerPath(path))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

function tryCreate(path: string, identity: ResourceHolderIdentity): boolean {
  let fd: number
  try {
    fd = openSync(path, 'wx')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  }
  try {
    const holder: ResourceHolder = {
      pid: process.pid,
      ...(identity.bootId ? { bootId: identity.bootId } : {}),
      ...(identity.operationId ? { operationId: identity.operationId } : {}),
      title: identity.title,
      acquiredAt: new Date().toISOString(),
    }
    writeSync(fd, JSON.stringify(holder, null, 2))
  } finally {
    closeSync(fd)
  }
  return true
}

type TryOne = { ok: true } | { ok: false; holder: ResourceHolder }

/** One non-blocking attempt, reclaiming stale holders. */
function tryAcquireOne(resource: string, identity: ResourceHolderIdentity, onReclaim?: (wait: ResourceWait) => void): TryOne {
  const path = resourceLockPath(resource)
  mkdirSync(dirname(path), { recursive: true })
  for (let attempt = 0; attempt < RECLAIM_ATTEMPTS; attempt++) {
    if (tryCreate(path, identity)) {
      heldHere.set(resource, identity)
      return { ok: true }
    }
    const holder = readHolderAt(path)
    if (!isStale(resource, path, holder)) {
      return { ok: false, holder: holder ?? { pid: -1, acquiredAt: '', title: 'Another operation' } }
    }
    log.warn('Reclaiming a stale operation lock', { resource, path, stalePid: holder?.pid ?? 'unparseable', staleOperation: holder?.operationId })
    // Single-winner reclaim (#896 D3.5): two contenders that both judged the
    // same dead holder must not both unlink — the second would delete the
    // FIRST one's fresh lock and both would hold the resource. The reclaim
    // itself is an O_EXCL marker; under it the holder is re-read and unlinked
    // only if it is still the stale one that was judged. A contender that
    // loses the marker simply re-reads on the next attempt and sees the
    // winner's live lock.
    if (!takeReclaimMarker(path)) continue
    try {
      const again = readHolderAt(path)
      const sameStaleHolder = again === null
        ? holder === null
        : holder !== null && again.pid === holder.pid && again.acquiredAt === holder.acquiredAt
      if (!sameStaleHolder) continue
      try {
        unlinkSync(path)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    } finally {
      releaseReclaimMarker(path)
    }
    onReclaim?.({ resource, holder: holder ?? { pid: -1, acquiredAt: '' } })
  }
  const holder = readHolderAt(path)
  return { ok: false, holder: holder ?? { pid: -1, acquiredAt: '', title: 'Another operation' } }
}

/** Releases one resource this process holds. Never removes a live foreign holder's file. */
export function releaseResource(resource: string): void {
  const path = resourceLockPath(resource)
  heldHere.delete(resource)
  if (!existsSync(path)) return
  const holder = readHolderAt(path)
  if (holder && holder.pid !== process.pid && isProcessAlive(holder.pid)) {
    log.warn('Refusing to release a lock held by another live process', { resource, holderPid: holder.pid, path })
    return
  }
  try {
    unlinkSync(path)
  } catch (err) {
    log.warn('Failed to release an operation lock', { resource, path, error: err instanceof Error ? err.message : String(err) })
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
  for (const resource of wanted) {
    const attempt = tryAcquireOne(resource, identity)
    if (!attempt.ok) {
      lease(taken).release()
      return { busy: { resource, holder: attempt.holder } }
    }
    taken.push(resource)
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
