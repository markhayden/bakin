import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'

// Defensive content-dir mock (per CLAUDE.md test isolation rules) — this test
// doesn't touch storage, but the rule applies to every test file.
const testDir = join(tmpdir(), `bakin-openclaw-client-test-${Date.now()}`)
vi.mock('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

// Mock vault before importing openclaw-client
vi.mock('@/core/vault', () => ({
  get: vi.fn((key: string) => key === 'gateway-token' ? 'test-token' : null),
  has: vi.fn(() => true),
}))

// Mock settings
vi.mock('@/core/settings', () => ({
  getSettings: vi.fn(() => ({
    openclaw: {
      binaryPath: 'openclaw',
      gatewayUrl: 'http://localhost',
      gatewayPort: 18789,
    },
  })),
}))

vi.mock('@/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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
    vi.restoreAllMocks()
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
      const fetchMock = vi.fn()
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
      const fetchMock = vi.fn().mockResolvedValue(errorResponse(500, 'boom'))
      global.fetch = fetchMock as unknown as typeof fetch

      const client = await import('@/core/openclaw-client')
      await expect(client.sendMessage('patch', 'test')).rejects.toThrow(/OpenClaw sendMessage failed \(500\)/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does NOT retry on 4xx response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(errorResponse(401, 'unauthorized'))
      global.fetch = fetchMock as unknown as typeof fetch

      const client = await import('@/core/openclaw-client')
      await expect(client.sendMessage('patch', 'test')).rejects.toThrow(/OpenClaw sendMessage failed \(401\)/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('throws after 3 transient failures', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
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
      const fetchMock = vi.fn()
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
