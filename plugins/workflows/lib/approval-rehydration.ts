import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { loadInstance, saveInstance } from './runtime'
import {
  approvalRefFromRecord,
  listApprovalRecords,
  updateApprovalDeliveries,
} from './approval-store'

type ApprovalRehydrationLogger = {
  info?: (message: string, meta?: Record<string, unknown>) => void
  warn?: (message: string, meta?: Record<string, unknown>) => void
}

export interface ApprovalRehydrationSummary {
  pending: number
  reattached: number
  rerendered: number
  skipped: number
  failed: number
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
  }

  const pendingRecords = listApprovalRecords(options.contentDir)
    .filter((record) => record.status === 'pending')
  summary.pending = pendingRecords.length

  for (const record of pendingRecords) {
    const { taskId, stepId, runId } = record.owner
    if (!taskId || !stepId) {
      summary.skipped += 1
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
      summary.skipped += 1
      continue
    }

    let currentRecord = record

    if (currentRecord.deliveries.length === 0 && stepState.approvalRef?.approvalId === currentRecord.approvalId) {
      currentRecord = updateApprovalDeliveries(currentRecord.approvalId, stepState.approvalRef.deliveries, options.contentDir)
        ?? currentRecord
    }

    if (currentRecord.deliveries.length === 0 && options.renderMissingDeliveries) {
      try {
        const result = await options.runtime.channels.createApproval({
          approvalId: currentRecord.approvalId,
          channels: [options.channel],
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
