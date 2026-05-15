import type { AdapterLogger } from '@bakin/core/adapters/shared'
import { OpenClawGatewayRpcClient } from './gateway-rpc'

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

export class OpenClawApprovalGatewayClient {
  private readonly rpc: OpenClawGatewayRpcClient
  private resolvedHandlers = new Set<(payload: OpenClawPluginApprovalResolvedPayload) => void>()
  private unsubscribeResolved: (() => void) | null = null

  constructor(
    private readonly opts: {
      url: string
      token: () => string | null
      logger: AdapterLogger
    },
  ) {
    this.rpc = new OpenClawGatewayRpcClient({
      url: opts.url,
      token: opts.token,
      logger: opts.logger,
      clientId: 'gateway-client',
      displayName: 'Bakin',
      clientMode: 'backend',
      scopes: ['operator.approvals'],
      label: 'OpenClaw approval gateway',
    })
  }

  async requestPluginApproval(
    params: OpenClawPluginApprovalRequestParams,
  ): Promise<OpenClawPluginApprovalRequestResult> {
    const result = await this.rpc.request('plugin.approval.request', params as unknown as Record<string, unknown>)
    return isRecord(result) ? result as OpenClawPluginApprovalRequestResult : {}
  }

  async resolvePluginApproval(id: string, decision: OpenClawPluginApprovalDecision): Promise<void> {
    await this.rpc.request('plugin.approval.resolve', { id, decision })
  }

  subscribeResolved(handler: (payload: OpenClawPluginApprovalResolvedPayload) => void): () => void {
    this.resolvedHandlers.add(handler)
    if (!this.unsubscribeResolved) {
      this.unsubscribeResolved = this.rpc.subscribe('plugin.approval.resolved', (payload) => {
        const resolved = normalizeResolvedPayload(payload)
        if (!resolved) return
        for (const current of this.resolvedHandlers) {
          try {
            current(resolved)
          } catch (err) {
            this.opts.logger.warn('OpenClaw approval response handler failed', {
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }
      })
    }
    return () => {
      this.resolvedHandlers.delete(handler)
      if (this.resolvedHandlers.size > 0) return
      this.unsubscribeResolved?.()
      this.unsubscribeResolved = null
    }
  }

  close(): void {
    this.resolvedHandlers.clear()
    this.unsubscribeResolved?.()
    this.unsubscribeResolved = null
    this.rpc.close()
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
