/**
 * Updates HTTP surface (#1007, D7.1/D7.5/D7.8).
 *
 *   GET  /api/updates                       → { bootId, records, generatedAt, running }
 *   POST /api/updates/check[?source=|?id=]  → 202 { bootId, ids, coalesced } (pass runs on; `wait=1` ⇒ 200 with the snapshot;
 *                                             `ifStale=1` ⇒ only the named ids not attempted in the last 10 min)
 *   POST /api/updates/:id/skip              → { bootId, record } · 404 · 409 nothing_to_skip | required
 *   GET  /api/updates/:id/apply-preview     → { bootId, preview } · 404 · 409 multiple_covering_approvals
 *   POST /api/updates/:id/apply             → 202 { operationId, bootId } (D7.4: resolves a covering approval
 *                                             by its full scope, or runs the subject's own flow) · 403 agents ·
 *                                             409 scope_changed | approval_required | nothing_to_apply | manual_action
 *
 * Every answer carries the boot id (expired vs restarted). Before the
 * engine starts (or on a serverless CLI path) the surface is 503.
 */
import { z } from 'zod'
import { approvalProvenanceFromRequest } from '@bakin/core/approvals/provenance'
import { OperationRejectedError, operationOriginFromRequest } from '@bakin/core/operations'
import { UPDATE_SUBJECT_KINDS, type UpdateRecord, type UpdatesSnapshot } from '@makinbakin/sdk/types'
import { ApprovalRefusedError, approvalErrorStatus } from '@/core/approvals/errors'
import { getBootId } from '@/core/boot-id'
import { createLogger } from '@/core/logger'
import { ApplyError, confirmApply, previewApply } from '@/core/updates/apply'
import { UpdateRequiredError, UpdateSubjectNotFoundError } from '@/core/updates/engine'
import { getUpdatesEngine, getUpdatesTimer } from '@/core/updates/service'
import { UpdatesStoppedError, type CheckAdmission } from '@/core/updates/timer'

const log = createLogger('updates-routes')

const SKIP_PATH = /^\/api\/updates\/([^/]+)\/skip$/
const PREVIEW_PATH = /^\/api\/updates\/([^/]+)\/apply-preview$/
const APPLY_PATH = /^\/api\/updates\/([^/]+)\/apply$/

export function skipUpdateIdFromPath(pathname: string): string | null {
  const match = SKIP_PATH.exec(pathname)
  return match ? decodeURIComponent(match[1]!) : null
}
export function applyPreviewIdFromPath(pathname: string): string | null {
  const match = PREVIEW_PATH.exec(pathname)
  return match ? decodeURIComponent(match[1]!) : null
}
export function applyIdFromPath(pathname: string): string | null {
  const match = APPLY_PATH.exec(pathname)
  return match ? decodeURIComponent(match[1]!) : null
}

const ApplyBodySchema = z.object({
  /** The available identity the caller reviewed (R2 #1); required whenever the record offers one. */
  target: z.object({ version: z.string().min(1).optional(), sha: z.string().min(1).optional(), digest: z.string().min(1).optional() }).optional(),
  approvalId: z.string().min(1).optional(),
  scopeHash: z.string().min(1).optional(),
  consentToken: z.string().min(1).optional(),
})

function applyFailure(err: unknown): Response | null {
  if (err instanceof ApplyError) return Response.json({ bootId: getBootId(), ...err.body() }, { status: err.status })
  if (err instanceof OperationRejectedError) return Response.json(err.body, { status: err.httpStatus })
  const approvalStatus = approvalErrorStatus(err)
  if (approvalStatus !== null) {
    return Response.json({
      bootId: getBootId(),
      error: 'approval_decision',
      message: err instanceof Error ? err.message : String(err),
      // Agent refusal vs a missing declaration, machine-readable (#898 D-H6).
      ...(err instanceof ApprovalRefusedError ? { refusalCode: err.code } : {}),
    }, { status: approvalStatus === 404 || approvalStatus === 503 ? 500 : approvalStatus })
  }
  return null
}

export async function applyPreview(_req: Request, url: URL): Promise<Response> {
  const id = applyPreviewIdFromPath(url.pathname)
  if (!id) return Response.json({ bootId: getBootId(), error: 'not_found' }, { status: 404 })
  try {
    const preview = await previewApply(id)
    return Response.json({ bootId: getBootId(), preview })
  } catch (err) {
    const failure = applyFailure(err)
    if (failure) return failure
    throw err
  }
}

