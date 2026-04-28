import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
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
  const dir = approvalsDir(contentDir)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = approvalPath(contentDir, record.approvalId)
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf-8')
  renameSync(tmp, path)
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
