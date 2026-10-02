/**
 * Typed approval orchestration errors. Routes map by instanceof (never by
 * message): ApprovalNotFoundError → 404, ApprovalNotPendingError → 409,
 * ApprovalResolveError → its own `status`.
 */
export { ApprovalNotFoundError, ApprovalNotPendingError } from '@bakin/core/approvals'

/** A kind handler refused or failed the decision; the record stays pending. */
export class ApprovalResolveError extends Error {
  constructor(message: string, public readonly status: 400 | 409 | 500 = 500) {
    super(message)
    this.name = 'ApprovalResolveError'
  }
}

/** No handler is registered for the record's kind (boot-order bug, not a user error). */
export class ApprovalKindUnavailableError extends Error {
  constructor(public readonly kind: string) {
    super(`No approval kind handler registered for "${kind}"`)
    this.name = 'ApprovalKindUnavailableError'
  }
}
