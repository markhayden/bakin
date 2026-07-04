import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import type { HealthCheckResult } from '../../packages/core/src/plugin-types'
import type { DoctorRepairPlanReport } from './doctor-repair'

export type DoctorRepairRequestStatus = 'planned' | 'sent' | 'completed' | 'verified' | 'failed'

export interface DoctorRepairRequestEvent {
  ts: string
  type: string
  message: string
  data?: Record<string, unknown>
}

export interface DoctorRepairRequest {
  id: string
  kind: 'delegate'
  status: DoctorRepairRequestStatus
  createdAt: string
  updatedAt: string
  plan: DoctorRepairPlanReport
  unresolved: HealthCheckResult[]
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

function repairRoot(contentDir: string): string {
  return join(contentDir, 'doctor', 'repair-requests')
}

function requestPath(contentDir: string, request: Pick<DoctorRepairRequest, 'id' | 'createdAt'>): string {
  return join(repairRoot(contentDir), monthShard(request.createdAt), `${request.id}.json`)
}

function readRequestFile(path: string): DoctorRepairRequest {
  return JSON.parse(readFileSync(path, 'utf-8')) as DoctorRepairRequest
}

function findRequestPath(contentDir: string, requestId: string): string | null {
  const root = repairRoot(contentDir)
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
    plan: DoctorRepairPlanReport
    unresolved: HealthCheckResult[]
    events?: DoctorRepairRequestEvent[]
  },
): DoctorRepairRequest {
  const ts = nowIso()
  const id = `repair-${crypto.randomUUID()}`
  const request: DoctorRepairRequest = {
    id,
    kind: 'delegate',
    status: 'planned',
    createdAt: ts,
    updatedAt: ts,
    plan: input.plan,
    unresolved: input.unresolved,
    events: input.events ?? [{
      ts,
      type: 'created',
      message: 'Delegated doctor repair request planned.',
    }],
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
  if (!path) throw new Error(`Doctor repair request not found: ${requestId}`)
  const current = readRequestFile(path)
  const next = { ...update(current), updatedAt: nowIso() }
  atomicWriteJson(path, next)
  return next
}

export function appendDoctorRepairRequestEvent(
  contentDir: string,
  requestId: string,
  event: Omit<DoctorRepairRequestEvent, 'ts'>,
): DoctorRepairRequest {
  return updateDoctorRepairRequest(contentDir, requestId, request => ({
    ...request,
    events: [...request.events, { ...event, ts: nowIso() }],
  }))
}

export function listDoctorRepairRequests(contentDir: string): DoctorRepairRequest[] {
  const root = repairRoot(contentDir)
  if (!existsSync(root)) return []
  const requests: DoctorRepairRequest[] = []
  for (const shard of readdirSync(root)) {
    const dir = join(root, shard)
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue
      requests.push(readRequestFile(join(dir, file)))
    }
  }
  return requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
