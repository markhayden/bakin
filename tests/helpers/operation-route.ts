/**
 * Route tests for converted routes (#895): a 202 `{ operationId, bootId }`
 * is awaited on the process registry and turned back into the Response the
 * route answered before it became an operation (the operation's result
 * status and body), so a test asserts on the outcome exactly as before.
 * Anything else — a synchronous 4xx, a GET — passes through untouched.
 */
import { getOperationRegistry } from '../../src/core/operations'

/** The status a settled operation without a result maps to (cancelled → 499, anything else → 500). */
const NO_RESULT_STATUS = { cancelled: 499 } as Record<string, number>

export async function settleRoute(response: Response | Promise<Response>): Promise<Response> {
  const res = await response
  const text = await res.text()
  const body = text ? JSON.parse(text) as Record<string, unknown> : null
  if ((res.status !== 202 && res.status !== 200) || typeof body?.operationId !== 'string') {
    return new Response(text, { status: res.status, headers: res.headers })
  }
  const view = await getOperationRegistry().await(body.operationId)
  if (!view.result) return Response.json({ ok: false, error: `operation ${view.status}`, operation: view }, { status: NO_RESULT_STATUS[view.status] ?? 500 })
  return Response.json(view.result.body, { status: view.result.httpStatus })
}
