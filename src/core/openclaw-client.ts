/**
 * OpenClaw HTTP client for Bakin.
 * Replaces fragile execFile('openclaw', ...) calls with proper HTTP requests
 * to the OpenClaw gateway API.
 */
import { createLogger } from './logger'
import { getSettings } from './settings'
import * as vault from './vault'

const log = createLogger('openclaw')

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

/**
 * Send a message to an agent via the chat completions API.
 * Replaces: openclaw agent --agent <id> --message <msg> --deliver
 */
export async function sendMessage(agentId: string, message: string): Promise<string> {
  const baseUrl = getBaseUrl()

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
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

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenClaw sendMessage failed (${res.status}): ${body}`)
  }

  const data = await res.json()
  const reply = data?.choices?.[0]?.message?.content || ''
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