export async function apply(req: Request, url: URL): Promise<Response> {
  const id = applyIdFromPath(url.pathname)
  if (!id) return Response.json({ bootId: getBootId(), error: 'not_found' }, { status: 404 })
  let raw: unknown = {}
  const text = await req.text()
  if (text.trim() !== '') {
    try {
      raw = JSON.parse(text)
    } catch {
      return Response.json({ bootId: getBootId(), error: 'invalid_body', message: 'Invalid JSON body' }, { status: 400 })
    }
  }
  const parsed = ApplyBodySchema.safeParse(raw)
  if (!parsed.success) return Response.json({ bootId: getBootId(), error: 'invalid_body', message: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  try {
    const result = await confirmApply(id, {
      ...parsed.data,
      provenance: approvalProvenanceFromRequest(req),
      origin: operationOriginFromRequest(req),
    })
    return Response.json({ ...result.started, ...(result.approvalId ? { approvalId: result.approvalId } : {}) }, { status: result.started.attached ? 200 : 202 })
  } catch (err) {
    const failure = applyFailure(err)
    if (failure) return failure
    log.error('Update apply failed to start', err, { id })
    throw err
  }
}

export interface UpdatesListResponse extends UpdatesSnapshot {
  bootId: string
}

export interface UpdatesCheckResponse {
  bootId: string
  ids: string[]
  coalesced: boolean
  /** Present with `wait=1`: the records after the pass finished. */
  records?: UpdateRecord[]
}

/** How recent an attempt must be for a page load to leave the subject alone. */
export const PAGE_LOAD_FRESH_MS = 10 * 60 * 1000

/**
 * Whether a page load should look at a subject again: never attempted, or
 * last attempted longer ago than `PAGE_LOAD_FRESH_MS`. A subject backing off
 * after failures (a rate limit) is left to its own schedule.
 */
export function isStaleForPageLoad(lastAttemptAt: string | undefined, schedule: { failures: number; nextDueAt?: string } | undefined, now: number): boolean {
  if (schedule && schedule.failures > 0 && schedule.nextDueAt && Date.parse(schedule.nextDueAt) > now) return false
  if (!lastAttemptAt) return true
  return now - Date.parse(lastAttemptAt) >= PAGE_LOAD_FRESH_MS
}

function unavailable(): Response {
  return Response.json({ bootId: getBootId(), error: 'updates_unavailable', message: 'The updates engine has not started on this server.' }, { status: 503 })
}

export async function list(): Promise<Response> {
  const engine = getUpdatesEngine()
  if (!engine) return unavailable()
  const snapshot = await engine.snapshot()
  const body: UpdatesListResponse = { bootId: getBootId(), ...snapshot }
  return Response.json(body)
}

export async function check(_req: Request, url: URL): Promise<Response> {
  const engine = getUpdatesEngine()
  const timer = getUpdatesTimer()
  if (!engine || !timer) return unavailable()
  const kind = url.searchParams.get('source') ?? undefined
  if (kind !== undefined && !(UPDATE_SUBJECT_KINDS as readonly string[]).includes(kind)) {
    return Response.json({ bootId: getBootId(), error: 'unknown_source', message: `"${kind}" is not an update subject kind` }, { status: 400 })
  }
  let ids = url.searchParams.getAll('id')
  const wait = url.searchParams.get('wait') === '1'
  // A page load asks "look again unless you just did" (`ifStale=1`, named
  // ids only): the server decides what "just" means, so reloading a tab, or
  // ten tabs, never becomes a probe per load.
  if (url.searchParams.get('ifStale') === '1') {
    if (ids.length === 0) return Response.json({ bootId: getBootId(), error: 'id_required', message: 'ifStale needs at least one id' }, { status: 400 })
    const snapshot = await engine.snapshot()
    const stale: string[] = []
    for (const id of ids) {
      const record = snapshot.records.find((candidate) => candidate.id === id)
      if (isStaleForPageLoad(record?.attempt?.at, await engine.scheduleFor(id), Date.now())) stale.push(id)
    }
    if (stale.length === 0) {
      const body: UpdatesCheckResponse = { bootId: getBootId(), ids: [], coalesced: false, ...(wait ? { records: snapshot.records } : {}) }
      return Response.json(body)
    }
    ids = stale
  }
  // ONE admission path: the timer refreshes the inventory (serialized with
  // every other pass startup — concurrent requests never fan out probes) and
  // refuses an id outside it before anything runs; a subject installed a
  // moment ago is known, one removed a moment ago is not.
  let admitted: CheckAdmission
  try {
    admitted = await timer.admit({ ...(kind ? { kind } : {}), ...(ids.length > 0 ? { ids } : {}) })
  } catch (err) {
    if (err instanceof UpdateSubjectNotFoundError) return Response.json({ bootId: getBootId(), error: 'not_found', id: err.id }, { status: 404 })
    if (err instanceof UpdatesStoppedError) return unavailable()
    throw err
  }
  if (!wait) {
    admitted.done.catch((err: unknown) => {
      // A subject that vanished between the answer and its turn is not an error worth a stack.
      if (!(err instanceof UpdateSubjectNotFoundError)) log.error('Update check pass failed', err)
    })
    const body: UpdatesCheckResponse = { bootId: getBootId(), ids: admitted.ids, coalesced: admitted.coalesced }
    return Response.json(body, { status: 202 })
  }
  let result: Awaited<CheckAdmission['done']>
  try {
    result = await admitted.done
  } catch (err) {
    // Admitted, then removed before its turn: the check never looked at it.
    if (err instanceof UpdateSubjectNotFoundError) return Response.json({ bootId: getBootId(), error: 'not_found', id: err.id }, { status: 404 })
    if (err instanceof UpdatesStoppedError) return unavailable()
    throw err
  }
  const snapshot = await engine.snapshot()
  const body: UpdatesCheckResponse = { bootId: getBootId(), ids: result.ids, coalesced: result.coalesced, records: snapshot.records }
  return Response.json(body)
}

export async function skip(_req: Request, url: URL): Promise<Response> {
  const engine = getUpdatesEngine()
  if (!engine) return unavailable()
  const id = skipUpdateIdFromPath(url.pathname)
  if (!id) return Response.json({ bootId: getBootId(), error: 'not_found' }, { status: 404 })
  try {
    const record = await engine.skip(id)
    return Response.json({ bootId: getBootId(), record })
  } catch (err) {
    if (err instanceof UpdateSubjectNotFoundError) return Response.json({ bootId: getBootId(), error: 'not_found', id }, { status: 404 })
    if (err instanceof UpdateRequiredError) return Response.json({ bootId: getBootId(), error: 'required', id, message: err.message }, { status: 409 })
    if (err instanceof Error && /nothing to skip/.test(err.message)) {
      return Response.json({ bootId: getBootId(), error: 'nothing_to_skip', id, message: err.message }, { status: 409 })
    }
    throw err
  }
}
