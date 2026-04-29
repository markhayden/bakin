import { describe, it, expect, afterEach, mock } from 'bun:test'

// These tests exercise the getOpenClawHome/getOpenClawPath fallback path
// that resolves against os.homedir(). The runtime guard in openclaw-home.ts
// compares the resolved path to process.env.HOME → so we redirect the
// module's `os.homedir()` to one fake value while pointing process.env.HOME
// at a DIFFERENT fake value. Result: caller resolves via mocked homedir
// → /tmp/module/.openclaw. Guard compares against /tmp/guard/.openclaw.
// Paths differ → no guard trip.
//
// We deliberately do NOT mock @bakin/adapter-openclaw/home — that is the
// module under test. The test-mock hook skips this via its self-test
// exception (basename of the test file matches the pattern label).
//
// String literals are inlined (not top-level consts) because vi.mock
// factories are hoisted above consts and would TDZ-error if they closed
// over them.

mock.module('os', () => {
  const actual = require('os') as typeof import('os')
  return { ...actual, homedir: () => '/tmp/bakin-test-module-home-fake' }
})

const actualContentDir = require('../../packages/core/src/content-dir') as typeof import('../../packages/core/src/content-dir')

// Satisfy the content-dir mock requirement even though these tests don't
// touch it. Keep this as a pass-through so the mock cannot leak fake storage
// paths into later files that intentionally exercise the real guard.
mock.module('../../packages/core/src/content-dir', () => ({
  ...actualContentDir,
}))

describe('openclaw-home', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  describe('getOpenClawHome', () => {
    it('returns OPENCLAW_HOME when set', async () => {
      process.env.OPENCLAW_HOME = '/tmp/mock-openclaw'
      const { getOpenClawHome } = require('../../packages/adapter-openclaw/src/home') as typeof import('../../packages/adapter-openclaw/src/home')
      expect(getOpenClawHome()).toBe('/tmp/mock-openclaw')
    })

    it('falls back to ~/.openclaw when OPENCLAW_HOME is not set', async () => {
      delete process.env.OPENCLAW_HOME
      process.env.HOME = '/tmp/bakin-test-guard-home-fake'
      const { getOpenClawHome } = require('../../packages/adapter-openclaw/src/home') as typeof import('../../packages/adapter-openclaw/src/home')
      const result = getOpenClawHome()
      expect(result).toMatch(/\.openclaw$/)
      expect(result).not.toContain('undefined')
    })
  })

  describe('getOpenClawPath', () => {
    it('joins segments onto OPENCLAW_HOME', async () => {
      process.env.OPENCLAW_HOME = '/tmp/mock-openclaw'
      const { getOpenClawPath } = require('../../packages/adapter-openclaw/src/home') as typeof import('../../packages/adapter-openclaw/src/home')
      expect(getOpenClawPath('openclaw.json')).toBe('/tmp/mock-openclaw/openclaw.json')
    })

    it('handles multiple path segments', async () => {
      process.env.OPENCLAW_HOME = '/tmp/mock-openclaw'
      const { getOpenClawPath } = require('../../packages/adapter-openclaw/src/home') as typeof import('../../packages/adapter-openclaw/src/home')
      expect(getOpenClawPath('agents', 'main', 'agent', 'auth-profiles.json'))
        .toBe('/tmp/mock-openclaw/agents/main/agent/auth-profiles.json')
    })

    it('returns home when called with no segments', async () => {
      process.env.OPENCLAW_HOME = '/tmp/mock-openclaw'
      const { getOpenClawPath } = require('../../packages/adapter-openclaw/src/home') as typeof import('../../packages/adapter-openclaw/src/home')
      expect(getOpenClawPath()).toBe('/tmp/mock-openclaw')
    })

    it('uses default home when OPENCLAW_HOME is not set', async () => {
      delete process.env.OPENCLAW_HOME
      process.env.HOME = '/tmp/bakin-test-guard-home-fake'
      const { getOpenClawPath } = require('../../packages/adapter-openclaw/src/home') as typeof import('../../packages/adapter-openclaw/src/home')
      const result = getOpenClawPath('agents', 'main', 'agent', 'auth-profiles.json')
      expect(result).toMatch(/\.openclaw\/agents\/main\/agent\/auth-profiles\.json$/)
    })
  })
})
