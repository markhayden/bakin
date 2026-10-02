/** Typed approval errors — routes map them to 404/409 by instanceof, never by message. */

export class ApprovalNotFoundError extends Error {
  constructor(public readonly approvalId: string) {
    super(`Approval not found: ${approvalId}`)
    this.name = 'ApprovalNotFoundError'
  }
}

/** The record is no longer pending — a concurrent resolver (or a cancel) won. */
export class ApprovalNotPendingError extends Error {
  constructor(public readonly approvalId: string, public readonly status: string) {
    super(`Approval ${approvalId} is ${status}, not pending`)
    this.name = 'ApprovalNotPendingError'
  }
}
