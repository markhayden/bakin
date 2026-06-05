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

  send(raw: string): void {
    const frame = JSON.parse(raw) as Frame
    this.sentFrames.push(frame)
    if (frame.method === 'connect') {
      this.emitMessage({ type: 'res', id: frame.id, ok: true, payload: { auth: { scopes: [] } } })
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
    await new Promise((r) => setTimeout(r, 10))
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
    await new Promise((r) => setTimeout(r, 10))
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
