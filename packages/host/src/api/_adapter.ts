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
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(chunk as Buffer)
      }
      if (chunks.length > 0) body = Buffer.concat(chunks)
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

    const webReq = new Request(url, {
      method: req.method,
      headers,
      body,
    })

    const webRes = await handler(webReq, url)

    // Translate Web Response → Node ServerResponse.
    const nodeHeaders: Record<string, string> = {}
    webRes.headers.forEach((value, key) => {
      nodeHeaders[key] = value
    })
    res.writeHead(webRes.status, nodeHeaders)

    if (webRes.body) {
      const buf = Buffer.from(await webRes.arrayBuffer())
      res.end(buf)
    } else {
      res.end()
    }
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }
}
