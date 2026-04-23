/**
 * Dev SSE channel — `/api/dev/events`.
 *
 * Isolated from `src/core/sse.ts` so dev traffic never touches the
 * production broadcast path. Registered only when BAKIN_DEV=1 (server.ts
 * gates the route registration; this handler also rejects when unset so
 * misconfiguration can't leak the endpoint in production).
 *
 * Shape: Node-native IncomingMessage/ServerResponse. SSE streams can't
 * go through the Web Request/Response adapter — it buffers the body
 * before writing.
 */
import type { IncomingMessage, ServerResponse } from 'http'

export type DevScope = 'shell' | 'plugin' | 'sdk' | 'css' | 'server'

export type DevEvent =
  | { type: 'dev:ready' }
  | { type: 'dev:building'; scope: DevScope }
  | { type: 'dev:css' }
  | { type: 'dev:reload'; scope: DevScope }
  | { type: 'dev:hot-swap'; scope: 'plugin'; id: string; version: string }
  | { type: 'dev:error'; scope: DevScope; message: string; stderr?: string }
  | { type: 'dev:recover'; scope: DevScope }

const clients = new Set<ServerResponse>()

function isDevEnabled(): boolean {
  return process.env.BAKIN_DEV === '1'
}

export function handleDevSse(req: IncomingMessage, res: ServerResponse): void {
  if (!isDevEnabled()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write(':ok\n\n')
  clients.add(res)

  // Immediate hello so the dev client can confirm the channel is live.
  res.write(`data: ${JSON.stringify({ type: 'dev:ready' })}\n\n`)

  const keepAlive = setInterval(() => {
    try {
      res.write(':ping\n\n')
    } catch {
      clients.delete(res)
      clearInterval(keepAlive)
    }
  }, 30_000)

  req.on('close', () => {
    clients.delete(res)
    clearInterval(keepAlive)
  })
}

export function broadcastDev(event: DevEvent): void {
  if (!isDevEnabled()) return
  const msg = `data: ${JSON.stringify(event)}\n\n`
  for (const client of clients) {
    try {
      client.write(msg)
    } catch {
      clients.delete(client)
    }
  }
}

export function getDevClientCount(): number {
  return clients.size
}
