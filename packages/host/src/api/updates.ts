/**
 * Updates HTTP surface (#1007, D7.1/D7.5/D7.8).
 *
 *   GET  /api/updates                       → { bootId, records, generatedAt, running }
 *   POST /api/updates/check[?source=|?id=]  → 202 { bootId, ids, coalesced } (pass runs on; `wait=1` ⇒ 200 with the snapshot)
 *   POST /api/updates/:id/skip              → { bootId, record } · 404 · 409 nothing_to_skip
 *
 * Every answer carries the boot id (expired vs restarted). The apply
 * surface (`apply-preview`, `apply`) lives in its own slice. Before the
 * engine starts (or on a serverless CLI path) the surface is 503.
 */
import { UPDATE_SUBJECT_KINDS, type UpdateRecord, type UpdatesSnapshot } from '@makinbakin/sdk/types'
import { getBootId } from '@/core/boot-id'
import { createLogger } from '@/core/logger'
import { UpdateSubjectNotFoundError } from '@/core/updates/engine'
import { getUpdatesEngine, getUpdatesTimer } from '@/core/updates/service'

const log = createLogger('updates-routes')

const SKIP_PATH = /^\/api\/updates\/([^/]+)\/skip$/

export function skipUpdateIdFromPath(pathname: string): string | null {
  const match = SKIP_PATH.exec(pathname)
  return match ? decodeURIComponent(match[1]!) : null
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
  const ids = url.searchParams.getAll('id')
  const wait = url.searchParams.get('wait') === '1'
  // Refuse unknown ids before anything runs — the timer throws before starting a pass.
  const inventory = await engine.inventory()
  const known = new Set(inventory.map((entry) => `${entry.subject.kind}:${entry.subject.id}`))
  const missing = ids.find((id) => !known.has(id))
  if (missing) return Response.json({ bootId: getBootId(), error: 'not_found', id: missing }, { status: 404 })
  const run = timer.check({ ...(kind ? { kind } : {}), ...(ids.length > 0 ? { ids } : {}) })
  if (!wait) {
    run.catch((err: unknown) => {
      if (!(err instanceof UpdateSubjectNotFoundError)) log.error('Update check pass failed', err)
    })
    // The pass may already have reached its subjects; the ids are what was asked for.
    const requested = ids.length > 0 ? ids : [...known].filter((id) => !kind || id.startsWith(`${kind}:`))
    const body: UpdatesCheckResponse = { bootId: getBootId(), ids: requested, coalesced: timer.running() }
    return Response.json(body, { status: 202 })
  }
  const result = await run
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
    if (err instanceof Error && /nothing to skip/.test(err.message)) {
      return Response.json({ bootId: getBootId(), error: 'nothing_to_skip', id, message: err.message }, { status: 409 })
    }
    throw err
  }
}
