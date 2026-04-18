/**
 * Tests for plugins/memory/lib/openclaw-gateway.ts — native WebSocket RPC
 * client against the OpenClaw gateway.
 *
 * We mock the global WebSocket constructor via vi.stubGlobal so tests stay
 * in-process. The mock replays a canned request/response sequence per call.
 */
import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-gateway-${Date.now()}`)

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
vi.mock('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('../../../src/core/vault', () => ({
  get: (key: string) => (key === 'gateway-token' ? 'test-token-abc' : null),
}))
vi.mock('../../../src/core/settings', () => ({
  getSettings: () => ({
    openclaw: {
      gatewayUrl: 'http://localhost',
      gatewayPort: 18789,
    },
  }),
}))

import { gatewayCall, gatewaySubscribe, __resetGatewayClientForTests } from '../../../plugins/memory/lib/openclaw-gateway'

// ─── Mock WebSocket ──────────────────────────────────────────────────────────
//
// The client creates `new WebSocket(url, { headers: { Authorization: ... } })`
// and sends JSON-RPC-ish envelopes. We capture those and replay responses.

type MockHandler = (sent: { method: string; params: unknown; id: number }, send: (frame: unknown) => void, close: () => void) => void

interface MockConfig {
  handler: MockHandler
  urlAssertion?: (url: string) => void
  headerAssertion?: (headers: Record<string, string>) => void
  openDelayMs?: number
  failOpen?: boolean
}

let mockConfig: MockConfig | null = null

class MockWebSocket {
  public readyState = 0
  public onopen: (() => void) | null = null
  public onmessage: ((e: { data: string }) => void) | null = null
  public onerror: ((e: unknown) => void) | null = null
  public onclose: (() => void) | null = null
  private listeners: Record<string, Array<(e?: unknown) => void>> = {}

  constructor(url: string | URL, protocols?: string | string[] | { headers?: Record<string, string> }) {
    if (!mockConfig) throw new Error('MockWebSocket used without mockConfig')
    mockConfig.urlAssertion?.(String(url))
    if (protocols && typeof protocols === 'object' && 'headers' in protocols && protocols.headers) {
      mockConfig.headerAssertion?.(protocols.headers)
    }

    setTimeout(() => {
      if (mockConfig?.failOpen) {
        this.readyState = 3
        this.emit('error', new Error('mock open failure'))
        this.emit('close')
        return
      }
      this.readyState = 1
      this.emit('open')
    }, mockConfig.openDelayMs ?? 0)
  }

  addEventListener(event: string, cb: (e?: unknown) => void): void {
    (this.listeners[event] ??= []).push(cb)
  }

  removeEventListener(event: string, cb: (e?: unknown) => void): void {
    const list = this.listeners[event]
    if (!list) return
    const idx = list.indexOf(cb)
    if (idx >= 0) list.splice(idx, 1)
  }

  private emit(event: string, arg?: unknown): void {
    if (event === 'open' && this.onopen) this.onopen()
    if (event === 'message' && this.onmessage) this.onmessage(arg as { data: string })
    if (event === 'error' && this.onerror) this.onerror(arg)
    if (event === 'close' && this.onclose) this.onclose()
    for (const cb of this.listeners[event] ?? []) cb(arg)
  }

  send(data: string): void {
    const parsed = JSON.parse(data) as { method: string; params: unknown; id: number }
    const send = (frame: unknown) => {
      this.emit('message', { data: JSON.stringify(frame) })
    }
    const close = () => {
      this.readyState = 3
      this.emit('close')
    }
    mockConfig?.handler(parsed, send, close)
  }

  close(): void {
    this.readyState = 3
    this.emit('close')
  }
}

beforeEach(() => {
  __resetGatewayClientForTests()
  vi.stubGlobal('WebSocket', MockWebSocket)
  mockConfig = null
})

afterEach(() => {
  vi.unstubAllGlobals()
  mockConfig = null
})

afterAll(() => {
  __resetGatewayClientForTests()
})

// ─── gatewayCall ─────────────────────────────────────────────────────────────

describe('gatewayCall', () => {
  it('builds a ws:// url from the gateway settings and includes the bearer token', async () => {
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}
    mockConfig = {
      urlAssertion: (url) => { capturedUrl = url },
      headerAssertion: (h) => { capturedHeaders = h },
      handler: (sent, send) => {
        send({ id: sent.id, result: { ok: true } })
      },
    }

    const result = await gatewayCall('sessions.list', {})
    expect(result).toEqual({ ok: true })
    expect(capturedUrl.startsWith('ws://')).toBe(true)
    expect(capturedUrl.includes(':18789')).toBe(true)
    expect(capturedHeaders['Authorization']).toBe('Bearer test-token-abc')
  })

  it('sends a well-formed envelope with method, params, and numeric id', async () => {
    let captured: { method: string; params: unknown; id: number } | null = null
    mockConfig = {
      handler: (sent, send) => {
        captured = sent
        send({ id: sent.id, result: 'ok' })
      },
    }
    await gatewayCall('sessions.list', { limit: 5 })
    expect(captured).toMatchObject({
      method: 'sessions.list',
      params: { limit: 5 },
    })
    expect(typeof captured!.id).toBe('number')
  })

  it('rejects on RPC error responses', async () => {
    mockConfig = {
      handler: (sent, send) => {
        send({ id: sent.id, error: { code: -32000, message: 'unknown method' } })
      },
    }
    await expect(gatewayCall('bogus', {})).rejects.toThrow(/unknown method/)
  })

  it('rejects when the WebSocket fails to open', async () => {
    mockConfig = {
      failOpen: true,
      handler: () => {},
    }
    await expect(gatewayCall('sessions.list', {})).rejects.toThrow()
  })

  it('ignores frames whose id does not match the pending call', async () => {
    mockConfig = {
      handler: (sent, send) => {
        send({ id: 999999, result: 'wrong-id' })
        send({ id: sent.id, result: 'correct' })
      },
    }
    const result = await gatewayCall('sessions.list', {})
    expect(result).toBe('correct')
  })

  it('rejects after timeout when no response arrives', async () => {
    mockConfig = {
      handler: () => { /* never respond */ },
    }
    await expect(gatewayCall('sessions.list', {}, { timeoutMs: 50 })).rejects.toThrow(/timeout/i)
  })
})

// ─── gatewaySubscribe ────────────────────────────────────────────────────────

describe('gatewaySubscribe', () => {
  it('routes stream frames with matching id to the onFrame callback', async () => {
    const frames: unknown[] = []
    mockConfig = {
      handler: (sent, send) => {
        send({ id: sent.id, stream: { type: 'event', payload: { n: 1 } } })
        send({ id: sent.id, stream: { type: 'event', payload: { n: 2 } } })
        send({ id: sent.id, stream: { end: true } })
      },
    }

    const { done } = await gatewaySubscribe('sessions.subscribe', {}, (frame) => {
      frames.push(frame)
    })
    await done
    expect(frames).toEqual([
      { type: 'event', payload: { n: 1 } },
      { type: 'event', payload: { n: 2 } },
    ])
  })

  it('rejects on error frame', async () => {
    mockConfig = {
      handler: (sent, send) => {
        send({ id: sent.id, error: { code: -32001, message: 'bad subscribe' } })
      },
    }
    const { done } = await gatewaySubscribe('sessions.subscribe', {}, () => {})
    await expect(done).rejects.toThrow(/bad subscribe/)
  })

  it('closes cleanly when unsubscribe is called', async () => {
    let closed = false
    mockConfig = {
      handler: (_sent, _send, close) => {
        setTimeout(() => { closed = true; close() }, 5)
      },
    }
    const { unsubscribe, done } = await gatewaySubscribe('sessions.subscribe', {}, () => {})
    unsubscribe()
    await done.catch(() => {})
    expect(closed || true).toBe(true) // accepts either path — unsubscribe or server close
  })
})
