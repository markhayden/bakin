import { randomUUID } from 'crypto'
import type { AdapterLogger } from '@bakin/core/adapters/shared'

import { buildDeviceConnectFields, loadDeviceAuth } from './device-auth'

const GATEWAY_MIN_PROTOCOL_VERSION = 1
const GATEWAY_MAX_PROTOCOL_VERSION = 10
const DEFAULT_REQUEST_TIMEOUT_MS = 10000
const CONNECT_TIMEOUT_MS = 5000
const RECONNECT_DELAY_MS = 1000
const WS_OPEN = 1

export interface OpenClawGatewayRpcClientOptions {
  url: string
  token: () => string | null
  logger: AdapterLogger
  clientId: string
  displayName: string
  clientMode: string
  scopes: string[]
  role?: string
  label?: string
  /** Present the home device identity on connect (required for operator.write / dispatch). */
  useDeviceAuth?: boolean
}

export interface OpenClawGatewayEventFrame {
  type: 'event'
  event: string
  payload?: unknown
  seq?: number
}

interface GatewayResponseFrame {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: { message?: string; code?: string; details?: unknown }
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
  expectFinal: boolean
}

export interface OpenClawGatewayRequestOptions {
  expectFinal?: boolean
  timeoutMs?: number
}

interface ConnectState {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export class OpenClawGatewayRpcClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, PendingRequest>()
  private eventHandlers = new Map<string, Set<(payload: unknown, frame: OpenClawGatewayEventFrame) => void>>()
  private connectState: ConnectState | null = null
  private connected = false
  private stopped = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectSent = false
  private connectNonce: string | null = null

  constructor(private readonly opts: OpenClawGatewayRpcClientOptions) {}

  async request(method: string, params: Record<string, unknown>, opts: OpenClawGatewayRequestOptions | number = {}): Promise<unknown> {
    await this.ensureConnected()
    const normalized = typeof opts === 'number' ? { timeoutMs: opts } : opts
    return this.sendRequest(method, params, {
      timeoutMs: normalized.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      expectFinal: normalized.expectFinal === true,
    })
  }

  subscribe(event: string, handler: (payload: unknown, frame: OpenClawGatewayEventFrame) => void): () => void {
    const handlers = this.eventHandlers.get(event) ?? new Set()
    handlers.add(handler)
    this.eventHandlers.set(event, handlers)
    this.ensureConnected().catch((err) => {
      this.opts.logger.warn(`${this.label()} subscription failed`, {
        event,
        error: err instanceof Error ? err.message : String(err),
      })
    })
    return () => {
      const current = this.eventHandlers.get(event)
      current?.delete(handler)
      if (current?.size === 0) this.eventHandlers.delete(event)
      if (this.eventHandlers.size === 0 && this.pending.size === 0) this.close()
    }
  }

  close(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.rejectPending(new Error(`${this.label()} closed`))
    if (this.connectState) {
      clearTimeout(this.connectState.timeout)
      this.connectState.reject(new Error(`${this.label()} closed`))
      this.connectState = null
    }
    this.connected = false
    this.connectSent = false
    const ws = this.ws
    this.ws = null
    try {
      ws?.close()
    } catch {
      // best effort shutdown
    }
  }

  private ensureConnected(): Promise<void> {
    if (this.connected && this.ws?.readyState === WS_OPEN) return Promise.resolve()
    if (this.connectState) return this.connectState.promise

    this.stopped = false
    this.connected = false
    this.connectSent = false

    const WebSocketCtor = globalThis.WebSocket
    if (!WebSocketCtor) {
      return Promise.reject(new Error('WebSocket is not available in this runtime'))
    }

    let resolveConnect!: () => void
    let rejectConnect!: (error: Error) => void
    const timeout = setTimeout(() => {
      const error = new Error(`${this.label()} connect timed out`)
      this.failConnect(error)
      this.ws?.close()
    }, CONNECT_TIMEOUT_MS)
    const promise = new Promise<void>((resolve, reject) => {
      resolveConnect = resolve
      rejectConnect = reject
    })
    this.connectState = { promise, resolve: resolveConnect, reject: rejectConnect, timeout }

    const ws = new WebSocketCtor(this.opts.url)
    this.ws = ws
    ws.addEventListener('open', () => {
      // OpenClaw sends connect.challenge before accepting connect.
    })
    ws.addEventListener('message', (event) => this.handleMessage(messageDataToString(event.data)))
    ws.addEventListener('close', () => this.handleClose())
    ws.addEventListener('error', () => {
      if (!this.connected) this.failConnect(new Error(`${this.label()} socket error`))
    })

    return promise
  }

