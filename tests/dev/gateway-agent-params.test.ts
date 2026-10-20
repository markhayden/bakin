/**
 * The Imitation Crab mirrors OpenClaw 2026.9.5's CLOSED `agent` RPC schema
 * (#883): a param the real gateway does not know is refused with the real
 * gateway's error shape, so the suite catches adapter↔gateway drift before a
 * live box does. The property list lives in agent-params-schema.ts and is
 * copied from the installed 2026.9.5 dist (AgentParamsSchema).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { handleGatewayRpcRequest } from '../../dev/imitation-crab/gateway'

// A successful agent call writes session files under getMockHome() — never
// the developer's real ~/.imitationcrab.
const originalEnv = { ...process.env }
let mockHome = ''
beforeAll(() => {
  mockHome = mkdtempSync(join(tmpdir(), 'bakin-crab-schema-'))
  process.env.IMITATION_CRAB_HOME = mockHome
  delete process.env.OPENCLAW_MOCK_HOME
})
afterAll(() => {
  process.env = { ...originalEnv }
  rmSync(mockHome, { recursive: true, force: true })
})

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
