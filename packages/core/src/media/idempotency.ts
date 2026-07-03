/**
 * Generic idempotency registry for BILLED media calls (image generation,
 * vision enrichment, future modalities).
 *
 * A billed call is non-idempotent at the provider, so a client that times
 * out and retries an identical call would bill twice. This guards against
 * that WITHOUT adding a retry: an identical call still in flight awaits the
 * same promise, and an identical completed call returns the cached result.
 * Failures are never cached, so a genuine retry of a failed call proceeds.
 *
 * Durable completed-result storage is the CALLER's concern via
 * `IdempotencyRunOptions.load/save` (the images plugin uses the execution
 * ledger; enrichment uses the asset manifest itself). Absent those, the
 * registry falls back to a process-local TTL map.
 *
 * Lifted from plugins/images/lib/idempotency.ts so every media consumer
 * shares one implementation — plugins must not import each other.
 */

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
 * Creates an isolated registry. Production consumers hold module-level
 * instances; tests construct their own with an injected clock.
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
