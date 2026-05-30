/**
 * Idempotency for billed image calls.
 *
 * A billed `generate`/`edit` is non-idempotent at the provider, so a client
 * (mcporter) that times out and retries an identical call would bill twice —
 * Bakin finished server-side, but the client gave up and re-issued. This guards
 * against that WITHOUT adding a retry: an identical call that is still in flight
 * awaits the same promise, and an identical call within a short TTL after
 * completion returns the cached result (the already-saved asset). Failures are
 * never cached, so a genuine retry of a failed call proceeds.
 *
 * Process-local and in-memory by design (single user, single process).
 */
import { createHash } from 'node:crypto'
import type { ExecToolResult } from '@bakin/core/plugin-types'

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
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

export interface IdempotencyOptions {
  /** How long a completed result is reused, in ms. Default 5 minutes. */
  ttlMs?: number
  /** Injectable clock for tests. */
  now?: () => number
}

export interface IdempotencyRegistry<T> {
  run(signature: string, fn: () => Promise<T>, opts?: { cacheable?: (result: T) => boolean }): Promise<T>
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

      const cached = completed.get(signature)
      if (cached) {
        if (cached.expiresAt > now()) return Promise.resolve(cached.result)
        completed.delete(signature)
      }

      const promise = (async () => {
        const result = await fn()
        const cacheable = runOpts?.cacheable ? runOpts.cacheable(result) : true
        if (cacheable) completed.set(signature, { result, expiresAt: now() + ttlMs })
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
 * Run a billed image operation idempotently. The result is cached only when it
 * succeeded (`ok === true`); failures re-issue on the next identical call.
 */
export function runBilledImageCall(
  key: ImageCallKey,
  fn: () => Promise<ExecToolResult>,
): Promise<ExecToolResult> {
  return imageCallRegistry.run(imageCallSignature(key), fn, { cacheable: (r) => r.ok === true })
}
