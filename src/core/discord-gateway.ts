/**
 * Discord Bot Gateway Client
 *
 * Minimal WebSocket client for Discord's gateway. Connects to receive
 * INTERACTION_CREATE events (button clicks, modal submits) so gate
 * approvals can happen natively in Discord without a public endpoint.
 *
 * Uses Node.js 22 native WebSocket — no dependencies.
 */
import { createLogger } from './logger'
import type { DiscordConfig } from '../../scripts/lib/post-discord'

const log = createLogger('discord-gateway')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Discord gateway opcodes */
const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const

/** Interaction types from Discord API */
const INTERACTION_TYPE = {
  MESSAGE_COMPONENT: 3,
  MODAL_SUBMIT: 5,
} as const

/** Interaction callback types */
const CALLBACK_TYPE = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_UPDATE: 6,
  UPDATE_MESSAGE: 7,
  MODAL: 9,
} as const

export interface GateInteraction {
  action: 'approve' | 'reject'
  taskId: string
  stepId: string
  reason?: string
  /** Respond to the Discord interaction */
  acknowledge: () => Promise<void>
  /** Send an ephemeral reply to the user */
  reply: (content: string) => Promise<void>
}

export type GateInteractionHandler = (interaction: GateInteraction) => Promise<void>

interface GatewayState {
  ws: WebSocket | null
  heartbeatInterval: ReturnType<typeof setInterval> | null
  heartbeatAcked: boolean
  sequence: number | null
  sessionId: string | null
  resumeUrl: string | null
  handler: GateInteractionHandler | null
  config: DiscordConfig | null
  reconnectAttempts: number
  stopped: boolean
  requireRejectReason: boolean
}

// ---------------------------------------------------------------------------
// globalThis-backed state (survives Next.js re-evaluation)
// ---------------------------------------------------------------------------

const g = globalThis as typeof globalThis & { __bakinDiscordGateway?: GatewayState }
if (!g.__bakinDiscordGateway) {
  g.__bakinDiscordGateway = {
    ws: null,
    heartbeatInterval: null,
    heartbeatAcked: true,
    sequence: null,
    sessionId: null,
    resumeUrl: null,
    handler: null,
    config: null,
    reconnectAttempts: 0,
    stopped: true,
    requireRejectReason: true,
  }
}
const state = g.__bakinDiscordGateway

// ---------------------------------------------------------------------------
// Discord REST helpers
// ---------------------------------------------------------------------------

async function interactionRespond(
  interactionId: string,
  interactionToken: string,
  body: Record<string, unknown>,
): Promise<void> {
  const url = `https://discord.com/api/v10/interactions/${interactionId}/${interactionToken}/callback`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    log.warn(`Interaction response failed (${res.status}): ${text}`)
  }
}

// ---------------------------------------------------------------------------
// Interaction handler
// ---------------------------------------------------------------------------

function parseCustomId(customId: string): { action: 'approve' | 'reject'; taskId: string; stepId: string } | null {
  const match = customId.match(/^gate:(approve|reject):([^:]+):([^:]+)$/)
  if (!match) return null
  return { action: match[1] as 'approve' | 'reject', taskId: match[2], stepId: match[3] }
}

