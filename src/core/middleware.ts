/**
 * Request validation middleware for Bakin.
 * Validates Content-Type, parses JSON bodies, and provides helpers.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import { createLogger } from './logger'

const log = createLogger('middleware')

/**
 * Parse a JSON body from an IncomingMessage.
 * Returns the parsed object or null if parsing fails.
 */
export function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
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
  handler: (body: Record<string, unknown>) => Promise<unknown>
): Promise<void> {
  if (!validateJsonContentType(req, res)) return

  const body = await parseJsonBody(req)
  if (!body) {
    jsonResponse(res, 400, { error: 'Invalid JSON body' })
    return
  }

  try {
    const result = await handler(body)
    jsonResponse(res, 200, result ?? { ok: true })
  } catch (err) {
    log.error('Request handler error', err)
    jsonResponse(res, 500, { error: String(err) })
  }
}
