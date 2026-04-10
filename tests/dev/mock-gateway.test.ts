import { describe, it, expect } from 'vitest'
import { handleGatewayRequest } from '../../dev/imitation-crab/gateway'

describe('mock gateway request handling', () => {
  it('GET /health returns ok with mock flag', async () => {
    const res = await handleGatewayRequest({ method: 'GET', url: '/health' })
    expect(res.status).toBe(200)
    const body = res.body as Record<string, unknown>
    expect(body.status).toBe('ok')
    expect(body.mock).toBe(true)
  })

  it('POST /v1/chat/completions returns canned response', async () => {
    const res = await handleGatewayRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'x-openclaw-agent-id': 'pixel',
      },
      body: JSON.stringify({
        model: 'openclaw',
        messages: [{ role: 'user', content: 'Generate a thumbnail' }],
      }),
    })

    expect(res.status).toBe(200)
    const body = res.body as { choices: Array<{ message: { role: string; content: string } }> }
    expect(body.choices).toHaveLength(1)
    expect(body.choices[0].message.role).toBe('assistant')
    expect(body.choices[0].message.content).toContain('mock:Pixel')
  })

  it('POST /v1/chat/completions handles missing agent header', async () => {
    const res = await handleGatewayRequest({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openclaw',
        messages: [{ role: 'user', content: 'test' }],
      }),
    })

    expect(res.status).toBe(200)
    const body = res.body as { choices: Array<{ message: { content: string } }> }
    expect(body.choices[0].message.content).toContain('mock:unknown')
  })

  it('POST /tools/invoke returns ok', async () => {
    const res = await handleGatewayRequest({
      method: 'POST',
      url: '/tools/invoke',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'message_send',
        action: 'json',
        args: { channel: 'discord', target: 'channel:123', message: 'hello' },
      }),
    })

    expect(res.status).toBe(200)
    const body = res.body as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.mock).toBe(true)
  })

  it('returns 404 for unknown routes', async () => {
    const res = await handleGatewayRequest({ method: 'GET', url: '/v2/unknown' })
    expect(res.status).toBe(404)
  })
})
