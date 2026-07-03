/**
 * Typed search-adapter errors. The outbox classifies failures by TYPE —
 * never by message text (same rule as dispatch RuntimeErrors). Adapters
 * throw these from every write/query path.
 */

/**
 * The engine is unreachable or transiently failing (connect refused,
 * timeout, 5xx, shard settling). Retry-forever safe: the outbox backs off
 * without advancing rows toward quarantine.
 */
export class SearchEngineUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'SearchEngineUnavailableError'
    this.cause = cause
  }
}

/**
 * The engine rejected the request itself (4xx: schema/validation/shape).
 * Retrying the identical payload cannot succeed — the outbox counts these
 * toward quarantine.
 */
export class SearchRequestRejectedError extends Error {
  /** HTTP status when known — 404 (missing table) retries as transient. */
  readonly status?: number
  constructor(message: string, cause?: unknown, status?: number) {
    super(message)
    this.name = 'SearchRequestRejectedError'
    this.cause = cause
    this.status = status
  }
}

/** Missing-table rejections are timing, not poison: the blue/green ensure
 *  or a resumed migration creates the table momentarily. */
export function isMissingTable(err: unknown): boolean {
  return err instanceof Error && err.name === 'SearchRequestRejectedError'
    && (err as SearchRequestRejectedError).status === 404
}

/** Type-based classification that survives module-instance duplication. */
export function isEngineUnavailable(err: unknown): boolean {
  return err instanceof SearchEngineUnavailableError
    || (err instanceof Error && err.name === 'SearchEngineUnavailableError')
}
