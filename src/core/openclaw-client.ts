/**
 * OpenClaw HTTP client for Bakin.
 * Replaces fragile execFile('openclaw', ...) calls with proper HTTP requests
 * to the OpenClaw gateway API.
 */
import { createLogger } from './logger'
import { getSettings } from './settings'
import * as vault from './vault'

const log = createLogger('openclaw')

// ---------------------------------------------------------------------------
// Agent liveness tracker
//
// Records the wall-clock time of the last successful gateway reply per
// agent. The watchdog reads this as the primary "is the agent alive"
// signal — a returned reply means the gateway routed the message to the
// agent and got a response back, which is a much more reliable liveness
// indicator than agent-written heartbeat files (no agent currently
// writes those).
//
// globalThis-backed so the map survives Next.js webpack re-evaluation
// of this module (same pattern as src/core/sse.ts).
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __bakinAgentLastReply: Map<string, number> | undefined
}

const lastReply: Map<string, number> = (globalThis.__bakinAgentLastReply ??= new Map())

function recordAgentReply(agentId: string): void {
  lastReply.set(agentId, Date.now())
}

/**
 * Wall-clock ms of the last successful gateway reply from this agent
 * since the server started, or null if we have never heard back from
 * them. Used by the watchdog as the primary liveness signal.
 */
export function getAgentLastReply(agentId: string): number | null {
  return lastReply.get(agentId) ?? null
}

function getBaseUrl(): string {
  const settings = getSettings()
  return `${settings.openclaw.gatewayUrl}:${settings.openclaw.gatewayPort}`
}

function getHeaders(): Record<string, string> {
  const token = vault.get('gateway-token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

const TRANSIENT_FETCH_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'EPIPE',
])

// Transient failures are node-undici's generic `fetch failed` wrapper and
// the raw socket errors surfaced via `err.cause.code`. Retrying on these
// turns a DNS/socket blip into one successful send instead of 30 minutes
// of dispatch silence (see issue #115). Non-transient errors — any `!res.ok`
// HTTP response, JSON parse failures — throw immediately.
function isTransientFetchError(err: unknown): boolean {
  if (err instanceof TypeError && err.message.includes('fetch failed')) return true
  const cause = (err as { cause?: { code?: string } })?.cause
  if (cause?.code && TRANSIENT_FETCH_CODES.has(cause.code)) return true
  if (err instanceof Error && err.name === 'AbortError') return true
  return false
}

const SEND_MESSAGE_RETRY_BACKOFF_MS = [1000, 2000]

/**
 * Send a message to an agent via the chat completions API.
 * Replaces: openclaw agent --agent <id> --message <msg> --deliver
 */
export async function sendMessage(agentId: string, message: string): Promise<string> {
  const baseUrl = getBaseUrl()

  let res: Response | undefined
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          ...getHeaders(),
          'x-openclaw-agent-id': agentId,
        },
        body: JSON.stringify({
          model: 'openclaw',
          messages: [{ role: 'user', content: message }],
        }),
      })
      break
    } catch (err) {
      if (!isTransientFetchError(err) || attempt === 3) throw err
      log.warn('sendMessage transient fetch failure — retrying', {
        agentId,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      })
      await new Promise(r => setTimeout(r, SEND_MESSAGE_RETRY_BACKOFF_MS[attempt - 1]))
    }
  }
  if (!res) throw new Error('OpenClaw sendMessage: unreachable — retry loop exited without response')

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenClaw sendMessage failed (${res.status}): ${body}`)
  }

  const data = await res.json()
  const reply = data?.choices?.[0]?.message?.content || ''
  // Only record liveness on a non-empty reply. The gateway has been
  // observed returning 200 with empty content during upstream rate-limit
  // or stub conditions — those are exactly the failures the watchdog
  // needs to *catch*, so we must not mark the agent as alive on them.
  if (reply.trim().length > 0) {
    recordAgentReply(agentId)
  }
  log.debug('Message sent', { agentId, messageLength: message.length })
  return reply
}

/**
 * Invoke a tool directly via the tools API.
 * Replaces: various openclaw CLI tool calls
 */
export async function invokeTool(
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const baseUrl = getBaseUrl()

  const res = await fetch(`${baseUrl}/tools/invoke`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      tool: toolName,
      action: 'json',
      args,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenClaw invokeTool failed (${res.status}): ${body}`)
  }

  return res.json()
}

/**
 * Send a message to a channel (Discord, etc).
 * Replaces: openclaw message send --channel discord --target <id> --message <msg>
 */
export async function sendChannelMessage(
  channel: string,
  target: string,
  message: string,
  media?: string
): Promise<void> {
  // Channel messaging goes through the tools/invoke endpoint
  const args: Record<string, unknown> = {
    channel,
    target,
    message,
  }
  if (media) args.media = media

  try {
    await invokeTool('message_send', args)
    log.debug('Channel message sent', { channel, target })
  } catch (err) {
    // Fall back to CLI if HTTP fails
    log.warn('HTTP channel message failed, falling back to CLI', err)
    await sendChannelMessageCLI(channel, target, message, media)
  }
}

/**
 * CLI fallback for channel messages.
 */
async function sendChannelMessageCLI(
  channel: string,
  target: string,
  message: string,
  media?: string
): Promise<void> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)
  const settings = getSettings()

  const args = ['message', 'send', '--channel', channel, '--target', target, '--message', message]
  if (media) args.push('--media', media)

  await execFileAsync(settings.openclaw.binaryPath, args)
}

/**
 * Restart the OpenClaw gateway.
 * Replaces: openclaw gateway restart
 */
export async function restartGateway(): Promise<void> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)
  const settings = getSettings()

  // Gateway restart is a management operation — use CLI
  await execFileAsync(settings.openclaw.binaryPath, ['gateway', 'restart'])
  log.info('Gateway restart requested')
}

/**
 * Check if the OpenClaw gateway is reachable.
 * Tries /healthz (Docker OpenClaw) then /health (Imitation Crab / legacy).
 */
export async function ping(): Promise<boolean> {
  const baseUrl = getBaseUrl()
  for (const path of ['/health', '/healthz']) {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        signal: AbortSignal.timeout(3000),
      })
      if (res.ok) return true
    } catch {
      // try next path
    }
  }
  return false
}
