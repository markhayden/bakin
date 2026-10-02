/**
 * Approvals service — request, resolve and cancel through the ONE record
 * store, fan decisions to the registered kind handler, render on the runtime
 * channel when `settings.approvals.channelAlerts` is on, and publish
 * `approval.pending` / `approval.resolved` plugin-events for the board, the
 * attention provider and the Health page (spec D6/D7).
 */
import type { ApprovalDelivery } from '@bakin/core/adapters/runtime'
import type { RuntimeChannelSurface } from '@bakin/core/adapters/runtime/channels'
import {
  cancelApprovalRecord,
  createApprovalRecord,
  getApprovalRecord,
  listApprovalRecords,
  resolveApprovalRecord,
  updateApprovalDeliveries,
  type ApprovalOwner,
  type ApprovalRecord,
  type ApprovalRequest,
} from '@bakin/core/approvals'
import type { ApprovalResponse } from '@bakin/core/adapters/runtime'
import { maybeGetAppServices } from '../app-services-store'
import { resolveRuntimeChannelRef } from '../channel-aliases'
import { createLogger } from '../logger'
import { getSettings } from '../settings'
import { broadcast } from '../sse'
import { ApprovalKindUnavailableError, ApprovalNotFoundError, ApprovalNotPendingError } from './errors'
import { getApprovalKind, type ApprovalDecision } from './kinds'

const log = createLogger('approvals')

export interface RequestApprovalInput {
  approvalId: string
  owner: ApprovalOwner
  request: ApprovalRequest
  createdAt?: string
}

function runtimeChannels(): RuntimeChannelSurface | undefined {
  return maybeGetAppServices()?.runtime.channels
}

function publishPending(record: ApprovalRecord): void {
  broadcast({
    type: 'plugin-event',
    event: 'approval.pending',
    approvalId: record.approvalId,
    kind: record.owner.kind,
    taskId: record.owner.taskId,
    title: record.request.title,
    timestamp: new Date().toISOString(),
  })
}

function publishResolved(record: ApprovalRecord): void {
  broadcast({
    type: 'plugin-event',
    event: 'approval.resolved',
    approvalId: record.approvalId,
    kind: record.owner.kind,
    taskId: record.owner.taskId,
    status: record.status,
    option: record.response?.selectedOption ?? null,
    timestamp: new Date().toISOString(),
  })
}

/**
 * Render one record on the configured runtime channel. Never throws into the
 * caller: a channel failure leaves the record pending and board-only, and
 * rehydration retries delivery-less records at the next boot.
 */
export async function renderApprovalOnChannel(record: ApprovalRecord): Promise<ApprovalDelivery[] | null> {
  const channels = runtimeChannels()
  if (!channels) return null
  const settings = getSettings().approvals
  let resolvedChannel: string
  try {
    resolvedChannel = (await resolveRuntimeChannelRef({ channels }, settings.channel)).resolved
  } catch (err) {
    log.error('Approval channel resolution failed — record stays board-only', err, { approvalId: record.approvalId, channel: settings.channel })
    return null
  }
  try {
    const handler = getApprovalKind(record.owner.kind)
    const deliveries = handler?.render
      ? await handler.render(record, channels, resolvedChannel)
      : (await channels.createApproval({ approvalId: record.approvalId, channels: [resolvedChannel], request: record.request })).deliveries
    updateApprovalDeliveries(record.approvalId, deliveries)
    return deliveries
  } catch (err) {
    log.warn('Approval channel render failed — record stays board-only', { approvalId: record.approvalId, err: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/** Create (idempotently) and announce an approval; channel rendering is fire-and-forget. */
export function requestApproval(input: RequestApprovalInput): ApprovalRecord {
  const record = createApprovalRecord(input)
  if (record.status !== 'pending') return record
  publishPending(record)
  if (getSettings().approvals.channelAlerts && runtimeChannels()) {
    void renderApprovalOnChannel(record)
  }
  return record
}

// Resolves in flight — a second resolver for the same id (Health card +
// Discord button) is refused before its handler runs (plan review R1).
const inFlight = new Set<string>()

/**
 * Apply a decision: refuse unknown/non-pending/in-flight ids with typed
 * errors, run the kind handler (its throw leaves the record pending), then
 * resolve the record (compare-and-set), tell the channel, and publish.
 */
export async function resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<ApprovalRecord> {
  return (await resolveApprovalWithResult(approvalId, decision)).record
}

/** `resolveApproval` plus whatever the kind handler returned (e.g. an apply report). */
export async function resolveApprovalWithResult(approvalId: string, decision: ApprovalDecision): Promise<{ record: ApprovalRecord; result: unknown }> {
  const record = getApprovalRecord(approvalId)
  if (!record) throw new ApprovalNotFoundError(approvalId)
  if (record.status !== 'pending') throw new ApprovalNotPendingError(approvalId, record.status)
  if (inFlight.has(approvalId)) throw new ApprovalNotPendingError(approvalId, 'resolving')
  const handler = getApprovalKind(record.owner.kind)
  if (!handler) throw new ApprovalKindUnavailableError(record.owner.kind)

  inFlight.add(approvalId)
  try {
    const result = await handler.onResolve(record, decision)
    const response: ApprovalResponse = {
      selectedOption: decision.option,
      respondedAt: decision.respondedAt ?? new Date().toISOString(),
      actor: { type: 'human', id: decision.actor.id, ...(decision.actor.displayName ? { displayName: decision.actor.displayName } : {}) },
      ...(decision.comment ? { comment: decision.comment } : {}),
    }
    const resolved = resolveApprovalRecord(approvalId, response)
    const channels = runtimeChannels()
    if (channels && resolved.deliveries.length > 0) {
      try {
        await channels.resolveApproval({ approvalId, deliveries: resolved.deliveries, response })
      } catch (err) {
        log.warn('Approval channel resolve notification failed', { approvalId, err: err instanceof Error ? err.message : String(err) })
      }
    }
    publishResolved(resolved)
    log.info('Approval resolved', { approvalId, kind: record.owner.kind, option: decision.option, by: decision.actor.source })
    return { record: resolved, result }
  } finally {
    inFlight.delete(approvalId)
  }
}

/** Withdraw a pending approval (owner moved on, plan changed, incidents resolved). Idempotent. */
export async function cancelApproval(approvalId: string, reason: string): Promise<ApprovalRecord | null> {
  const before = getApprovalRecord(approvalId)
  const cancelled = cancelApprovalRecord(approvalId, reason)
  if (!cancelled || !before || before.status !== 'pending') return cancelled
  const channels = runtimeChannels()
  if (channels && cancelled.deliveries.length > 0) {
    try {
      await channels.cancelApproval({ approvalId, deliveries: cancelled.deliveries, reason })
    } catch (err) {
      log.warn('Approval channel cancel notification failed', { approvalId, err: err instanceof Error ? err.message : String(err) })
    }
  }
  publishResolved(cancelled)
  return cancelled
}

export function listPendingApprovals(filter: { taskIds?: readonly string[] } = {}): ApprovalRecord[] {
  return listApprovalRecords({ status: 'pending', ...(filter.taskIds ? { taskIds: filter.taskIds } : {}) })
}
