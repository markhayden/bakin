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
 *
 * `ws` here is Bun's built-in implementation: Bun resolves the specifier to
 * it in source and in the compiled binary (the npm package is never loaded),
 * which is why the host declares no `ws` dependency — only `@types/ws`.
 */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import type { SocketRoute } from '@makinbakin/sdk/types'
import { createPluginSocket } from '../../../packages/core/src/routing/socket'
import { createLogger } from '../logger'

const log = createLogger('plugin-sockets')

const PLUGIN_SOCKET_PATH = /^\/api\/plugins\/([a-z][a-z0-9-]{0,39})(\/[A-Za-z0-9/_-]*)$/
/**
 * Largest incoming frame a plugin socket accepts. Enforced here: Bun's
 * built-in WebSocketServer stores `maxPayload` but never applies it.
 */
const MAX_PAYLOAD = 1024 * 1024

export interface SocketRouteRegistry {
  /** The live route and the plugin generation the admission belongs to. */
  findSocketRoute(pluginId: string, path: string): { route: SocketRoute; generation: number } | null
  /** False once the plugin was swept/removed (or the server is shutting down) since `generation`. */
  isCurrent(pluginId: string, generation: number): boolean
  trackSocket(pluginId: string, generation: number, socket: { close(code: number, reason: string): void }): (() => void) | null
}

const STATUS_TEXT: Record<number, string> = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 503: 'Service Unavailable' }

function refuse(socket: Duplex, status: number, body: string): void {
  const reason = STATUS_TEXT[status] ?? 'Refused'
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

function frameBytes(data: RawData): Buffer {
  return Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
}

export function createUpgradeHandler(registry: SocketRouteRegistry): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })

  const accept = (ws: WebSocket, pluginId: string, generation: number, route: SocketRoute, request: Request) => {
    const handle = createPluginSocket({
      send: (data) => { ws.send(data) },
      close: (code, reason) => { ws.close(code, reason) },
    })
    const untrack = registry.trackSocket(pluginId, generation, handle.socket)
    if (!untrack) {
      ws.close(1012, 'Plugin restarted; reconnect')
      return
    }
    ws.on('message', (data, isBinary) => {
      const bytes = frameBytes(data)
      if (bytes.byteLength > MAX_PAYLOAD) {
        ws.close(1009, 'Message too big')
        return
      }
      handle.deliver(isBinary ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes.toString('utf8'))
    })
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
    let pathname: string
    let request: Request
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      request = toRequest(req)
    } catch {
      // An unparseable request target is the client's error, never the host's.
      refuse(socket, 400, 'Malformed socket request')
      return
    }
    const match = PLUGIN_SOCKET_PATH.exec(pathname)
    const found = match ? registry.findSocketRoute(match[1], match[2]) : null
    if (!match || !found) { refuse(socket, 404, 'No socket route'); return }
    if (!sameOrigin(req.headers.origin, req.headers.host)) { refuse(socket, 403, 'Cross-origin socket refused'); return }
    const pluginId = match[1]
    const { route, generation } = found
    Promise.resolve()
      .then(() => route.admit?.(request))
      .then(async (refusal) => {
        if (refusal) { refuse(socket, refusal.status, await refusal.text()); return }
        // The plugin may have been swept while admit ran: its routes are gone.
        if (!registry.isCurrent(pluginId, generation)) { refuse(socket, 503, 'Plugin restarted; reconnect'); return }
        wss.handleUpgrade(req, socket, head, (ws) => accept(ws, pluginId, generation, route, request))
      })
      .catch((err) => {
        log.error('plugin socket admission failed', err, { pluginId, path: route.path })
        refuse(socket, 500, 'Socket admission failed')
      })
  }
}