async function handleInteraction(data: Record<string, unknown>): Promise<void> {
  const type = data.type as number
  const interactionId = data.id as string
  const interactionToken = data.token as string

  if (type === INTERACTION_TYPE.MESSAGE_COMPONENT) {
    const componentData = data.data as { custom_id: string; component_type: number }
    if (componentData.component_type !== 2) return // Only handle buttons

    const parsed = parseCustomId(componentData.custom_id)
    if (!parsed) return

    if (parsed.action === 'reject' && state.requireRejectReason) {
      // Open a modal for rejection reason
      await interactionRespond(interactionId, interactionToken, {
        type: CALLBACK_TYPE.MODAL,
        data: {
          custom_id: `gate:reject:${parsed.taskId}:${parsed.stepId}`,
          title: 'Reject Gate',
          components: [{
            type: 1, // Action Row
            components: [{
              type: 4, // Text Input
              custom_id: 'reason',
              label: 'Rejection reason',
              style: 2, // Paragraph
              required: true,
              placeholder: 'Why are you rejecting this gate?',
              min_length: 1,
              max_length: 500,
            }],
          }],
        },
      })
      return
    }

    // Approve or reject-without-reason: acknowledge immediately
    if (!state.handler) {
      await interactionRespond(interactionId, interactionToken, {
        type: CALLBACK_TYPE.CHANNEL_MESSAGE,
        data: { content: 'No gate handler registered.', flags: 64 },
      })
      return
    }

    const interaction: GateInteraction = {
      ...parsed,
      acknowledge: () => interactionRespond(interactionId, interactionToken, {
        type: CALLBACK_TYPE.DEFERRED_UPDATE,
      }),
      reply: (content: string) => interactionRespond(interactionId, interactionToken, {
        type: CALLBACK_TYPE.CHANNEL_MESSAGE,
        data: { content, flags: 64 }, // ephemeral
      }),
    }

    try {
      await state.handler(interaction)
    } catch (err) {
      log.error('Gate interaction handler error', err)
      await interactionRespond(interactionId, interactionToken, {
        type: CALLBACK_TYPE.CHANNEL_MESSAGE,
        data: { content: 'Gate action failed. Check the Bakin dashboard.', flags: 64 },
      }).catch(() => {})
    }
  } else if (type === INTERACTION_TYPE.MODAL_SUBMIT) {
    const modalData = data.data as { custom_id: string; components: Array<{ components: Array<{ custom_id: string; value: string }> }> }
    const parsed = parseCustomId(modalData.custom_id)
    if (!parsed || parsed.action !== 'reject') return

    const reason = modalData.components?.[0]?.components?.[0]?.value || 'Rejected via Discord'

    if (!state.handler) {
      await interactionRespond(interactionId, interactionToken, {
        type: CALLBACK_TYPE.CHANNEL_MESSAGE,
        data: { content: 'No gate handler registered.', flags: 64 },
      })
      return
    }

    const interaction: GateInteraction = {
      ...parsed,
      reason,
      acknowledge: () => interactionRespond(interactionId, interactionToken, {
        type: CALLBACK_TYPE.DEFERRED_UPDATE,
      }),
      reply: (content: string) => interactionRespond(interactionId, interactionToken, {
        type: CALLBACK_TYPE.CHANNEL_MESSAGE,
        data: { content, flags: 64 },
      }),
    }

    try {
      await state.handler(interaction)
    } catch (err) {
      log.error('Gate reject handler error', err)
      await interactionRespond(interactionId, interactionToken, {
        type: CALLBACK_TYPE.CHANNEL_MESSAGE,
        data: { content: 'Gate rejection failed. Check the Bakin dashboard.', flags: 64 },
      }).catch(() => {})
    }
  }
}

// ---------------------------------------------------------------------------
// WebSocket lifecycle
// ---------------------------------------------------------------------------

function send(data: Record<string, unknown>): void {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(data))
  }
}

function heartbeat(): void {
  if (!state.heartbeatAcked) {
    log.warn('Heartbeat not ACKed — reconnecting')
    state.ws?.close(4000, 'Heartbeat timeout')
    return
  }
  state.heartbeatAcked = false
  send({ op: OP.HEARTBEAT, d: state.sequence })
}

function identify(): void {
  if (!state.config) return
  send({
    op: OP.IDENTIFY,
    d: {
      token: state.config.botToken,
      intents: 0, // No privileged intents needed for interactions
      properties: {
        os: process.platform,
        browser: 'bakin',
        device: 'bakin',
      },
    },
  })
}

function resume(): void {
  if (!state.config || !state.sessionId) {
    identify()
    return
  }
  send({
    op: OP.RESUME,
    d: {
      token: state.config.botToken,
      session_id: state.sessionId,
      seq: state.sequence,
    },
  })
}

