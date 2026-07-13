/**
 * Node ↔ Web Request/Response adapter.
 *
 * Bakin's server.ts currently uses Node's `http.createServer((req, res) => ...)`
 * (transitional — Phase C replaces with `Bun.serve()`). Phase B moves API
 * routes out of `src/app/api/**` (Next.js App Router) into plain functions
 * at `packages/host/src/api/**` that take a Web `Request` and return a Web
 * `Response`. This adapter bridges server.ts's Node callbacks to those
 * handlers so the migration is incremental.
 *
 * When Phase C swaps `createServer` for `Bun.serve({ fetch })`, the adapter
 * evaporates — handlers are already in the shape Bun.serve expects.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import {
  DEFAULT_MAX_WEB_REQUEST_BODY_BYTES,
  isRequestBodyTooLargeError,
  readRequestBody,
} from '@/core/request-body'
import {
  canCompressResponse,
  encodeResponseBody,
} from './compression'

export type WebHandler = (req: Request, url: URL) => Promise<Response> | Response

/**
 * Dispatch a Web-style handler from a Node `(req, res)` callback.
 * Reads the request body (if present), builds a Web `Request`, calls the
 * handler, and writes the `Response` back to `res`.
 *
 * Callers must invoke `return` after this (don't fall through to other
 * handlers in the same callback).
 */
export async function dispatchWebHandler(
  req: IncomingMessage,
  res: ServerResponse,
  handler: WebHandler,
): Promise<void> {
  try {
    const host = req.headers.host || 'localhost'
    const url = new URL(req.url || '/', `http://${host}`)

    // Read request body for non-GET/HEAD requests.
    let body: BodyInit | undefined = undefined
    if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
      const rawBody = await readRequestBody(req, { maxBytes: DEFAULT_MAX_WEB_REQUEST_BODY_BYTES })
      if (rawBody) body = new Uint8Array(rawBody)
    }

    // Normalize headers: Node's object → Web Headers.
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) {
        for (const item of v) headers.append(k, item)
      } else if (v !== undefined) {
        headers.set(k, v)
      }
    }

    // Client disconnects must reach handlers: long-lived routes (SSE turn
    // streams) pass `req.signal` into runtime work, and without this wiring
    // an aborted brainstorm kept the agent turn running (and billing) to
    // completion server-side. (`on` guarded — test doubles stub a minimal res.)
    const abort = new AbortController()
    if (typeof res.on === 'function') {
      res.on('close', () => {
        if (!res.writableEnded) abort.abort()
      })
    }

    const webReq = new Request(url, {
      method: req.method,
      headers,
      body,
      signal: abort.signal,
    })

    const webRes = await handler(webReq, url)

    // Translate Web Response → Node ServerResponse.
    const nodeHeaders: Record<string, string> = {}
    webRes.headers.forEach((value, key) => {
      nodeHeaders[key] = value
    })
    if (webRes.body) {
      if (canCompressResponse(req, webRes.status, nodeHeaders)) {
        const plain = Buffer.from(await webRes.arrayBuffer())
        const encoded = await encodeResponseBody(req, webRes.status, nodeHeaders, plain)
        res.writeHead(webRes.status, encoded.headers)
        res.end(encoded.body)
      } else {
        res.writeHead(webRes.status, nodeHeaders)
        res.flushHeaders?.()
        await writeWebResponseBody(res, webRes.body)
      }
    } else {
      res.writeHead(webRes.status, nodeHeaders)
      res.flushHeaders?.()
      res.end()
    }
  } catch (err) {
    if (!res.headersSent) {
      const status = isRequestBodyTooLargeError(err) ? 413 : 500
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }
}

async function writeWebResponseBody(
  res: ServerResponse,
  body: ReadableStream<Uint8Array>,
): Promise<void> {
  const reader = body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      const canContinue = res.write(Buffer.from(value))
      if (!canContinue) {
        await new Promise<void>((resolve) => res.once('drain', resolve))
      }
    }
    res.end()
  } finally {
    reader.releaseLock()
  }
}
