/**
 * Boot-once channel wiring: rehydrate pending approvals, then subscribe ONE
 * runtime-channel decision listener for every kind. Kind handlers must be
 * registered before this runs (plugins activate → doctor.start → here).
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { createLogger } from '../logger'
import { ApprovalKindUnavailableError, ApprovalNotFoundError, ApprovalNotPendingError, ApprovalResolveError } from './errors'
import { rehydratePendingApprovals } from './rehydration'
import { resolveApproval } from './service'

const log = createLogger('approvals:channel')

export async function bootApprovals(runtime: Pick<AgentRuntimeAdapter, 'channels'>): Promise<() => void> {
  await rehydratePendingApprovals()
  const channels = runtime.channels
  if (!channels) {
    log.info('Runtime has no channel layer — approvals are board-only (no channel decision wiring)')
    return () => {}
  }
  return channels.subscribeApprovalResponses(async (event) => {
    try {
      await resolveApproval(event.approvalId, {
        option: event.response.selectedOption,
        comment: event.response.comment,
        respondedAt: event.response.respondedAt,
        actor: { source: 'channel', id: event.response.actor.id, displayName: event.response.actor.displayName },
      })
    } catch (err) {
      // Stale provider button: the record was already resolved, cancelled or
      // never existed here — the durable record is canonical, ignore.
      if (err instanceof ApprovalNotFoundError || err instanceof ApprovalNotPendingError) {
        log.warn('Channel approval response ignored', { approvalId: event.approvalId, reason: err.message })
        return
      }
      if (err instanceof ApprovalKindUnavailableError || err instanceof ApprovalResolveError) {
        log.warn('Channel approval response refused', { approvalId: event.approvalId, reason: err.message })
        return
      }
      log.error('Channel approval response failed', err, { approvalId: event.approvalId })
    }
  })
}
