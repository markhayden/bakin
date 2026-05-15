import { describe, it, expect } from 'bun:test'
import { handleGatewayRequest, handleGatewayRpcRequest } from '../../dev/imitation-crab/gateway'

describe('mock gateway request handling', () => {
  it('GET /health returns ok with mock flag', async () => {
    const res = await handleGatewayRequest({ method: 'GET', url: '/health' })
    expect(res.status).toBe(200)
    const body = res.body as Record<string, unknown>
    expect(body.status).toBe('ok')
    expect(body.mock).toBe(true)
  })

  it('RPC agent returns canned Gateway agent payloads', async () => {
    const res = await handleGatewayRpcRequest('agent', {
      agentId: 'pixel',
      message: 'Generate a thumbnail',
      expectFinal: true,
    })

    expect(res.ok).toBe(true)
    const payload = res.payload as Record<string, unknown>
    expect(payload.status).toBe('ok')
    expect(JSON.stringify(payload)).toContain('mock:Pixel')
  })

  it('RPC agent handles missing agent IDs', async () => {
    const res = await handleGatewayRpcRequest('agent', { message: 'test' })

    expect(res.ok).toBe(true)
    expect(JSON.stringify(res.payload)).toContain('mock:unknown')
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

  it('returns 404 for unknown HTTP routes', async () => {
    const res = await handleGatewayRequest({ method: 'GET', url: '/v2/unknown' })
    expect(res.status).toBe(404)
  })
})
