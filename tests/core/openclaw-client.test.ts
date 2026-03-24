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

  it('ping should return a boolean', async () => {
    const client = await import('@/core/openclaw-client')
    // Gateway may or may not be running in test environment
    const result = await client.ping()
    expect(typeof result).toBe('boolean')
  })
})
