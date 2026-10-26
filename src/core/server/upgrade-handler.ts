/**
 * HTTP upgrades for plugin socket routes (`definePlugin({ socketRoutes })`),
 * wired by server.ts onto the server it creates.
 *
 * Admission happens BEFORE the WebSocket handshake completes:
 *   1. the path must be `/api/plugins/{pluginId}{socketPath}` naming a live
 *      route (404 otherwise);
 *   2. the browser's Origin must be this server's own host (403) — the HTTP
 *      API is unauthenticated inside the trusted network, so this is the
 *      cross-site WebSocket hijacking guard, not identity;
 *   3. the route's own `admit(request)` may refuse with any Response.
 * Accepted connections run over the ONE PluginSocket implementation and are
 * tracked by the registry, which closes them on sweep/disable/shutdown.
 */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import type { SocketRoute } from '@makinbakin/sdk/types'
import { createPluginSocket } from '../../../packages/core/src/routing/socket'
import { createLogger } from '../logger'

const log = createLogger('plugin-sockets')

const PLUGIN_SOCKET_PATH = /^\/api\/plugins\/([a-z][a-z0-9-]{0,39})(\/[A-Za-z0-9/_-]*)$/
/** Largest incoming frame a plugin socket accepts. */
const MAX_PAYLOAD = 1024 * 1024

export interface SocketRouteRegistry {
  findSocketRoute(pluginId: string, path: string): SocketRoute | null
  trackSocket(pluginId: string, socket: { close(code: number, reason: string): void }): (() => void) | null
}

function refuse(socket: Duplex, status: number, body: string): void {
  const reason = status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : 'Refused'
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    // A malformed Origin is a refusal, never an exception.
    return false
  }
}

function toRequest(req: IncomingMessage): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, { headers })
}

function frame(data: RawData, isBinary: boolean): string | Uint8Array {
  const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
  return isBinary ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes.toString('utf8')
}

export function createUpgradeHandler(registry: SocketRouteRegistry): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })

  const accept = (ws: WebSocket, pluginId: string, route: SocketRoute, request: Request) => {
    const handle = createPluginSocket({
      get bufferedAmount() { return ws.bufferedAmount },
      send: (data, done) => { ws.send(data, done) },
      close: (code, reason) => { ws.close(code, reason) },
    })
    const untrack = registry.trackSocket(pluginId, handle.socket)
    if (!untrack) {
      ws.close(1001, 'Plugin unavailable')
      return
    }
    ws.on('message', (data, isBinary) => handle.deliver(frame(data, isBinary)))
    ws.on('close', (code, reason) => {
      untrack()
      handle.closed(code, reason.toString())
    })
    ws.on('error', (err) => { log.warn('plugin socket error', { pluginId, path: route.path, err: String(err) }) })
    Promise.resolve()
      .then(() => route.open(handle.socket, request))
      .catch((err) => {
        log.error('plugin socket open failed', err, { pluginId, path: route.path })
        ws.close(1011, 'Socket route open failed')
      })
  }

  return (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const match = PLUGIN_SOCKET_PATH.exec(url.pathname)
    const route = match ? registry.findSocketRoute(match[1], match[2]) : null
    if (!match || !route) { refuse(socket, 404, 'No socket route'); return }
    if (!sameOrigin(req.headers.origin, req.headers.host)) { refuse(socket, 403, 'Cross-origin socket refused'); return }
    const request = toRequest(req)
    Promise.resolve()
      .then(() => route.admit?.(request))
      .then(async (refusal) => {
        if (refusal) { refuse(socket, refusal.status, await refusal.text()); return }
        wss.handleUpgrade(req, socket, head, (ws) => accept(ws, match[1], route, request))
      })
      .catch((err) => {
        log.error('plugin socket admission failed', err, { pluginId: match[1], path: route.path })
        refuse(socket, 500, 'Socket admission failed')
      })
  }
}
