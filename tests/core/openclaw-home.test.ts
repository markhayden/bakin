import { describe, it, expect, vi, afterEach } from 'vitest'
import { join } from 'path'

describe('openclaw-home', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  describe('getOpenClawHome', () => {
    it('returns OPENCLAW_HOME when set', async () => {
      process.env.OPENCLAW_HOME = '/tmp/mock-openclaw'
      const { getOpenClawHome } = await import('../../packages/core/src/openclaw-home')
      expect(getOpenClawHome()).toBe('/tmp/mock-openclaw')
    })

    it('falls back to ~/.openclaw when OPENCLAW_HOME is not set', async () => {
      delete process.env.OPENCLAW_HOME
      const { getOpenClawHome } = await import('../../packages/core/src/openclaw-home')
      const result = getOpenClawHome()
      expect(result).toMatch(/\.openclaw$/)
      expect(result).not.toContain('undefined')
    })
  })

  describe('getOpenClawPath', () => {
    it('joins segments onto OPENCLAW_HOME', async () => {
      process.env.OPENCLAW_HOME = '/tmp/mock-openclaw'
      const { getOpenClawPath } = await import('../../packages/core/src/openclaw-home')
      expect(getOpenClawPath('openclaw.json')).toBe('/tmp/mock-openclaw/openclaw.json')
    })

    it('handles multiple path segments', async () => {
      process.env.OPENCLAW_HOME = '/tmp/mock-openclaw'
      const { getOpenClawPath } = await import('../../packages/core/src/openclaw-home')
      expect(getOpenClawPath('agents', 'main', 'agent', 'auth-profiles.json'))
        .toBe('/tmp/mock-openclaw/agents/main/agent/auth-profiles.json')
    })

    it('returns home when called with no segments', async () => {
      process.env.OPENCLAW_HOME = '/tmp/mock-openclaw'
      const { getOpenClawPath } = await import('../../packages/core/src/openclaw-home')
      expect(getOpenClawPath()).toBe('/tmp/mock-openclaw')
    })

    it('uses default home when OPENCLAW_HOME is not set', async () => {
      delete process.env.OPENCLAW_HOME
      const { getOpenClawPath } = await import('../../packages/core/src/openclaw-home')
      const result = getOpenClawPath('flows', 'registry.sqlite')
      expect(result).toMatch(/\.openclaw\/flows\/registry\.sqlite$/)
    })
  })
})
