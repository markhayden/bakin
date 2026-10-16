/**
 * Operations HTTP surface (#895 D3/D6/D9).
 *
 *   GET  /api/operations                    → { bootId, operations }
 *   GET  /api/operations/:id[?children=1]   → { bootId, operation, children? } · 404 { bootId }
 *   POST /api/operations/:id/cancel         → 202 cancelling · 409 not_cancellable | already_finished · 404
 *
 * Every answer carries the server's boot id: a client holding a different one
 * knows the server restarted (outcome unknown) rather than that the operation
 * expired. `startOperationResponse` is the start every converted route shares.
 */
import {
  OperationRejectedError,
  type OperationCancelResponse,
  type OperationGetResponse,
  type OperationListResponse,
  type OperationNotFoundResponse,
  type StartOperationInput,
} from '@bakin/core/operations'
import { getBootId } from '@/core/boot-id'
import { getOperationRegistry } from '@/core/operations'

const ITEM_PATH = /^\/api\/operations\/([^/]+)$/
const CANCEL_PATH = /^\/api\/operations\/([^/]+)\/cancel$/

export function operationIdFromPath(pathname: string): string | null {
  const match = ITEM_PATH.exec(pathname)
  return match ? decodeURIComponent(match[1]!) : null
}

export function cancelOperationIdFromPath(pathname: string): string | null {
  const match = CANCEL_PATH.exec(pathname)
  return match ? decodeURIComponent(match[1]!) : null
}

function notFound(): Response {
  const body: OperationNotFoundResponse = { bootId: getBootId(), error: 'not_found' }
  return Response.json(body, { status: 404 })
}

export async function list(): Promise<Response> {
  const body: OperationListResponse = { bootId: getBootId(), operations: getOperationRegistry().list() }
  return Response.json(body)
}

export async function get(_req: Request, url: URL): Promise<Response> {
  const id = operationIdFromPath(url.pathname)
  const registry = getOperationRegistry()
  const operation = id ? registry.get(id) : null
  if (!operation) return notFound()
  const body: OperationGetResponse = { bootId: getBootId(), operation }
  if (url.searchParams.get('children') === '1') {
    body.children = operation.children.map((childId) => registry.get(childId)).filter((v) => v !== null)
  }
  return Response.json(body)
}

const CANCEL_STATUS = { cancelling: 202, not_cancellable: 409, already_finished: 409, not_found: 404 } as const

export async function cancel(_req: Request, url: URL): Promise<Response> {
  const id = cancelOperationIdFromPath(url.pathname)
  const status = id ? getOperationRegistry().cancel(id) : 'not_found'
  const body: OperationCancelResponse = { bootId: getBootId(), status }
  return Response.json(body, { status: CANCEL_STATUS[status] })
}

/**
 * The converted-route start: validate synchronously (an
 * `OperationRejectedError` keeps today's status and body), then 202
 * `{ operationId, bootId }` — or 200 `{ …, attached: true }` for an identical
 * live request — while the work runs.
 */
export async function startOperationResponse<B>(input: StartOperationInput<B>): Promise<Response> {
  try {
    const started = await getOperationRegistry().start(input)
    return Response.json(started, { status: started.attached ? 200 : 202 })
  } catch (err) {
    if (err instanceof OperationRejectedError) return Response.json(err.body, { status: err.httpStatus })
    throw err
  }
}
