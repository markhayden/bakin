import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import type { RepairProposal } from '@bakin/core/approvals'
import type { HealthRepairPlan } from '../../packages/core/src/plugin-types'

/** Typed absence — routes map to 404 by instanceof, never message text. */
export class DoctorRepairRequestNotFoundError extends Error {
  constructor(requestId: string) {
    super(`Doctor repair request not found: ${requestId}`)
    this.name = 'DoctorRepairRequestNotFoundError'
  }
}

/**
 * How a request resolves its incidents (spec D6/D7):
 *   delegate          — a repair task dispatched to the main agent
 *   approval-repair   — a review task holding a `health-repair` approval for a
 *                       frozen non-safe repair proposal (plan review R1)
 *   approval-navigate — a review task holding a `health-navigate` approval
 *                       (operator-only action; Dismiss is the one decision)
 */
export type DoctorRepairRequestKind = 'delegate' | 'approval-repair' | 'approval-navigate'

/**
 * planned → sent → (applying →) completed | verified | failed | dismissed.
 * `applying` is written BEFORE a repair mutates anything so a crash mid-apply
 * is recoverable (R1); `verified` means fresh targeted checks passed (R4).
 */
export type DoctorRepairRequestStatus = 'planned' | 'sent' | 'applying' | 'completed' | 'verified' | 'failed' | 'dismissed'

export interface DoctorRepairRequestEvent {
  ts: string
  type: string
  message: string
  data?: Record<string, unknown>
}

export interface DoctorRepairRequest {
  version: 2
  id: string
  kind: DoctorRepairRequestKind
  status: DoctorRepairRequestStatus
  createdAt: string
  updatedAt: string
  /** The plan at creation (informational); absent for navigate requests. */
  plan?: HealthRepairPlan
  incidentIds: string[]
  observationIds: string[]
  /** Check ids behind `observationIds` at creation — the fresh-verification target (R4). */
  checkIds: string[]
  taskId?: string
  agentId?: string
  /** approval-* kinds: the current (or last) approval record id. */
  approvalId?: string
  /** approval-repair: the frozen proposal the approval was granted for (R1). */
  proposal?: RepairProposal
  events: DoctorRepairRequestEvent[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function monthShard(dateIso: string): string {
  return dateIso.slice(0, 7)
}

/**
 * `doctor/repair-requests` is the immutable v1 archive. V2 deliberately uses
 * a distinct root and never lists or parses bytes from that legacy directory.
 */
export function repairRequestV2Root(contentDir: string): string {
  return join(contentDir, 'doctor', 'repair-requests-v2')
}

export function legacyRepairRequestArchiveRoot(contentDir: string): string {
  return join(contentDir, 'doctor', 'repair-requests')
}

function requestPath(contentDir: string, request: Pick<DoctorRepairRequest, 'id' | 'createdAt'>): string {
  return join(repairRequestV2Root(contentDir), monthShard(request.createdAt), `${request.id}.json`)
}

function readRequestFile(path: string): DoctorRepairRequest {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as DoctorRepairRequest
  if (parsed.version !== 2) throw new Error('Unsupported doctor repair request version')
  // Requests written before approvals lived in core carry neither field.
  return { ...parsed, kind: parsed.kind ?? 'delegate', checkIds: parsed.checkIds ?? [] }
}

function findRequestPath(contentDir: string, requestId: string): string | null {
  const root = repairRequestV2Root(contentDir)
  if (!existsSync(root)) return null
  for (const shard of readdirSync(root)) {
    const path = join(root, shard, `${requestId}.json`)
    if (existsSync(path)) return path
  }
  return null
}

const CREATED_MESSAGE: Record<DoctorRepairRequestKind, string> = {
  delegate: 'Delegated Health repair request planned.',
  'approval-repair': 'Health repair proposal awaiting approval.',
  'approval-navigate': 'Health incident awaiting operator action.',
}

export function createDoctorRepairRequest(
  contentDir: string,
  input: {
    kind?: DoctorRepairRequestKind
    plan?: HealthRepairPlan
    incidentIds: string[]
    observationIds: string[]
    checkIds?: string[]
    proposal?: RepairProposal
    events?: DoctorRepairRequestEvent[]
  },
): DoctorRepairRequest {
  const ts = nowIso()
  const kind = input.kind ?? 'delegate'
  const request: DoctorRepairRequest = {
    version: 2,
    id: `repair-${crypto.randomUUID()}`,
    kind,
    status: 'planned',
    createdAt: ts,
    updatedAt: ts,
    ...(input.plan ? { plan: structuredClone(input.plan) } : {}),
    incidentIds: [...new Set(input.incidentIds)].sort(),
    observationIds: [...new Set(input.observationIds)].sort(),
    checkIds: [...new Set(input.checkIds ?? [])].sort(),
    ...(input.proposal ? { proposal: structuredClone(input.proposal) } : {}),
    events: input.events ?? [{ ts, type: 'created', message: CREATED_MESSAGE[kind] }],
  }
  atomicWriteJson(requestPath(contentDir, request), request)
  return request
}

export function getDoctorRepairRequest(contentDir: string, requestId: string): DoctorRepairRequest | null {
  const path = findRequestPath(contentDir, requestId)
  return path ? readRequestFile(path) : null
}

export function updateDoctorRepairRequest(
  contentDir: string,
  requestId: string,
  update: (request: DoctorRepairRequest) => DoctorRepairRequest,
): DoctorRepairRequest {
  const path = findRequestPath(contentDir, requestId)
  if (!path) throw new DoctorRepairRequestNotFoundError(requestId)
  const current = readRequestFile(path)
  const next = { ...update(current), version: 2 as const, updatedAt: nowIso() }
  atomicWriteJson(path, next)
  return next
}

export function listDoctorRepairRequests(contentDir: string): DoctorRepairRequest[] {
  const root = repairRequestV2Root(contentDir)
  if (!existsSync(root)) return []
  const requests: DoctorRepairRequest[] = []
  for (const shard of readdirSync(root)) {
    const dir = join(root, shard)
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.json')) requests.push(readRequestFile(join(dir, file)))
    }
  }
  return requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
