/**
 * Native WebSocket RPC client for the OpenClaw gateway.
 *
 * Replaces `openclaw gateway call <method>` shell-outs for session
 * observability. Two surfaces:
 *   - gatewayCall(method, params): one request, one reply.
 *   - gatewaySubscribe(method, params, onFrame): stream frames until the
 *     server ends or the caller unsubscribes.
 *
 * The protocol is inferred from the OpenClaw gateway implementation:
 * a JSON envelope `{ method, params, id }` on send, and one of
 *   { id, result }
 *   { id, error: { code, message } }
 *   { id, stream: <frame> }
 * on receive, with stream termination signaled by `{ id, stream: { end: true } }`.
 *
 * Auth: Authorization: Bearer <gateway-token> header. Token from the
 * existing vault (same source as openclaw-client.ts).
 */
import { createLogger } from '../../../src/core/logger'
import { getSettings } from '../../../src/core/settings'
import * as vault from '../../../src/core/vault'

const log = createLogger('memory:gateway')

// ─── Envelope types ──────────────────────────────────────────────────────────

interface SendFrame {
  method: string
  params: unknown
  id: number
}

interface ResultFrame {
  id: number
  result: unknown
}

interface ErrorFrame {
  id: number
  error: { code: number; message: string }
}

interface StreamFrame {
  id: number
  stream: unknown
}

type RecvFrame = ResultFrame | ErrorFrame | StreamFrame

function isResult(f: RecvFrame): f is ResultFrame {
  return 'result' in f
}
function isError(f: RecvFrame): f is ErrorFrame {
  return 'error' in f
}
function isStream(f: RecvFrame): f is StreamFrame {
  return 'stream' in f
}

// ─── Id allocator ────────────────────────────────────────────────────────────

let nextId = 1
function allocId(): number {
  return nextId++
}

/** Test-only: reset the id counter (so tests see predictable ids if they care). */
export function __resetGatewayClientForTests(): void {
  nextId = 1
}

// ─── Connection helpers ──────────────────────────────────────────────────────

function buildWsUrl(): string {
  const settings = getSettings()
  const raw = `${settings.openclaw.gatewayUrl}:${settings.openclaw.gatewayPort}`
  // Convert http(s) → ws(s); leave ws(s) as-is.
  if (raw.startsWith('http://')) return `ws://${raw.slice('http://'.length)}`
  if (raw.startsWith('https://')) return `wss://${raw.slice('https://'.length)}`
  return raw
}

function authHeaders(): Record<string, string> {
  const token = vault.get('gateway-token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function openSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let settled = false
    const headers = authHeaders()
    // Node's `ws` / undici WebSocket accepts a second-arg options bag with
    // `headers`. Browsers ignore it. Cast for cross-platform ergonomics.
    const ctor = globalThis.WebSocket as unknown as new (url: string, opts?: unknown) => WebSocket
    let ws: WebSocket
    try {
      ws = new ctor(buildWsUrl(), { headers })
    } catch (err) {
      reject(err)
      return
    }

    const onOpen = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(ws)
    }
    const onError = (e: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      const msg = e instanceof Error ? e.message : 'websocket error'
      reject(new Error(`gateway websocket error: ${msg}`))
    }
    const onClose = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('gateway websocket closed before open'))
    }
    const cleanup = () => {
      // Intentionally leave onmessage in place for the caller.
      ws.onopen = null
      ws.onerror = null
      ws.onclose = null
    }
    ws.onopen = onOpen
    ws.onerror = onError
    ws.onclose = onClose
  })
}

// ─── gatewayCall ─────────────────────────────────────────────────────────────

export interface GatewayCallOptions {
  timeoutMs?: number
}

export async function gatewayCall<T = unknown>(
  method: string,
  params: unknown,
  opts: GatewayCallOptions = {}
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const id = allocId()
  const ws = await openSocket()

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(`gatewayCall ${method} timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    const onMessage = (e: { data: string }) => {
      if (settled) return
      let frame: RecvFrame
      try {
        frame = JSON.parse(e.data) as RecvFrame
      } catch (err) {
        log.warn('unparseable gateway frame', { err: err instanceof Error ? err.message : String(err) })
        return
      }
      if (frame.id !== id) return
      if (isError(frame)) {
        settled = true
        cleanup()
        reject(new Error(`gateway error: ${frame.error.message} (code ${frame.error.code})`))
        return
      }
      if (isResult(frame)) {
        settled = true
        cleanup()
        resolve(frame.result as T)
        return
      }
      // stream frames are ignored for a plain call
    }

    const cleanup = () => {
      clearTimeout(timer)
      ws.onmessage = null
      try { ws.close() } catch { /* ignore */ }
    }

    ws.onmessage = onMessage
    const envelope: SendFrame = { method, params, id }
    ws.send(JSON.stringify(envelope))
  })
}

// ─── gatewaySubscribe ────────────────────────────────────────────────────────

export interface GatewaySubscribeHandle {
  unsubscribe: () => void
  done: Promise<void>
}

export async function gatewaySubscribe(
  method: string,
  params: unknown,
  onFrame: (frame: unknown) => void
): Promise<GatewaySubscribeHandle> {
  const id = allocId()
  const ws = await openSocket()

  let settled = false
  let resolveDone!: () => void
  let rejectDone!: (err: Error) => void
  const done = new Promise<void>((res, rej) => {
    resolveDone = res
    rejectDone = rej
  })

  const cleanup = () => {
    ws.onmessage = null
    try { ws.close() } catch { /* ignore */ }
  }

  const unsubscribe = () => {
    if (settled) return
    settled = true
    cleanup()
    resolveDone()
  }

  ws.onmessage = (e: { data: string }) => {
    if (settled) return
    let frame: RecvFrame
    try {
      frame = JSON.parse(e.data) as RecvFrame
    } catch {
      return
    }
    if (frame.id !== id) return
    if (isError(frame)) {
      settled = true
      cleanup()
      rejectDone(new Error(`gateway error: ${frame.error.message} (code ${frame.error.code})`))
      return
    }
    if (isStream(frame)) {
      const payload = frame.stream as { end?: boolean } & Record<string, unknown>
      if (payload && payload.end === true) {
        settled = true
        cleanup()
        resolveDone()
        return
      }
      onFrame(frame.stream)
      return
    }
    if (isResult(frame)) {
      // Subscription acknowledged; results-only subscribes (server never
      // sends stream frames) complete immediately.
      settled = true
      cleanup()
      resolveDone()
    }
  }

  const envelope: SendFrame = { method, params, id }
  ws.send(JSON.stringify(envelope))

  return { unsubscribe, done }
}
