import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import type {
  ApprovalDelivery,
  ApprovalRenderRef,
  ApprovalResponse,
  CreateApprovalArgs,
  DurableApprovalRecord,
} from '@bakin/core/adapters/runtime'
import { getContentDir } from './content-dir'

export type ApprovalOwner = DurableApprovalRecord['owner']
export type ApprovalStatus = DurableApprovalRecord['status']

function approvalsDir(contentDir: string): string {
  return join(contentDir, 'workflows', 'approvals')
}

function approvalPath(contentDir: string, approvalId: string): string {
  return join(approvalsDir(contentDir), `${encodeURIComponent(approvalId)}.json`)
}

function readRecord(path: string): DurableApprovalRecord | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8')) as DurableApprovalRecord
}

function writeRecord(record: DurableApprovalRecord, contentDir: string): DurableApprovalRecord {
  atomicWriteJson(approvalPath(contentDir, record.approvalId), record, { trailingNewline: false })
  return record
}

function responseStatus(response: ApprovalResponse): ApprovalStatus {
  if (response.selectedOption === 'approve') return 'approved'
  if (response.selectedOption === 'reject') return 'rejected'
  return 'approved'
}

export function createApprovalRecord(
  args: {
    approvalId: string
    owner: ApprovalOwner
    request: CreateApprovalArgs['request']
    createdAt?: string
  },
  contentDir = getContentDir(),
): DurableApprovalRecord {
  const now = args.createdAt ?? new Date().toISOString()
  const existing = readRecord(approvalPath(contentDir, args.approvalId))
  if (existing) {
    if (existing.status !== 'pending') return existing
    return writeRecord({
      ...existing,
      owner: args.owner,
      request: args.request,
      updatedAt: now,
    }, contentDir)
  }

  return writeRecord({
    approvalId: args.approvalId,
    owner: args.owner,
    status: 'pending',
    request: args.request,
    deliveries: [],
    createdAt: now,
    updatedAt: now,
  }, contentDir)
}

export function getApprovalRecord(approvalId: string, contentDir = getContentDir()): DurableApprovalRecord | null {
  return readRecord(approvalPath(contentDir, approvalId))
}

export function listApprovalRecords(contentDir = getContentDir()): DurableApprovalRecord[] {
  const dir = approvalsDir(contentDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readRecord(join(dir, name)))
    .filter((record): record is DurableApprovalRecord => record !== null)
}

export function updateApprovalDeliveries(
  approvalId: string,
  deliveries: ApprovalDelivery[],
  contentDir = getContentDir(),
): DurableApprovalRecord | null {
  const existing = getApprovalRecord(approvalId, contentDir)
  if (!existing) return null
  if (existing.status !== 'pending') return existing
  return writeRecord({
    ...existing,
    deliveries,
    updatedAt: new Date().toISOString(),
  }, contentDir)
}

export function resolveApprovalRecord(
  approvalId: string,
  response: ApprovalResponse,
  contentDir = getContentDir(),
): DurableApprovalRecord | null {
  const existing = getApprovalRecord(approvalId, contentDir)
  if (!existing) return null
  if (existing.status !== 'pending') return existing
  const now = response.respondedAt || new Date().toISOString()
  return writeRecord({
    ...existing,
    status: responseStatus(response),
    response,
    resolvedAt: now,
    updatedAt: now,
  }, contentDir)
}

export function cancelApprovalRecord(
  approvalId: string,
  reason?: string,
  contentDir = getContentDir(),
): DurableApprovalRecord | null {
  const existing = getApprovalRecord(approvalId, contentDir)
  if (!existing) return null
  if (existing.status !== 'pending') return existing
  const now = new Date().toISOString()
  return writeRecord({
    ...existing,
    status: 'cancelled',
    response: reason
      ? {
          selectedOption: 'cancel',
          respondedAt: now,
          actor: { type: 'human', id: 'system', displayName: 'system' },
          comment: reason,
        }
      : existing.response,
    resolvedAt: now,
    updatedAt: now,
  }, contentDir)
}

export function deleteApprovalRecord(approvalId: string, contentDir = getContentDir()): boolean {
  const path = approvalPath(contentDir, approvalId)
  if (!existsSync(path)) return false
  unlinkSync(path)
  return true
}

const PRUNABLE_STATUSES: ReadonlySet<ApprovalStatus> = new Set(['approved', 'rejected', 'cancelled', 'expired'])

/**
 * Delete resolved approval records older than maxAgeMs. Pending records are
 * never pruned, regardless of age — orphan handling happens at rehydration.
 */
export function pruneResolvedApprovalRecords(maxAgeMs: number, contentDir = getContentDir()): number {
  const cutoff = Date.now() - maxAgeMs
  let pruned = 0
  for (const record of listApprovalRecords(contentDir)) {
    if (!PRUNABLE_STATUSES.has(record.status)) continue
    const resolvedAt = Date.parse(record.resolvedAt ?? record.updatedAt)
    if (Number.isNaN(resolvedAt) || resolvedAt >= cutoff) continue
    if (deleteApprovalRecord(record.approvalId, contentDir)) pruned += 1
  }
  return pruned
}

export function findPendingApprovalForGate(
  taskId: string,
  stepId: string,
  contentDir = getContentDir(),
): DurableApprovalRecord | null {
  return listApprovalRecords(contentDir)
    .filter((record) =>
      record.status === 'pending'
      && record.owner.taskId === taskId
      && record.owner.stepId === stepId
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null
}

export function approvalRefFromRecord(record: DurableApprovalRecord | null | undefined): ApprovalRenderRef | undefined {
  if (!record) return undefined
  return { approvalId: record.approvalId, deliveries: record.deliveries }
}
