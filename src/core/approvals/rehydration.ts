/**
 * Boot rehydration for pending approvals (ported from the workflows plugin,
 * generalized per kind): prune old resolved records, cancel orphans whose
 * owner moved on, skip the ones whose state cannot be known, and re-render
 * delivery-less records on the channel when channel alerts are on.
 */
import { listApprovalRecords, pruneResolvedApprovalRecords } from '@bakin/core/approvals'
import { createLogger } from '../logger'
import { getSettings } from '../settings'
import { getApprovalKind } from './kinds'
import { cancelApproval, renderApprovalOnChannel } from './service'

const log = createLogger('approvals:rehydration')

/** Resolved approval records older than this are deleted at rehydration. */
export const RESOLVED_APPROVAL_MAX_AGE_MS = 30 * 24 * 3600 * 1000

export interface ApprovalRehydrationSummary {
  pending: number
  rerendered: number
  skipped: number
  failed: number
  pruned: number
  cancelled: number
  /** Pending records whose kind has no registered handler — left untouched. */
  unknownKind: number
}

export async function rehydratePendingApprovals(): Promise<ApprovalRehydrationSummary> {
  const summary: ApprovalRehydrationSummary = { pending: 0, rerendered: 0, skipped: 0, failed: 0, pruned: 0, cancelled: 0, unknownKind: 0 }
  summary.pruned = pruneResolvedApprovalRecords(RESOLVED_APPROVAL_MAX_AGE_MS)
  const pending = listApprovalRecords({ status: 'pending' })
  summary.pending = pending.length
  const renderMissing = getSettings().approvals.channelAlerts

  for (const record of pending) {
    const handler = getApprovalKind(record.owner.kind)
    if (!handler) {
      summary.unknownKind += 1
      log.warn('Pending approval has no registered kind handler — left as is', { approvalId: record.approvalId, kind: record.owner.kind })
      continue
    }
    let state: Awaited<ReturnType<typeof handler.ownerState>>
    try {
      state = await handler.ownerState(record)
    } catch (err) {
      summary.skipped += 1
      log.warn('Approval owner state could not be read — skipped, never cancelled', { approvalId: record.approvalId, err: err instanceof Error ? err.message : String(err) })
      continue
    }
    if (state === 'orphaned') {
      await cancelApproval(record.approvalId, 'orphaned: the owner is no longer waiting on this decision')
      summary.cancelled += 1
      continue
    }
    if (state === 'unknown') {
      summary.skipped += 1
      continue
    }
    if (record.deliveries.length === 0 && renderMissing) {
      const deliveries = await renderApprovalOnChannel(record)
      if (deliveries && deliveries.length > 0) summary.rerendered += 1
      else summary.failed += 1
      continue
    }
    summary.skipped += 1
  }

  if (summary.pending > 0 || summary.pruned > 0) log.info('Rehydrated pending approvals', { ...summary })
  return summary
}
