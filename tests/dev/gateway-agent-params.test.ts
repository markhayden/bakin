/**
 * The Imitation Crab mirrors OpenClaw 2026.9.5's CLOSED `agent` RPC schema
 * (#883): a param the real gateway does not know is refused with the real
 * gateway's error shape, so the suite catches adapter↔gateway drift before a
 * live box does. The property list lives in agent-params-schema.ts and is
 * copied from the installed 2026.9.5 dist (AgentParamsSchema).
 */
import { describe, expect, it } from 'bun:test'
import { handleGatewayRpcRequest } from '../../dev/imitation-crab/gateway'

const VALID = { agentId: 'pixel', message: 'Say ok.', idempotencyKey: 'k-1', deliver: false, timeout: 30 }

describe('Imitation Crab: agent RPC params mirror the 2026.9.5 closed schema', () => {
  it('accepts the adapter\'s full param shape', async () => {
    const res = await handleGatewayRpcRequest('agent', {
      ...VALID,
      sessionId: 'sess-1',
      sessionKey: 'agent:pixel:explicit:sess-1',
      model: 'openai/gpt-5.5',
      thinking: 'low',
      attachments: [],
      sessionEffects: 'internal',
      suppressPromptPersistence: true,
      label: 'conformance',
    })
    expect(res.ok).toBe(true)
  })

  it('rejects toolsMode exactly like the real gateway (the #883 drift)', async () => {
    const res = await handleGatewayRpcRequest('agent', { ...VALID, toolsMode: 'none' })
    expect(res).toEqual({
      ok: false,
      error: { message: "invalid agent params: at root: unexpected property 'toolsMode'", code: 'INVALID_REQUEST' },
    })
  })

  it('rejects any other unknown property, naming it', async () => {
    const res = await handleGatewayRpcRequest('agent', { ...VALID, expectFinal: true })
    expect(res).toMatchObject({ ok: false, error: { message: "invalid agent params: at root: unexpected property 'expectFinal'", code: 'INVALID_REQUEST' } })
  })

  it('requires the non-optional strings (message, idempotencyKey)', async () => {
    const noKey = await handleGatewayRpcRequest('agent', { agentId: 'pixel', message: 'hi' })
    expect(noKey).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    const noMessage = await handleGatewayRpcRequest('agent', { agentId: 'pixel', idempotencyKey: 'k-2' })
    expect(noMessage).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  })
})
