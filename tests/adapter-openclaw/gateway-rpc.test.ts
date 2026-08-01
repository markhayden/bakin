/**
 * Unit tests for OpenClawGatewayRpcClient abort wiring: a fail-fast verdict
 * cancels the pending agent RPC so its (up to 630s) timer can't linger, and
 * a pre-aborted signal never sends a frame.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-gateway-rpc-${Date.now()}`)
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
}))

import { OpenClawGatewayRpcClient } from '../../packages/adapter-openclaw/src/gateway-rpc'
import { RuntimeError } from '../../packages/core/src/adapters/runtime'
import { settleFor, waitUntil } from '../helpers/wait'

type Frame = { type: string; id: string; method: string; params: Record<string, unknown> }

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readyState = 0
  sentFrames: Frame[] = []
  private listeners = new Map<string, Set<(event: { data?: string }) => void>>()

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = 1
      this.emit('open', {})
      this.emitMessage({ type: 'event', event: 'connect.challenge', payload: { nonce: 'n-1' } })
    })
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: { data?: string }) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  /** hello-ok payload the fake returns for connect; tests override per case. */
  static connectPayload: Record<string, unknown> = { type: 'hello-ok', protocol: 4, auth: { scopes: [] } }

  send(raw: string): void {
    const frame = JSON.parse(raw) as Frame
    this.sentFrames.push(frame)
    if (frame.method === 'connect') {
      this.emitMessage({ type: 'res', id: frame.id, ok: true, payload: FakeWebSocket.connectPayload })
    }
    // Other methods: never answered — tests control resolution manually.
  }

  close(): void {
    this.readyState = 3
    this.emit('close', {})
  }

  emitMessage(frame: Record<string, unknown>): void {
    this.emit('message', { data: JSON.stringify(frame) })
  }

  private emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

let originalWebSocket: typeof globalThis.WebSocket | undefined
let client: OpenClawGatewayRpcClient

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  FakeWebSocket.instances.length = 0
  FakeWebSocket.connectPayload = { type: 'hello-ok', protocol: 4, auth: { scopes: [] } }
  client = new OpenClawGatewayRpcClient({
    url: 'ws://127.0.0.1:1',
    token: () => null,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    clientId: 'test-client',
    displayName: 'Test',
    clientMode: 'backend',
    scopes: ['operator.read'],
    label: 'Test gateway',
  })
})

afterEach(() => {
  client.close()
  globalThis.WebSocket = originalWebSocket as typeof WebSocket
})

