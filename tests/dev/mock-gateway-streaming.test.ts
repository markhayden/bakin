import { describe, it, expect } from 'bun:test'
import { handleGatewayRpcRequest } from '../../dev/imitation-crab/gateway'

describe('mock gateway agent RPC', () => {
  it('returns final agent text payloads through the Gateway RPC contract', async () => {
    const res = await handleGatewayRpcRequest('agent', {
      agentId: 'jessica',
      message: 'Plan next week',
      expectFinal: true,
    })

    expect(res.ok).toBe(true)
    const payload = res.payload as {
      result?: { payloads?: Array<{ text?: string }>; meta?: { finalAssistantVisibleText?: string } }
    }
    expect(payload.result?.payloads?.[0]?.text).toContain('mock:Jessica')
    expect(payload.result?.meta?.finalAssistantVisibleText).toContain('mock:Jessica')
  })

  it('uses the message param for echo mode replies', async () => {
    const original = process.env.OPENCLAW_MOCK_CHAT_MODE
    process.env.OPENCLAW_MOCK_CHAT_MODE = 'echo'

    try {
      const res = await handleGatewayRpcRequest('agent', {
        agentId: 'rolo',
        message: 'Plan outdoor content',
        expectFinal: true,
      })

      expect(res.ok).toBe(true)
      expect(JSON.stringify(res.payload)).toContain('[mock:Rolo] Plan outdoor content')
    } finally {
      process.env.OPENCLAW_MOCK_CHAT_MODE = original
    }
  })
})
