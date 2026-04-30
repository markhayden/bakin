import { randomUUID } from 'crypto'
import type { AdapterLogger } from '@bakin/core/adapters/shared'

const GATEWAY_PROTOCOL_VERSION = 3
const DEFAULT_REQUEST_TIMEOUT_MS = 10000
const CONNECT_TIMEOUT_MS = 5000
const RECONNECT_DELAY_MS = 1000
const WS_OPEN = 1

export type OpenClawPluginApprovalDecision = 'allow-once' | 'allow-always' | 'deny'

export interface OpenClawPluginApprovalRequestParams {
  pluginId: string
  title: string
  description: string
  severity?: string
  toolName?: string
  toolCallId?: string
  agentId?: string
  sessionKey?: string
  turnSourceChannel?: string
  turnSourceTo?: string
  turnSourceAccountId?: string
  turnSourceThreadId?: string | number
  timeoutMs?: number
  twoPhase?: boolean
}

export interface OpenClawPluginApprovalRequestResult {
  id?: string
  status?: string
  decision?: OpenClawPluginApprovalDecision | null
  createdAtMs?: number
  expiresAtMs?: number
}

export interface OpenClawPluginApprovalResolvedPayload {
  id?: string
  decision?: string
  resolvedBy?: string | null
  ts?: number
  request?: Record<string, unknown>
}

interface GatewayEventFrame {
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
}

interface ConnectState {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export class OpenClawApprovalGatewayClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, PendingRequest>()
  private resolvedHandlers = new Set<(payload: OpenClawPluginApprovalResolvedPayload) => void>()
  private connectState: ConnectState | null = null
  private connected = false
  private stopped = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectSent = false

  constructor(
    private readonly opts: {
      url: string
      token: () => string | null
      logger: AdapterLogger
    },
  ) {}

  async requestPluginApproval(
    params: OpenClawPluginApprovalRequestParams,
  ): Promise<OpenClawPluginApprovalRequestResult> {
    const result = await this.request('plugin.approval.request', params as unknown as Record<string, unknown>)
    return isRecord(result) ? result as OpenClawPluginApprovalRequestResult : {}
  }

  async resolvePluginApproval(id: string, decision: OpenClawPluginApprovalDecision): Promise<void> {
    await this.request('plugin.approval.resolve', { id, decision })
  }

  subscribeResolved(handler: (payload: OpenClawPluginApprovalResolvedPayload) => void): () => void {
    this.resolvedHandlers.add(handler)
    this.ensureConnected().catch((err) => {
      this.opts.logger.warn('OpenClaw approval gateway subscription failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
    return () => {
      this.resolvedHandlers.delete(handler)
      if (this.resolvedHandlers.size === 0) this.close()
    }
  }

  close(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.rejectPending(new Error('OpenClaw approval gateway closed'))
    if (this.connectState) {
      clearTimeout(this.connectState.timeout)
      this.connectState.reject(new Error('OpenClaw approval gateway closed'))
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

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    await this.ensureConnected()
    return this.sendRequest(method, params, DEFAULT_REQUEST_TIMEOUT_MS)
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
      const error = new Error('OpenClaw approval gateway connect timed out')
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
      // OpenClaw sends connect.challenge before accepting connect. The
      // challenge event drives sendConnect().
    })
    ws.addEventListener('message', (event) => this.handleMessage(messageDataToString(event.data)))
    ws.addEventListener('close', () => this.handleClose())
    ws.addEventListener('error', () => {
      if (!this.connected) this.failConnect(new Error('OpenClaw approval gateway socket error'))
    })

    return promise
  }

  private sendConnect(): void {
    if (this.connectSent) return
    this.connectSent = true
    const token = this.opts.token()
    this.sendRequest('connect', {
      minProtocol: GATEWAY_PROTOCOL_VERSION,
      maxProtocol: GATEWAY_PROTOCOL_VERSION,
      client: {
        id: 'gateway-client',
        displayName: 'Bakin',
        version: '1.0.0',
        platform: process.platform,
        mode: 'backend',
      },
      role: 'operator',
      scopes: ['operator.approvals'],
      ...(token ? { auth: { token } } : {}),
    }, CONNECT_TIMEOUT_MS)
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

  private sendRequest(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const ws = this.ws
    if (!ws || ws.readyState !== WS_OPEN) {
      return Promise.reject(new Error('OpenClaw approval gateway is not connected'))
    }

    const id = randomUUID()
    const frame = { type: 'req', id, method, params }
    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`OpenClaw approval gateway request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timeout })
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
      this.handleEvent(parsed as unknown as GatewayEventFrame)
    } else if (parsed.type === 'res') {
      this.handleResponse(parsed as unknown as GatewayResponseFrame)
    }
  }

  private handleEvent(frame: GatewayEventFrame): void {
    if (frame.event === 'connect.challenge') {
      const payload = isRecord(frame.payload) ? frame.payload : {}
      const nonce = typeof payload.nonce === 'string' ? payload.nonce.trim() : ''
      if (!nonce) {
        this.failConnect(new Error('OpenClaw approval gateway connect challenge missing nonce'))
        this.ws?.close()
        return
      }
      this.sendConnect()
      return
    }

    if (frame.event !== 'plugin.approval.resolved') return
    const payload = normalizeResolvedPayload(frame.payload)
    if (!payload) return
    for (const handler of this.resolvedHandlers) {
      try {
        handler(payload)
      } catch (err) {
        this.opts.logger.warn('OpenClaw approval response handler failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  private handleResponse(frame: GatewayResponseFrame): void {
    const pending = this.pending.get(frame.id)
    if (!pending) return
    this.pending.delete(frame.id)
    clearTimeout(pending.timeout)
    if (frame.ok) {
      pending.resolve(frame.payload)
      return
    }
    pending.reject(new Error(frame.error?.message ?? 'OpenClaw approval gateway request failed'))
  }

  private handleClose(): void {
    this.connected = false
    this.connectSent = false
    this.rejectPending(new Error('OpenClaw approval gateway disconnected'))
    if (this.connectState) {
      clearTimeout(this.connectState.timeout)
      this.connectState.reject(new Error('OpenClaw approval gateway disconnected'))
      this.connectState = null
    }
    if (this.stopped || this.resolvedHandlers.size === 0) return
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.ensureConnected().catch((err) => {
        this.opts.logger.warn('OpenClaw approval gateway reconnect failed', {
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
}

function normalizeResolvedPayload(payload: unknown): OpenClawPluginApprovalResolvedPayload | null {
  if (!isRecord(payload)) return null
  const request = isRecord(payload.request) ? payload.request : undefined
  return {
    ...(typeof payload.id === 'string' ? { id: payload.id } : {}),
    ...(typeof payload.decision === 'string' ? { decision: payload.decision } : {}),
    ...(typeof payload.resolvedBy === 'string' || payload.resolvedBy === null ? { resolvedBy: payload.resolvedBy } : {}),
    ...(typeof payload.ts === 'number' ? { ts: payload.ts } : {}),
    ...(request ? { request } : {}),
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
