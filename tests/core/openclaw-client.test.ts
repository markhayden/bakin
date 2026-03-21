import { describe, it, expect, vi, beforeEach } from 'vitest'

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

describe('openclaw-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should export expected functions', async () => {
    const client = await import('@/core/openclaw-client')
    expect(typeof client.sendMessage).toBe('function')
    expect(typeof client.invokeTool).toBe('function')
    expect(typeof client.sendChannelMessage).toBe('function')
    expect(typeof client.restartGateway).toBe('function')
    expect(typeof client.ping).toBe('function')
  })

  it('ping should return false when server is unreachable', async () => {
    const client = await import('@/core/openclaw-client')
    // Default settings point to localhost:18789 which isn't running in tests
    const result = await client.ping()
    expect(result).toBe(false)
  })
})
