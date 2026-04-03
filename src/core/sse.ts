/**
 * SSE (Server-Sent Events) client management for Bakin.
 * Handles client connections, broadcasting, keepalive, and reconnection replay.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import { createLogger } from './logger'
import { getSettings } from './settings'

const log = createLogger('sse')

// Shared state lives on globalThis so that if this module is evaluated multiple
// times (custom server vs Next.js webpack bundle), all instances share the same
// client set, event buffer, and counter.  The first evaluation creates them;
// subsequent evaluations reuse them.
const g = globalThis as any
const clients: Set<ServerResponse> = g.__bakinSSEClients ?? (g.__bakinSSEClients = new Set<ServerResponse>())
const keepAliveTimers: Map<ServerResponse, NodeJS.Timeout> = g.__bakinSSEKeepAlive ?? (g.__bakinSSEKeepAlive = new Map<ServerResponse, NodeJS.Timeout>())

const EVENT_BUFFER_SIZE = 200
if (!g.__bakinSSEState) {
  g.__bakinSSEState = { eventCounter: 0, eventBuffer: [] as { id: number; data: string }[] }
}
const sseState: { eventCounter: number; eventBuffer: { id: number; data: string }[] } = g.__bakinSSEState

function nextEventId(): number {
  return ++sseState.eventCounter
}

export function broadcast(data: Record<string, unknown>): void {
  const id = nextEventId()
  const payload = JSON.stringify(data)
  const msg = `id: ${id}\ndata: ${payload}\n\n`

  // Store in replay buffer
  sseState.eventBuffer.push({ id, data: payload })
  if (sseState.eventBuffer.length > EVENT_BUFFER_SIZE) {
    sseState.eventBuffer.splice(0, sseState.eventBuffer.length - EVENT_BUFFER_SIZE)
  }

  for (const client of clients) {
    try {
      client.write(msg)
    } catch {
      removeClient(client)
    }
  }
}

export function broadcastAuditEvent(entry: Record<string, unknown>): void {
  broadcast({ type: 'audit', entry, timestamp: new Date().toISOString() })
}

// Expose broadcast on globalThis so Next.js API routes (which get a separate
// module instance due to webpack bundling) can still reach the real SSE clients.
;(globalThis as any).__bakinBroadcastAudit = broadcastAuditEvent
;(globalThis as any).__bakinBroadcast = broadcast

function removeClient(res: ServerResponse): void {
  clients.delete(res)
  const timer = keepAliveTimers.get(res)
  if (timer) {
    clearInterval(timer)
    keepAliveTimers.delete(res)
  }
}

/**
 * Replay missed events to a reconnecting client.
 * Sends all events after the given lastEventId.
 */
function replayEvents(res: ServerResponse, lastEventId: number): void {
  let replayed = 0
  for (const event of sseState.eventBuffer) {
    if (event.id > lastEventId) {
      try {
        res.write(`id: ${event.id}\ndata: ${event.data}\n\n`)
        replayed++
      } catch {
        removeClient(res)
        return
      }
    }
  }
  if (replayed > 0) {
    log.debug('Replayed events for reconnecting client', { replayed, fromId: lastEventId })
  }
}

export function handleSSE(req: IncomingMessage, res: ServerResponse): void {
  const settings = getSettings()

  if (clients.size >= settings.sse.maxClients) {
    res.writeHead(503, { 'Content-Type': 'text/plain' })
    res.end('Too many SSE clients')
    log.warn('SSE connection rejected: max clients reached', { current: clients.size })
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
  res.write(':ok\n\n')
  clients.add(res)

  // Replay missed events if client is reconnecting
  const lastEventId = req.headers['last-event-id']
  if (lastEventId) {
    const id = parseInt(String(lastEventId), 10)
    if (!isNaN(id)) {
      replayEvents(res, id)
    }
  }

  const keepAlive = setInterval(() => {
    try {
      res.write(`:ping\n\n`)
    } catch {
      removeClient(res)
    }
  }, settings.sse.keepAliveMs)
  keepAliveTimers.set(res, keepAlive)

  req.on('close', () => {
    removeClient(res)
  })

  log.debug('SSE client connected', { total: clients.size, reconnect: !!lastEventId })
}

export function getClientCount(): number {
  return clients.size
}

export function getCurrentEventId(): number {
  return sseState.eventCounter
}

export function stop(): void {
  const shutdownId = nextEventId()
  for (const client of clients) {
    try {
      client.write(`id: ${shutdownId}\ndata: {"type":"shutdown"}\n\n`)
      client.end()
    } catch {
      // client already gone
    }
  }
  for (const timer of keepAliveTimers.values()) {
    clearInterval(timer)
  }
  clients.clear()
  keepAliveTimers.clear()
  log.info('SSE stopped, all clients disconnected')
}
