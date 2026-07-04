/**
 * Request validation middleware for Bakin.
 * Validates Content-Type, parses JSON bodies, and provides helpers.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import { createLogger } from './logger'
import {
  isRequestBodyTooLargeError,
  readJsonBody,
  type ReadRequestBodyOptions,
} from './request-body'

const log = createLogger('middleware')

/**
 * Parse a JSON body from an IncomingMessage.
 * Returns the parsed object or null if parsing fails.
 */
export async function parseJsonBody(
  req: IncomingMessage,
  options: ReadRequestBodyOptions = {},
): Promise<Record<string, unknown> | null> {
  try {
    const body = await readJsonBody(req, options)
    return body && typeof body === 'object' ? body as Record<string, unknown> : null
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) throw err
    return null
  }
}

/**
 * Web-`Request` twin of parseJsonBody for Fetch-style handlers
 * (packages/host/src/api/**): same lenient contract — the parsed object, or
 * null when the body is empty, invalid JSON, or not an object. Size limits are
 * enforced upstream by the Node→Web adapter's readRequestBody.
 */
export async function parseJsonBodyWeb(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json()
    // Same object test as parseJsonBody (arrays included) so downstream zod
    // validation sees identical inputs on either path.
    return body && typeof body === 'object' ? body as Record<string, unknown> : null
  } catch {
    return null
  }
}

/**
 * Validate that a POST/PUT/DELETE request has a JSON content type.
 * Returns true if valid, sends 400 and returns false if not.
 */
export function validateJsonContentType(req: IncomingMessage, res: ServerResponse): boolean {
  const method = req.method?.toUpperCase()
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    const contentType = req.headers['content-type']
    if (!contentType || !contentType.includes('application/json')) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Content-Type must be application/json' }))
      return false
    }
  }
  return true
}

/**
 * Send a JSON response.
 */
export function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

/**
 * Handle a JSON POST request with validation and error handling.
 */
export async function handleJsonPost(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (body: Record<string, unknown>) => Promise<unknown>,
  options: ReadRequestBodyOptions = {},
): Promise<void> {
  if (!validateJsonContentType(req, res)) return

  let body: Record<string, unknown> | null
  try {
    body = await parseJsonBody(req, options)
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      jsonResponse(res, 413, { error: err.message })
      return
    }
    throw err
  }
  if (!body) {
    jsonResponse(res, 400, { error: 'Invalid JSON body' })
    return
  }

  try {
    const result = await handler(body)
    jsonResponse(res, 200, result ?? { ok: true })
  } catch (err) {
    log.error('Request handler error', err)
    jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}
