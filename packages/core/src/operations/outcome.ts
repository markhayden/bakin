/**
 * A converted route's outcome (D22) from the status and body it answered
 * before it became an operation: clients read `result.body` exactly as they
 * read the response, and the summary carries the error text for the tray.
 */
import type { OperationOutcome } from '@makinbakin/sdk/types'

const FAILURE_CODES: Record<number, string> = {
  400: 'invalid_request',
  404: 'not_found',
  409: 'conflict',
}

export function responseOutcome<B>(httpStatus: number, body: B, code?: string): OperationOutcome<B> {
  const ok = httpStatus < 400
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
  return {
    status: ok ? 'succeeded' : 'failed',
    code: code ?? (ok ? 'ok' : FAILURE_CODES[httpStatus] ?? 'failed'),
    ...(!ok && typeof error === 'string' ? { message: error } : {}),
    httpStatus,
    body,
  }
}
