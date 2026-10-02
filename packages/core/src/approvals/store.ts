/**
 * Durable approval record store — <contentDir>/approvals/<encoded id>.json.
 *
 * Ported from the workflows plugin's gate-only store (spec D6): records are
 * written atomically, validated with zod on read, and resolved with a
 * compare-and-set on `status: 'pending'` so of two simultaneous resolvers
 * (Health card + Discord button) exactly one wins and the other receives
 * ApprovalNotPendingError (plan review R1). Pending records are never pruned.
 */
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { ApprovalDelivery, ApprovalRenderRef, ApprovalResponse } from '../adapters/runtime/channels'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'
import { atomicWriteJson } from '../storage/atomic-write'
import { ApprovalNotFoundError, ApprovalNotPendingError } from './errors'
import { parseApprovalRecord } from './schema'
import type { ApprovalListFilter, ApprovalOwner, ApprovalRecord, ApprovalRequest, ApprovalStatus } from './types'

const log = createLogger('approvals-store')

export function approvalsDir(contentDir = getContentDir()): string {
  return join(contentDir, 'approvals')
}

function approvalPath(approvalId: string, contentDir: string): string {
  return join(approvalsDir(contentDir), `${encodeURIComponent(approvalId)}.json`)
}

function readRecord(path: string): ApprovalRecord | null {
  if (!existsSync(path)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    log.warn('Approval record is not readable JSON — skipped', { path, err: err instanceof Error ? err.message : String(err) })
    return null
  }
  const record = parseApprovalRecord(raw)
  if (!record) log.warn('Approval record failed schema validation — skipped', { path })
  return record
}

function writeRecord(record: ApprovalRecord, contentDir: string): ApprovalRecord {
  atomicWriteJson(approvalPath(record.approvalId, contentDir), record, { trailingNewline: false })
  return record
}

/** Coarse status from the chosen option; the raw option id on `response` is the truth. */
function statusForOption(option: string): ApprovalStatus {
  if (option === 'reject' || option === 'dismiss') return 'rejected'
  return 'approved'
}

export interface CreateApprovalRecordInput {
  approvalId: string
  owner: ApprovalOwner
  request: ApprovalRequest
  createdAt?: string
}

/**
 * Idempotent create: an existing PENDING record is refreshed (owner +
 * request); an existing resolved record is returned untouched so a replay
 * can never reopen a decision.
 */
export function createApprovalRecord(input: CreateApprovalRecordInput, contentDir = getContentDir()): ApprovalRecord {
  const now = input.createdAt ?? new Date().toISOString()
  const existing = readRecord(approvalPath(input.approvalId, contentDir))
  if (existing) {
    if (existing.status !== 'pending') return existing
    return writeRecord({ ...existing, owner: input.owner, request: input.request, updatedAt: now }, contentDir)
  }
  return writeRecord({
    approvalId: input.approvalId,
    owner: input.owner,
    status: 'pending',
    request: input.request,
    deliveries: [],
    createdAt: now,
    updatedAt: now,
  }, contentDir)
}

export function getApprovalRecord(approvalId: string, contentDir = getContentDir()): ApprovalRecord | null {
  return readRecord(approvalPath(approvalId, contentDir))
}

export function listApprovalRecords(filter: ApprovalListFilter = {}, contentDir = getContentDir()): ApprovalRecord[] {
  const dir = approvalsDir(contentDir)
  if (!existsSync(dir)) return []
  const taskIds = filter.taskIds ? new Set(filter.taskIds) : null
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readRecord(join(dir, name)))
    .filter((record): record is ApprovalRecord => record !== null)
    .filter((record) => !filter.status || record.status === filter.status)
    .filter((record) => !filter.kind || record.owner.kind === filter.kind)
    .filter((record) => !taskIds || taskIds.has(record.owner.taskId))
}

export function updateApprovalDeliveries(
  approvalId: string,
  deliveries: ApprovalDelivery[],
  contentDir = getContentDir(),
): ApprovalRecord | null {
  const existing = getApprovalRecord(approvalId, contentDir)
  if (!existing) return null
  if (existing.status !== 'pending') return existing
  return writeRecord({ ...existing, deliveries, updatedAt: new Date().toISOString() }, contentDir)
}

/**
 * Compare-and-set resolve. Throws ApprovalNotFoundError for an unknown id and
 * ApprovalNotPendingError when another resolver (or a cancel) already won —
 * the first decision stands, byte for byte.
 */
export function resolveApprovalRecord(
  approvalId: string,
  response: ApprovalResponse,
  contentDir = getContentDir(),
): ApprovalRecord {
  const existing = getApprovalRecord(approvalId, contentDir)
  if (!existing) throw new ApprovalNotFoundError(approvalId)
  if (existing.status !== 'pending') throw new ApprovalNotPendingError(approvalId, existing.status)
  const now = response.respondedAt || new Date().toISOString()
  return writeRecord({
    ...existing,
    status: statusForOption(response.selectedOption),
    response,
    resolvedAt: now,
    updatedAt: now,
  }, contentDir)
}

export function cancelApprovalRecord(
  approvalId: string,
  reason?: string,
  contentDir = getContentDir(),
): ApprovalRecord | null {
  const existing = getApprovalRecord(approvalId, contentDir)
  if (!existing) return null
  if (existing.status !== 'pending') return existing
  const now = new Date().toISOString()
  return writeRecord({
    ...existing,
    status: 'cancelled',
    response: reason
      ? { selectedOption: 'cancel', respondedAt: now, actor: { type: 'human', id: 'system', displayName: 'system' }, comment: reason }
      : existing.response,
    resolvedAt: now,
    updatedAt: now,
  }, contentDir)
}

export function deleteApprovalRecord(approvalId: string, contentDir = getContentDir()): boolean {
  const path = approvalPath(approvalId, contentDir)
  if (!existsSync(path)) return false
  unlinkSync(path)
  return true
}

const PRUNABLE_STATUSES: ReadonlySet<ApprovalStatus> = new Set(['approved', 'rejected', 'cancelled', 'expired'])

/** Delete resolved records older than maxAgeMs. Pending records are never pruned — orphans are rehydration's call. */
export function pruneResolvedApprovalRecords(maxAgeMs: number, contentDir = getContentDir()): number {
  const cutoff = Date.now() - maxAgeMs
  let pruned = 0
  for (const record of listApprovalRecords({}, contentDir)) {
    if (!PRUNABLE_STATUSES.has(record.status)) continue
    const resolvedAt = Date.parse(record.resolvedAt ?? record.updatedAt)
    if (Number.isNaN(resolvedAt) || resolvedAt >= cutoff) continue
    if (deleteApprovalRecord(record.approvalId, contentDir)) pruned += 1
  }
  return pruned
}

/** Newest pending record matching the predicate (by updatedAt), or null. */
export function findPendingApproval(
  predicate: (record: ApprovalRecord) => boolean,
  contentDir = getContentDir(),
): ApprovalRecord | null {
  return listApprovalRecords({ status: 'pending' }, contentDir)
    .filter(predicate)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null
}

export function approvalRefFromRecord(record: ApprovalRecord | null | undefined): ApprovalRenderRef | undefined {
  if (!record) return undefined
  return { approvalId: record.approvalId, deliveries: record.deliveries }
}
