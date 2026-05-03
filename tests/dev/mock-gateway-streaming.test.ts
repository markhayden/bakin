/**
 * Mock gateway streaming tests — verifies SSE streaming behavior
 * when stream: true is passed in the request body.
 */
import { describe, it, expect } from 'bun:test'
import { handleGatewayRequest } from '../../dev/imitation-crab/gateway'

describe('mock gateway streaming', () => {
  it('returns stream marker when stream: true', async () => {
    const res = await handleGatewayRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'x-openclaw-agent-id': 'chef' },
      body: JSON.stringify({
        model: 'openclaw',
        stream: true,
        messages: [{ role: 'user', content: 'Plan next week' }],
      }),
    })

    expect(res.status).toBe(200)
    const body = res.body as Record<string, unknown>
    expect(body.__stream).toBe(true)
    expect(body.content).toContain('mock:Chef')
  })

  it('returns standard response when stream is not set', async () => {
    const res = await handleGatewayRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'x-openclaw-agent-id': 'chef' },
      body: JSON.stringify({
        model: 'openclaw',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    })

    expect(res.status).toBe(200)
    const body = res.body as Record<string, unknown>
    expect(body.__stream).toBeUndefined()
    expect(body).toHaveProperty('choices')
  })

  it('returns standard response when stream: false', async () => {
    const res = await handleGatewayRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'x-openclaw-agent-id': 'chef' },
      body: JSON.stringify({
        model: 'openclaw',
        stream: false,
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    })

    expect(res.status).toBe(200)
    const body = res.body as Record<string, unknown>
    expect(body.__stream).toBeUndefined()
    expect(body).toHaveProperty('choices')
  })

  it('uses last message content for echo mode reply', async () => {
    const original = process.env.OPENCLAW_MOCK_CHAT_MODE
    process.env.OPENCLAW_MOCK_CHAT_MODE = 'echo'

    try {
      const res = await handleGatewayRequest({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { 'x-openclaw-agent-id': 'explorer' },
        body: JSON.stringify({
          model: 'openclaw',
          stream: true,
          messages: [
            { role: 'system', content: 'You are Explorer' },
            { role: 'user', content: 'Plan outdoor content' },
          ],
        }),
      })

      expect(res.status).toBe(200)
      const body = res.body as Record<string, unknown>
      expect(body.__stream).toBe(true)
      expect(body.content).toBe('[mock:Explorer] Plan outdoor content')
    } finally {
      process.env.OPENCLAW_MOCK_CHAT_MODE = original
    }
  })
})
