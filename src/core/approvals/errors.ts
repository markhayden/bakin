/**
 * Typed approval orchestration errors. Routes map by instanceof (never by
 * message): ApprovalNotFoundError → 404, ApprovalNotPendingError → 409,
 * ApprovalRefusedError → 403, ApprovalResolveError → its own `status`.
 */
import { ApprovalNotFoundError, ApprovalNotPendingError, type ApprovalRefusal, type ApprovalRefusalCode } from '@bakin/core/approvals'

export { ApprovalNotFoundError, ApprovalNotPendingError }

/** A kind handler refused or failed the decision; the record stays pending. */
export class ApprovalResolveError extends Error {
  constructor(message: string, public readonly status: 400 | 409 | 500 = 500) {
    super(message)
    this.name = 'ApprovalResolveError'
  }
}

/**
 * The decision policy refused this caller (#898 D-H2): an agent, a known
 * agent context, or an undeclared caller. Nothing has happened yet — the
 * policy runs before any side effect.
 */
export class ApprovalRefusedError extends Error {
  readonly code: ApprovalRefusalCode
  constructor(refusal: ApprovalRefusal) {
    super(refusal.message)
    this.name = 'ApprovalRefusedError'
    this.code = refusal.code
  }
}

/** No handler is registered for the record's kind (boot-order bug, not a user error). */
export class ApprovalKindUnavailableError extends Error {
  constructor(public readonly kind: string) {
    super(`No approval kind handler registered for "${kind}"`)
    this.name = 'ApprovalKindUnavailableError'
  }
}

/**
 * HTTP status for a typed approval error, or null for anything else (which a
 * route should rethrow). The ONE mapping every resolve surface uses — host
 * REST, plugin gate routes, the decision page.
 */
export function approvalErrorStatus(err: unknown): 400 | 403 | 404 | 409 | 500 | 503 | null {
  if (err instanceof ApprovalRefusedError) return 403
  if (err instanceof ApprovalNotFoundError) return 404
  if (err instanceof ApprovalNotPendingError) return 409
  if (err instanceof ApprovalResolveError) return err.status
  if (err instanceof ApprovalKindUnavailableError) return 503
  return null
}
