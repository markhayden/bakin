/**
 * Gateway client for the calendar plugin.
 * Handles authentication and request construction for the OpenClaw gateway.
 */
import { readFileSync, existsSync } from 'fs'

const GATEWAY_URL = 'http://localhost:18789'

/**
 * Resolve the gateway auth token from OpenClaw config.
 */
export async function getGatewayToken(): Promise<string> {
  const { getOpenClawPath } = await import('@bakin/core/openclaw-home')
  const configPath = getOpenClawPath('openclaw.json')
  if (!existsSync(configPath)) throw new Error('Gateway config not found')
  const cfg = JSON.parse(readFileSync(configPath, 'utf-8'))
  const token = cfg?.gateway?.auth?.token
  if (!token) throw new Error('Gateway token not found')
  return token
}

/**
 * Send a streaming chat completion request to the OpenClaw gateway.
 * Returns the raw fetch Response with SSE body for streaming.
 */
export async function streamChatCompletion(opts: {
  messages: Array<{ role: string; content: string }>
  agentId: string
  sessionKey: string
}): Promise<Response> {
  const token = await getGatewayToken()

  const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-openclaw-session-key': opts.sessionKey,
      'x-openclaw-agent-id': opts.agentId,
    },
    body: JSON.stringify({
      model: 'openclaw:main',
      max_tokens: 2048,
      stream: true,
      messages: opts.messages,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Gateway error (${response.status}): ${err}`)
  }

  return response
}

/**
 * Send a non-streaming chat completion request.
 * Returns the assistant's response content.
 */
export async function chatCompletion(opts: {
  messages: Array<{ role: string; content: string }>
  agentId: string
  sessionKey: string
}): Promise<string> {
  const token = await getGatewayToken()

  const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-openclaw-session-key': opts.sessionKey,
      'x-openclaw-agent-id': opts.agentId,
    },
    body: JSON.stringify({
      model: 'openclaw:main',
      max_tokens: 2048,
      messages: opts.messages,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Gateway error (${response.status}): ${err}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}
