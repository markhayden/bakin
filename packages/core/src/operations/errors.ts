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

/**
 * Thrown by an operation's `validate` to refuse the request synchronously
 * with today's HTTP status and body (D6: invalid requests still fail before
 * any operation exists). The start helper maps it straight to the response.
 */
export class OperationRejectedError extends Error {
  constructor(public readonly httpStatus: number, public readonly body: unknown) {
    super(`Operation rejected (${httpStatus})`)
    this.name = 'OperationRejectedError'
  }
}

/**
 * A non-blocking writer found a resource held (D23): plugin unlink, skill-map
 * apply and the lesson toggle never wait. Routes answer 409 `install_busy`
 * naming the holder.
 */
export class ResourceBusyError extends Error {
  constructor(
    public readonly resource: string,
    public readonly holder: { pid: number; title?: string; operationId?: string; acquiredAt: string },
  ) {
    super(`${holder.title ?? 'Another operation'} is using ${resource} — try again when it finishes.`)
    this.name = 'ResourceBusyError'
  }
}
