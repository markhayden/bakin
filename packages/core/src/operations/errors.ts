/** Typed operation errors — callers branch by instanceof, never by message. */

/**
 * Raised by `OperationContext.throwIfCancelled()` (and by context methods that
 * observe the aborted signal) when an operation is cancelled before its point
 * of no return. The registry maps it to `cancelled` / `cancelled`.
 */
export class OperationCancelledError extends Error {
  constructor(public readonly operationId: string) {
    super(`Operation ${operationId} was cancelled`)
    this.name = 'OperationCancelledError'
  }
}
