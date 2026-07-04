import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { resolveRuntimeChannelRef } from '../../../src/core/channel-aliases'
import { loadInstance, saveInstance } from './runtime'
import {
  approvalRefFromRecord,
  cancelApprovalRecord,
  listApprovalRecords,
  pruneResolvedApprovalRecords,
  updateApprovalDeliveries,
} from './approval-store'

/** Resolved approval records older than this are deleted at rehydration. */
const RESOLVED_APPROVAL_MAX_AGE_MS = 30 * 24 * 3600 * 1000

type ApprovalRehydrationLogger = {
  info?: (message: string, meta?: Record<string, unknown>) => void
  warn?: (message: string, meta?: Record<string, unknown>) => void
  error?: (message: string, meta?: Record<string, unknown>) => void
}

export interface ApprovalRehydrationSummary {
  pending: number
  reattached: number
  rerendered: number
  skipped: number
  failed: number
  /** Resolved records past retention, deleted this pass. */
  pruned: number
  /** Pending records orphaned by their workflow instance, cancelled this pass. */
  cancelled: number
}

export interface ApprovalRehydrationOptions {
  runtime: AgentRuntimeAdapter
  channel: string
  renderMissingDeliveries: boolean
  contentDir?: string
  log?: ApprovalRehydrationLogger
}

function approvalRefMatches(
  current: ReturnType<typeof approvalRefFromRecord>,
  next: ReturnType<typeof approvalRefFromRecord>,
): boolean {
  if (!current || !next) return current === next
  return current.approvalId === next.approvalId
    && JSON.stringify(current.deliveries) === JSON.stringify(next.deliveries)
}

export async function rehydratePendingApprovals(
  options: ApprovalRehydrationOptions,
): Promise<ApprovalRehydrationSummary> {
  const summary: ApprovalRehydrationSummary = {
    pending: 0,
    reattached: 0,
    rerendered: 0,
    skipped: 0,
    failed: 0,
    pruned: 0,
    cancelled: 0,
  }

  summary.pruned = pruneResolvedApprovalRecords(RESOLVED_APPROVAL_MAX_AGE_MS, options.contentDir)

  const pendingRecords = listApprovalRecords(options.contentDir)
    .filter((record) => record.status === 'pending')
  summary.pending = pendingRecords.length

  // Resolved lazily so boots with nothing to re-render never touch settings
  // or the runtime channel list (and never error-log on unresolvable config).
  let resolvedChannel: string | null = null
  let channelResolutionFailed = false
  const resolveChannelOnce = async (): Promise<string | null> => {
    if (resolvedChannel || channelResolutionFailed) return resolvedChannel
    try {
      resolvedChannel = (await resolveRuntimeChannelRef(options.runtime, options.channel)).resolved
    } catch (err) {
      channelResolutionFailed = true
      options.log?.error?.('Approval re-render channel resolution failed', {
        channel: options.channel,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return resolvedChannel
  }

  for (const record of pendingRecords) {
    const { taskId, stepId, runId } = record.owner
    if (!taskId || !stepId) {
      cancelApprovalRecord(record.approvalId, 'orphaned: approval record has no owner identity', options.contentDir)
      summary.cancelled += 1
      continue
    }

    const instance = loadInstance(taskId, options.contentDir)
    const stepState = instance?.stepStates[stepId]
    if (
      !instance
      || instance.instanceId !== runId
      || instance.currentStepId !== stepId
      || instance.status !== 'pending_approval'
      || stepState?.status !== 'pending_approval'
    ) {
      cancelApprovalRecord(record.approvalId, 'orphaned: workflow instance is no longer pending at this gate', options.contentDir)
      summary.cancelled += 1
      continue
    }

    let currentRecord = record

    if (currentRecord.deliveries.length === 0 && stepState.approvalRef?.approvalId === currentRecord.approvalId) {
      currentRecord = updateApprovalDeliveries(currentRecord.approvalId, stepState.approvalRef.deliveries, options.contentDir)
        ?? currentRecord
    }

    if (currentRecord.deliveries.length === 0 && options.renderMissingDeliveries) {
      const channel = await resolveChannelOnce()
      if (!channel) {
        summary.failed += 1
        continue
      }
      try {
        const result = await options.runtime.channels.createApproval({
          approvalId: currentRecord.approvalId,
          channels: [channel],
          request: currentRecord.request,
        })
        currentRecord = updateApprovalDeliveries(currentRecord.approvalId, result.deliveries, options.contentDir)
          ?? currentRecord
        summary.rerendered += 1
      } catch (err) {
        summary.failed += 1
        options.log?.warn?.('Failed to re-render pending workflow approval', {
          approvalId: currentRecord.approvalId,
          error: err instanceof Error ? err.message : String(err),
        })
        continue
      }
    }

    const nextRef = approvalRefFromRecord(currentRecord)
    if (!nextRef || currentRecord.deliveries.length === 0) {
      summary.skipped += 1
      continue
    }

    if (!approvalRefMatches(stepState.approvalRef, nextRef)) {
      stepState.approvalRef = nextRef
      saveInstance(instance, options.contentDir)
      summary.reattached += 1
    }
  }

  return summary
}
