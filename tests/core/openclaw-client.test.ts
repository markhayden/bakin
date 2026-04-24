import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Defensive content-dir mock (per CLAUDE.md test isolation rules) — this test
// doesn't touch storage, but the rule applies to every test file.
const testDir = join(tmpdir(), `bakin-openclaw-client-test-${Date.now()}`)
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

// Mock vault before importing openclaw-client
mock.module('@/core/vault', () => ({
  get: mock((key: string) => key === 'gateway-token' ? 'test-token' : null),
  has: mock(() => true),
}))

// Mock settings
mock.module('@/core/settings', () => ({
  getSettings: mock(() => ({
    openclaw: {
      binaryPath: 'openclaw',
      gatewayUrl: 'http://localhost',
      gatewayPort: 18789,
    },
  })),
}))

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

const originalFetch = global.fetch

function okResponse(content = 'ok'): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  } as unknown as Response
}

function errorResponse(status: number, body = 'upstream error'): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: body }),
    text: async () => body,
  } as unknown as Response
}

describe('openclaw-client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    global.fetch = originalFetch
    mock.restore()
  })

  it('exports expected functions', async () => {
    const client = await import('@/core/openclaw-client')
    expect(typeof client.sendMessage).toBe('function')
    expect(typeof client.invokeTool).toBe('function')
    expect(typeof client.sendChannelMessage).toBe('function')
    expect(typeof client.restartGateway).toBe('function')
    expect(typeof client.ping).toBe('function')
  })

  describe('sendMessage retry', () => {
    it('retries transient TypeError("fetch failed") and succeeds on attempt 3', async () => {
      const fetchMock = mock()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(okResponse('hello'))
      global.fetch = fetchMock as unknown as typeof fetch

      const client = await import('@/core/openclaw-client')
      const promise = client.sendMessage('patch', 'test message')
      await vi.runAllTimersAsync()
      const reply = await promise

      expect(reply).toBe('hello')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('does NOT retry on 500 response (fetch resolved, !res.ok path)', async () => {
      const fetchMock = mock().mockResolvedValue(errorResponse(500, 'boom'))
      global.fetch = fetchMock as unknown as typeof fetch

      const client = await import('@/core/openclaw-client')
      await expect(client.sendMessage('patch', 'test')).rejects.toThrow(/OpenClaw sendMessage failed \(500\)/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does NOT retry on 4xx response', async () => {
      const fetchMock = mock().mockResolvedValue(errorResponse(401, 'unauthorized'))
      global.fetch = fetchMock as unknown as typeof fetch

      const client = await import('@/core/openclaw-client')
      await expect(client.sendMessage('patch', 'test')).rejects.toThrow(/OpenClaw sendMessage failed \(401\)/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('throws after 3 transient failures', async () => {
      const fetchMock = mock().mockRejectedValue(new TypeError('fetch failed'))
      global.fetch = fetchMock as unknown as typeof fetch

      const client = await import('@/core/openclaw-client')
      const promise = client.sendMessage('patch', 'test')
      // Catch the rejection eagerly so it doesn't surface as unhandled
      // while we drive timers forward.
      const caught = promise.catch(e => e)
      await vi.runAllTimersAsync()
      const err = await caught

      expect(err).toBeInstanceOf(TypeError)
      expect((err as Error).message).toBe('fetch failed')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('retries on err.cause.code === "ECONNRESET"', async () => {
      const econnreset = Object.assign(new Error('socket hang up'), {
        cause: { code: 'ECONNRESET' },
      })
      const fetchMock = mock()
        .mockRejectedValueOnce(econnreset)
        .mockResolvedValueOnce(okResponse('ok'))
      global.fetch = fetchMock as unknown as typeof fetch

      const client = await import('@/core/openclaw-client')
      const promise = client.sendMessage('patch', 'test')
      await vi.runAllTimersAsync()
      const reply = await promise

      expect(reply).toBe('ok')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('ping', () => {
    it('returns a boolean', async () => {
      // Restore real timers for ping — it uses AbortSignal.timeout internally
      vi.useRealTimers()
      const client = await import('@/core/openclaw-client')
      const result = await client.ping()
      expect(typeof result).toBe('boolean')
    })
  })
})
