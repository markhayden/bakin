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
import { createIdempotencyRegistry } from '@bakin/core/media'
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
   *  '' when none. Same prompt + different references must not dedupe (#418).
   *
   *  Accepted drift edge: the fingerprint binds each reference to its version
   *  AT CALL TIME. If a referenced asset gains a version (or a loose file's
   *  bytes change) between a client timeout and its retry, the retry's
   *  signature differs → ledger miss → a second billed call. Accepted because
   *  the inputs genuinely changed — the retry is a different generation, not
   *  a replay — and the window requires a concurrent edit on a single-user
   *  box. Do NOT "fix" by dropping versions from the fingerprint: that would
   *  wrongly dedupe a deliberate regenerate-against-the-new-version. */
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

// The generic registry (types + factory) lives in @bakin/core/media —
// re-exported here so existing imports of this module keep working.
export {
  createIdempotencyRegistry,
  type IdempotencyOptions,
  type IdempotencyRegistry,
  type IdempotencyRunOptions,
} from '@bakin/core/media'

/** Production registry shared across all billed image calls in this process. */
const imageCallRegistry = createIdempotencyRegistry<ExecToolResult>()

/**
 * The ledger holds coordination facts only — never content. The tool result
 * returned to the caller carries prompt text and provider commentary; the
 * persisted dedup row must not. Identity stays in promptHash (already part
 * of the call signature), so a replay still returns the right asset.
 */
const CONTENT_FIELDS = ['prompt', 'providerText'] as const

function coordinationOnly(result: ExecToolResult): ExecToolResult {
  const row: Record<string, unknown> = { ...(result as Record<string, unknown>) }
  for (const field of CONTENT_FIELDS) delete row[field]
  return row as ExecToolResult
}

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
    save: (result) => putIdempotent(signature, `image.${key.op}`, coordinationOnly(result)),
  })
}
