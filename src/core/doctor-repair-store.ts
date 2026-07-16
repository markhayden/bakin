import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import type { HealthRepairPlan } from '../../packages/core/src/plugin-types'

/** Typed absence — routes map to 404 by instanceof, never message text. */
export class DoctorRepairRequestNotFoundError extends Error {
  constructor(requestId: string) {
    super(`Doctor repair request not found: ${requestId}`)
    this.name = 'DoctorRepairRequestNotFoundError'
  }
}

export type DoctorRepairRequestStatus = 'planned' | 'sent' | 'completed' | 'verified' | 'failed'

export interface DoctorRepairRequestEvent {
  ts: string
  type: string
  message: string
  data?: Record<string, unknown>
}

export interface DoctorRepairRequest {
  version: 2
  id: string
  kind: 'delegate'
  status: DoctorRepairRequestStatus
  createdAt: string
  updatedAt: string
  plan: HealthRepairPlan
  incidentIds: string[]
  observationIds: string[]
  taskId?: string
  agentId?: string
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
  return parsed
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

export function createDoctorRepairRequest(
  contentDir: string,
  input: {
    plan: HealthRepairPlan
    incidentIds: string[]
    observationIds: string[]
    events?: DoctorRepairRequestEvent[]
  },
): DoctorRepairRequest {
  const ts = nowIso()
  const request: DoctorRepairRequest = {
    version: 2,
    id: `repair-${crypto.randomUUID()}`,
    kind: 'delegate',
    status: 'planned',
    createdAt: ts,
    updatedAt: ts,
    plan: structuredClone(input.plan),
    incidentIds: [...new Set(input.incidentIds)].sort(),
    observationIds: [...new Set(input.observationIds)].sort(),
    events: input.events ?? [{ ts, type: 'created', message: 'Delegated Health repair request planned.' }],
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
