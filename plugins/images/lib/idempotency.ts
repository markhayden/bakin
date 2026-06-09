/**
 * Idempotency for billed image calls.
 *
 * A billed `generate`/`edit` is non-idempotent at the provider, so a client
 * (mcporter) that times out and retries an identical call would bill twice —
 * Bakin finished server-side, but the client gave up and re-issued. This guards
 * against that WITHOUT adding a retry: an identical call that is still in flight
 * awaits the same promise, and an identical completed call returns the cached
 * result (the already-saved asset). Failures are never cached, so a genuine
 * retry of a failed call proceeds.
 *
 * Completed results persist in the execution ledger (durable, NO TTL): a
 * watchdog-superseded run replayed minutes later, or a retry across a server
 * restart, returns the first run's asset instead of re-billing. The signature
 * is taskId-scoped, so DELIBERATELY creating the same image on a new task
 * bills again — intent is respected. In-flight dedup stays process-local
 * (concurrent identical calls share one promise).
 */
import { createHash } from 'node:crypto'
import type { ExecToolResult } from '@bakin/core/plugin-types'
import { getIdempotent, putIdempotent } from '../../../src/core/execution-ledger'

/** Stable identity of a billed image call. Same parts ⇒ same provider work. */
export interface ImageCallKey {
  taskId: string
  op: 'generate' | 'edit'
  /** Source identifier for edits (managed filename or local path); null for generate. */
  source: string | null
  promptHash: string
  provider: string
  model: string
  width: number
  height: number
  quality: string
  /** Order-stable fingerprint of reference images (assetId@version, sorted);
   *  '' when none. Same prompt + different references must not dedupe (#418). */
  references: string
}

export function imageCallSignature(key: ImageCallKey): string {
  // Order-stable serialization of the fields that determine provider work.
  const canonical = JSON.stringify([
    key.taskId,
    key.op,
    key.source,
    key.promptHash,
    key.provider,
    key.model,
    key.width,
    key.height,
    key.quality,
    key.references,
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

export interface IdempotencyOptions {
  /** How long a completed result is reused, in ms. Default 5 minutes. */
  ttlMs?: number
  /** Injectable clock for tests. */
  now?: () => number
}

export interface IdempotencyRunOptions<T> {
  cacheable?: (result: T) => boolean
  /**
   * Durable completed-result store (the execution ledger in production).
   * When provided, it REPLACES the in-memory TTL cache: results live
   * forever and survive restarts. Absent (unit tests), the registry falls
   * back to its process-local TTL map.
   */
  load?: () => T | null
  save?: (result: T) => void
}

export interface IdempotencyRegistry<T> {
  run(signature: string, fn: () => Promise<T>, opts?: IdempotencyRunOptions<T>): Promise<T>
}

const DEFAULT_TTL_MS = 5 * 60 * 1000

/**
 * Creates an isolated registry. The module-level `imageCallRegistry` below is the
 * one production instances use; tests construct their own with an injected clock.
 */
export function createIdempotencyRegistry<T>(opts: IdempotencyOptions = {}): IdempotencyRegistry<T> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  const now = opts.now ?? (() => Date.now())
  const inflight = new Map<string, Promise<T>>()
  const completed = new Map<string, { result: T; expiresAt: number }>()

  return {
    run(signature, fn, runOpts) {
      const pending = inflight.get(signature)
      if (pending) return pending

      if (runOpts?.load) {
        // Durable store path — no TTL; the billed result is permanent.
        const stored = runOpts.load()
        if (stored !== null) return Promise.resolve(stored)
      } else {
        const cached = completed.get(signature)
        if (cached) {
          if (cached.expiresAt > now()) return Promise.resolve(cached.result)
          completed.delete(signature)
        }
      }

      const promise = (async () => {
        const result = await fn()
        const cacheable = runOpts?.cacheable ? runOpts.cacheable(result) : true
        if (cacheable) {
          if (runOpts?.save) runOpts.save(result)
          else completed.set(signature, { result, expiresAt: now() + ttlMs })
        }
        return result
      })()

      inflight.set(signature, promise)
      // Clear the in-flight slot once settled (success or failure); a failure is
      // not cached above, so the next identical call re-issues.
      return promise.finally(() => {
        if (inflight.get(signature) === promise) inflight.delete(signature)
      })
    },
  }
}

/** Production registry shared across all billed image calls in this process. */
const imageCallRegistry = createIdempotencyRegistry<ExecToolResult>()

/**
 * Run a billed image operation idempotently. The result is cached only when
 * it succeeded (`ok === true`); failures re-issue on the next identical
 * call. Completed results persist in the execution ledger — durable, no
 * TTL, first write wins — so a replay across a watchdog supersede or server
 * restart returns the first asset for $0. A ledger failure propagates (fail
 * closed): without the dedup record a retry could double-bill.
 */
export function runBilledImageCall(
  key: ImageCallKey,
  fn: () => Promise<ExecToolResult>,
): Promise<ExecToolResult> {
  const signature = imageCallSignature(key)
  return imageCallRegistry.run(signature, fn, {
    cacheable: (r) => r.ok === true,
    load: () => (getIdempotent(signature)?.result as ExecToolResult | null) ?? null,
    save: (result) => putIdempotent(signature, `image.${key.op}`, result),
  })
}