describe('gateway RPC abort signal', () => {
  it('aborting an in-flight request rejects with a transport RuntimeError and clears the pending entry', async () => {
    const abort = new AbortController()
    const request = client.request('agent', { agentId: 'jessica' }, { expectFinal: true, timeoutMs: 600_000, signal: abort.signal })
    request.catch(() => {})

    // Let the connect handshake settle and the agent frame go out.
    await waitUntil(
      () => Boolean(FakeWebSocket.instances[0]?.sentFrames.some((f) => f.method === 'agent')),
      { label: 'the agent frame to be sent after the connect handshake' },
    )
    const ws = FakeWebSocket.instances[0]!
    const agentFrame = ws.sentFrames.find((f) => f.method === 'agent')
    expect(agentFrame).toBeDefined()

    abort.abort()
    let thrown: unknown
    try {
      await request
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(RuntimeError)
    expect((thrown as RuntimeError).kind).toBe('transport')
    expect((thrown as Error).message).toContain('request aborted: agent')

    // Pending entry is gone: a late final frame for the aborted id must be
    // ignored (no double settle, no unhandled rejection).
    ws.emitMessage({ type: 'res', id: agentFrame!.id, ok: true, payload: { result: { meta: { finalAssistantVisibleText: 'late' } } } })
    await settleFor(10, 'a late duplicate response must be ignored — no double settle and no unhandled rejection')
  })

  it('a pre-aborted signal rejects without sending the frame', async () => {
    const abort = new AbortController()
    abort.abort()

    let thrown: unknown
    try {
      await client.request('agent', { agentId: 'jessica' }, { timeoutMs: 600_000, signal: abort.signal })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(RuntimeError)
    expect((thrown as RuntimeError).kind).toBe('transport')

    const ws = FakeWebSocket.instances[0]!
    expect(ws.sentFrames.find((f) => f.method === 'agent')).toBeUndefined()
  })
})

describe('connect caps + protocol gate', () => {
  it('the connect frame declares the tool-events cap', async () => {
    const request = client.request('health', {})
    request.catch(() => {})
    await waitUntil(
      () => Boolean(FakeWebSocket.instances[0]?.sentFrames.some((f) => f.method === 'connect')),
      { label: 'the connect frame to be sent' },
    )
    const ws = FakeWebSocket.instances[0]!
    const connectFrame = ws.sentFrames.find((f) => f.method === 'connect')
    expect(connectFrame?.params.caps).toEqual(['tool-events'])
  })

  it('a gateway below protocol 4 fails connect with an actionable upgrade error', async () => {
    FakeWebSocket.connectPayload = { type: 'hello-ok', protocol: 3, server: { version: '2026.4.1' }, auth: { scopes: [] } }
    let thrown: unknown
    try {
      await client.request('health', {})
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(RuntimeError)
    const message = (thrown as Error).message
    expect(message).toContain('protocol 3')
    expect(message).toContain('2026.4.1')
    expect(message.toLowerCase()).toContain('upgrade openclaw')
  })

  it('a gateway that does not report a protocol fails connect actionably', async () => {
    FakeWebSocket.connectPayload = { type: 'hello-ok', auth: { scopes: [] } }
    let thrown: unknown
    try {
      await client.request('health', {})
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(RuntimeError)
    expect(((thrown as Error).message).toLowerCase()).toContain('upgrade openclaw')
  })
})

describe('accepted-ack surfacing', () => {
  it('onAccepted fires with runId/sessionKey while the request stays pending until the final', async () => {
    const acks: Array<{ runId: string | null; sessionKey: string | null; acceptedAt: number | null }> = []
    const request = client.request(
      'agent',
      { agentId: 'jessica', idempotencyKey: 'bakin-run-1' },
      { expectFinal: true, timeoutMs: 600_000, onAccepted: (ack) => acks.push(ack) },
    )
    await waitUntil(
      () => Boolean(FakeWebSocket.instances[0]?.sentFrames.some((f) => f.method === 'agent')),
      { label: 'the agent frame to be sent' },
    )
    const ws = FakeWebSocket.instances[0]!
    const agentFrame = ws.sentFrames.find((f) => f.method === 'agent')!

    ws.emitMessage({
      type: 'res',
      id: agentFrame.id,
      ok: true,
      payload: { runId: 'bakin-run-1', sessionKey: 'agent:jessica:main', status: 'accepted', acceptedAt: 1234 },
    })
    await waitUntil(() => acks.length > 0, { label: 'the accepted ack to reach onAccepted' })
    expect(acks).toEqual([{ runId: 'bakin-run-1', sessionKey: 'agent:jessica:main', acceptedAt: 1234 }])

    // Still pending: the ack must not settle the request.
    let settled = false
    request.then(() => { settled = true }).catch(() => { settled = true })
    await settleFor(5, 'an ack must NOT settle the request — the absence of a settle is the assertion')
    expect(settled).toBe(false)

    ws.emitMessage({ type: 'res', id: agentFrame.id, ok: true, payload: { runId: 'bakin-run-1', status: 'ok', summary: 'completed' } })
    const result = await request
    expect((result as { status: string }).status).toBe('ok')
  })

  it('onAccepted fires at most once and a throwing callback does not break settlement', async () => {
    let calls = 0
    const request = client.request(
      'agent',
      { agentId: 'jessica' },
      {
        expectFinal: true,
        timeoutMs: 600_000,
        onAccepted: () => {
          calls++
          throw new Error('handler bug')
        },
      },
    )
    await waitUntil(
      () => Boolean(FakeWebSocket.instances[0]?.sentFrames.some((f) => f.method === 'agent')),
      { label: 'the agent frame to be sent' },
    )
    const ws = FakeWebSocket.instances[0]!
    const agentFrame = ws.sentFrames.find((f) => f.method === 'agent')!

    const ack = { runId: 'r', sessionKey: 's', status: 'accepted', acceptedAt: 1 }
    ws.emitMessage({ type: 'res', id: agentFrame.id, ok: true, payload: ack })
    ws.emitMessage({ type: 'res', id: agentFrame.id, ok: true, payload: ack })
    await settleFor(5, 'a duplicate ack must NOT invoke onAccepted twice — the second call not arriving is the assertion')
    expect(calls).toBe(1)

    ws.emitMessage({ type: 'res', id: agentFrame.id, ok: true, payload: { status: 'ok' } })
    const result = await request
    expect((result as { status: string }).status).toBe('ok')
  })

  it('without onAccepted the ack is still swallowed (existing behavior)', async () => {
    const request = client.request('agent', { agentId: 'jessica' }, { expectFinal: true, timeoutMs: 600_000 })
    await waitUntil(
      () => Boolean(FakeWebSocket.instances[0]?.sentFrames.some((f) => f.method === 'agent')),
      { label: 'the agent frame to be sent' },
    )
    const ws = FakeWebSocket.instances[0]!
    const agentFrame = ws.sentFrames.find((f) => f.method === 'agent')!

    ws.emitMessage({ type: 'res', id: agentFrame.id, ok: true, payload: { status: 'accepted', runId: 'r' } })
    let settled = false
    request.then(() => { settled = true }).catch(() => { settled = true })
    await settleFor(5, 'an ack must NOT settle the request — the absence of a settle is the assertion')
    expect(settled).toBe(false)

    ws.emitMessage({ type: 'res', id: agentFrame.id, ok: true, payload: { status: 'ok' } })
    await request
  })
})