function connect(): void {
  if (state.stopped || !state.config) return

  const url = state.resumeUrl || 'wss://gateway.discord.gg/?v=10&encoding=json'
  log.info(`Connecting to Discord gateway: ${url}`)

  try {
    const ws = new WebSocket(url)
    state.ws = ws

    ws.addEventListener('open', () => {
      log.info('Discord gateway connected')
      state.reconnectAttempts = 0
    })

    ws.addEventListener('message', (event) => {
      let payload: { op: number; t?: string; s?: number; d?: Record<string, unknown> }
      try {
        payload = JSON.parse(String(event.data))
      } catch {
        return
      }

      if (payload.s !== null && payload.s !== undefined) {
        state.sequence = payload.s
      }

      switch (payload.op) {
        case OP.HELLO: {
          const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval
          if (state.heartbeatInterval) clearInterval(state.heartbeatInterval)
          state.heartbeatAcked = true
          state.heartbeatInterval = setInterval(heartbeat, interval)
          // Send first heartbeat with jitter, then identify
          setTimeout(() => {
            heartbeat()
            if (state.sessionId) {
              resume()
            } else {
              identify()
            }
          }, Math.random() * interval)
          break
        }

        case OP.HEARTBEAT_ACK:
          state.heartbeatAcked = true
          break

        case OP.HEARTBEAT:
          // Server requests immediate heartbeat
          send({ op: OP.HEARTBEAT, d: state.sequence })
          break

        case OP.RECONNECT:
          log.info('Discord requested reconnect')
          ws.close(4000, 'Reconnect requested')
          break

        case OP.INVALID_SESSION: {
          const canResume = payload.d as unknown as boolean
          if (!canResume) {
            state.sessionId = null
            state.sequence = null
          }
          // Close and let the close handler reconnect with backoff
          ws.close(4000, 'Invalid session')
          break
        }

        case OP.DISPATCH: {
          if (payload.t === 'READY') {
            const ready = payload.d as { session_id: string; resume_gateway_url: string }
            state.sessionId = ready.session_id
            state.resumeUrl = ready.resume_gateway_url
            log.info('Discord gateway ready', { sessionId: state.sessionId })
          } else if (payload.t === 'INTERACTION_CREATE') {
            handleInteraction(payload.d as Record<string, unknown>).catch((err) => {
              log.error('Failed to handle interaction', err)
            })
          }
          break
        }
      }
    })

    ws.addEventListener('close', (event) => {
      log.info(`Discord gateway closed (code: ${event.code})`)
      if (state.heartbeatInterval) {
        clearInterval(state.heartbeatInterval)
        state.heartbeatInterval = null
      }

      if (!state.stopped) {
        const delay = Math.min(1000 * 2 ** state.reconnectAttempts, 60000)
        state.reconnectAttempts++
        log.info(`Reconnecting in ${delay}ms (attempt ${state.reconnectAttempts})`)
        setTimeout(connect, delay)
      }
    })

    ws.addEventListener('error', (event) => {
      log.error('Discord gateway error', event)
    })
  } catch (err) {
    log.error('Failed to create WebSocket', err)
    if (!state.stopped) {
      const delay = Math.min(1000 * 2 ** state.reconnectAttempts, 60000)
      state.reconnectAttempts++
      setTimeout(connect, delay)
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the Discord gateway connection. Idempotent — if already connected, does nothing.
 */
export function startGateway(config: DiscordConfig, requireRejectReason = true): void {
  if (!state.stopped && state.ws) {
    log.info('Discord gateway already running')
    return
  }

  state.config = config
  state.stopped = false
  state.reconnectAttempts = 0
  state.requireRejectReason = requireRejectReason
  connect()
}

/**
 * Stop the Discord gateway connection and clean up.
 */
export function stopGateway(): void {
  state.stopped = true
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval)
    state.heartbeatInterval = null
  }
  if (state.ws) {
    state.ws.close(1000, 'Shutting down')
    state.ws = null
  }
  state.sessionId = null
  state.sequence = null
  state.resumeUrl = null
  log.info('Discord gateway stopped')
}

/**
 * Register a handler for gate interaction events (approve/reject button clicks).
 * Only one handler is supported — subsequent calls replace the previous handler.
 */
export function onGateInteraction(handler: GateInteractionHandler): void {
  state.handler = handler
}

/**
 * Check if the gateway is currently connected.
 */
export function isGatewayConnected(): boolean {
  return !state.stopped && state.ws?.readyState === WebSocket.OPEN
}