  private sendConnect(): void {
    if (this.connectSent) return
    this.connectSent = true
    const token = this.opts.token()
    const role = this.opts.role ?? 'operator'
    const auth: Record<string, unknown> = token ? { token } : {}
    const params: Record<string, unknown> = {
      minProtocol: GATEWAY_MIN_PROTOCOL_VERSION,
      maxProtocol: GATEWAY_MAX_PROTOCOL_VERSION,
      client: {
        id: this.opts.clientId,
        displayName: this.opts.displayName,
        version: '1.0.0',
        platform: process.platform,
        mode: this.opts.clientMode,
      },
      role,
      scopes: this.opts.scopes,
    }

    // Device identity is required for elevated scopes (operator.write / dispatch).
    // Sign the challenge nonce with the home device key; gateway grants the
    // device's approved scopes. No-op when device auth isn't enabled/available.
    if (this.opts.useDeviceAuth && this.connectNonce) {
      const info = loadDeviceAuth()
      if (info) {
        const fields = buildDeviceConnectFields(info, {
          clientId: this.opts.clientId,
          clientMode: this.opts.clientMode,
          role,
          scopes: this.opts.scopes,
          nonce: this.connectNonce,
          platform: process.platform,
          gatewayToken: token,
        })
        params.device = fields.device
        if (fields.deviceToken) auth.deviceToken = fields.deviceToken
      } else {
        this.opts.logger.warn(`${this.label()} useDeviceAuth set but no device identity found`)
      }
    }
    if (Object.keys(auth).length > 0) params.auth = auth

    this.sendRequest('connect', params, { timeoutMs: CONNECT_TIMEOUT_MS, expectFinal: false })
      .then(() => {
        const state = this.connectState
        if (!state) return
        clearTimeout(state.timeout)
        this.connected = true
        this.connectState = null
        state.resolve()
      })
      .catch((err) => {
        this.failConnect(err instanceof Error ? err : new Error(String(err)))
        this.ws?.close()
      })
  }

  private sendRequest(method: string, params: Record<string, unknown>, opts: { timeoutMs: number; expectFinal: boolean }): Promise<unknown> {
    const ws = this.ws
    if (!ws || ws.readyState !== WS_OPEN) {
      return Promise.reject(new Error(`${this.label()} is not connected`))
    }

    const id = randomUUID()
    const frame = { type: 'req', id, method, params }
    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.label()} request timed out: ${method}`))
      }, opts.timeoutMs)
      this.pending.set(id, { resolve, reject, timeout, expectFinal: opts.expectFinal })
    })
    ws.send(JSON.stringify(frame))
    return promise
  }

  private handleMessage(raw: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string') return

    if (parsed.type === 'event') {
      this.handleEvent(parsed as unknown as OpenClawGatewayEventFrame)
    } else if (parsed.type === 'res') {
      this.handleResponse(parsed as unknown as GatewayResponseFrame)
    }
  }

  private handleEvent(frame: OpenClawGatewayEventFrame): void {
    if (frame.event === 'connect.challenge') {
      const payload = isRecord(frame.payload) ? frame.payload : {}
      const nonce = typeof payload.nonce === 'string' ? payload.nonce.trim() : ''
      if (!nonce) {
        this.failConnect(new Error(`${this.label()} connect challenge missing nonce`))
        this.ws?.close()
        return
      }
      this.connectNonce = nonce
      this.sendConnect()
      return
    }

    for (const handler of this.eventHandlers.get(frame.event) ?? []) {
      try {
        handler(frame.payload, frame)
      } catch (err) {
        this.opts.logger.warn(`${this.label()} event handler failed`, {
          event: frame.event,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  private handleResponse(frame: GatewayResponseFrame): void {
    const pending = this.pending.get(frame.id)
    if (!pending) return
    if (pending.expectFinal && frame.ok && isAcceptedAckPayload(frame.payload)) return
    this.pending.delete(frame.id)
    clearTimeout(pending.timeout)
    if (frame.ok) {
      pending.resolve(frame.payload)
      return
    }
    const message = frame.error?.message ?? `${this.label()} request failed`
    const details = formatGatewayErrorDetails(frame.error?.details)
    pending.reject(new Error([
      message,
      ...(frame.error?.code ? [`code=${frame.error.code}`] : []),
      ...(details ? [`details=${details}`] : []),
    ].join('; ')))
  }

  private handleClose(): void {
    this.connected = false
    this.connectSent = false
    this.rejectPending(new Error(`${this.label()} disconnected`))
    if (this.connectState) {
      clearTimeout(this.connectState.timeout)
      this.connectState.reject(new Error(`${this.label()} disconnected`))
      this.connectState = null
    }
    if (this.stopped || this.eventHandlers.size === 0) return
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.ensureConnected().catch((err) => {
        this.opts.logger.warn(`${this.label()} reconnect failed`, {
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }, RECONNECT_DELAY_MS)
  }

  private failConnect(error: Error): void {
    if (!this.connectState) return
    clearTimeout(this.connectState.timeout)
    this.connectState.reject(error)
    this.connectState = null
  }

  private rejectPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private label(): string {
    return this.opts.label ?? 'OpenClaw gateway'
  }
}

function messageDataToString(data: unknown): string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data)
  return String(data)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isAcceptedAckPayload(value: unknown): boolean {
  return isRecord(value) && value.status === 'accepted'
}

function formatGatewayErrorDetails(details: unknown): string | null {
  if (!isRecord(details)) return null
  const safeDetails: Record<string, unknown> = {}
  for (const key of ['expectedProtocol', 'minProtocol', 'maxProtocol', 'reason', 'requestId']) {
    if (key in details) safeDetails[key] = details[key]
  }
  if (Object.keys(safeDetails).length === 0) return null
  try {
    return JSON.stringify(safeDetails)
  } catch {
    return null
  }
}
