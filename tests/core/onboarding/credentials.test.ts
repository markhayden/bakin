/**
 * Tests for the credentials onboarding component (LLM + channels).
 *
 * Both checks are warn-only - they never return 'error' and never
 * mutate the filesystem. Tests verify:
 *   - Each granular warn state (file missing, wrong shape, empty,
 *     valid) surfaces correctly in CheckResult
 *   - install() for both subcomponents is a hard noop - no fs writes
 *
 * Uses a real temp directory plus a mocked runtime config adapter
 * so the component reads through the adapter boundary.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let fakeHome: string

const authProfilesPath = () => join(fakeHome, 'agents', 'main', 'agent', 'auth-profiles.json')
const runtimeConfigPath = () => join(fakeHome, 'runtime-config.json')

const runtime = {
  agents: {
    list: async () => [{ id: 'main', name: 'Main', role: 'Orchestrator', status: 'active' }],
  },
  config: {
    raw: async (key: string) => {
      if (key === 'agents.main.authProfiles') {
        if (!existsSync(authProfilesPath())) return null
        return JSON.parse(readFileSync(authProfilesPath(), 'utf-8'))
      }
      if (key === 'channels') {
        if (!existsSync(runtimeConfigPath())) return null
        return JSON.parse(readFileSync(runtimeConfigPath(), 'utf-8')).channels
      }
      return null
    },
  },
}

mock.module('../../../src/core/app-services', () => ({
  maybeGetAppServices: () => ({ runtime }),
  createAppServices: async () => ({ runtime }),
}))
mock.module('../../../src/core/app-services-store', () => ({
  maybeGetAppServices: () => ({ runtime }),
  createAppServices: async () => ({ runtime }),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

describe('onboarding credentials component', () => {
  let llmComponent: typeof import('../../../src/core/onboarding/credentials').llmComponent
  let channelsComponent: typeof import('../../../src/core/onboarding/credentials').channelsComponent

  beforeEach(async () => {
    fakeHome = mkdtempSync(join(tmpdir(), 'bakin-onboarding-creds-'))
    mkdirSync(join(fakeHome, 'agents', 'main', 'agent'), { recursive: true })
    vi.resetModules()
    const mod = await import('../../../src/core/onboarding/credentials')
    llmComponent = mod.llmComponent
    channelsComponent = mod.channelsComponent
  })

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true })
  })

  const opts = {
    interactive: false,
    autoApprove: true,
    json: false,
    checkOnly: false,
    force: false,
  }

  // -------------------------------------------------------------------------
  // llm component
  // -------------------------------------------------------------------------

  describe('llm.check()', () => {
    it('reports warn when auth-profiles.json is missing', async () => {
      const result = await llmComponent.check()
      expect(result.status).toBe('warn')
      expect(result.message).toContain('missing')
      expect(result.remediation).toContain('runtime adapter')
    })

    it('reports warn when file has no recognizable entries', async () => {
      writeFileSync(authProfilesPath(), JSON.stringify({ unrelated: true }))
      const result = await llmComponent.check()
      expect(result.status).toBe('warn')
      expect(result.message).toContain('no provider entries')
    })

    it('reports warn when the bare array is empty', async () => {
      writeFileSync(authProfilesPath(), JSON.stringify([]))
      const result = await llmComponent.check()
      expect(result.status).toBe('warn')
      expect(result.message).toContain('no provider entries')
    })

    it('reports warn when all entries have empty credentials', async () => {
      writeFileSync(authProfilesPath(), JSON.stringify([
        { provider: 'anthropic', apiKey: '' },
        { provider: 'openai', apiKey: '   ', token: '', access: '' },
      ]))
      const result = await llmComponent.check()
      expect(result.status).toBe('warn')
    })

    it('reports ok from bare array shape (imitation crab)', async () => {
      writeFileSync(authProfilesPath(), JSON.stringify([
        { provider: 'anthropic', apiKey: 'sk-ant-fake' },
        { provider: 'openai', apiKey: '' },
      ]))
      const result = await llmComponent.check()
      expect(result.status).toBe('ok')
      expect(result.details?.providers).toEqual(['anthropic'])
    })

    it('reports ok from token auth profiles', async () => {
      writeFileSync(authProfilesPath(), JSON.stringify([
        { provider: 'anthropic', type: 'token', token: 'anthropic-token' },
      ]))
      const result = await llmComponent.check()
      expect(result.status).toBe('ok')
      expect(result.details?.providers).toEqual(['anthropic'])
    })

    it('reports ok from Codex OAuth auth profiles', async () => {
      writeFileSync(authProfilesPath(), JSON.stringify([
        { provider: 'openai-codex', type: 'oauth', access: 'access-token', refresh: 'refresh-token' },
      ]))
      const result = await llmComponent.check()
      expect(result.status).toBe('ok')
      expect(result.message).toContain('openai-codex')
      expect(result.details?.providers).toEqual(['openai-codex'])
    })

    it('reports ok from { profiles: [...] } shape', async () => {
      writeFileSync(authProfilesPath(), JSON.stringify({
        profiles: [
          { provider: 'anthropic', apiKey: 'sk-ant-real' },
          { provider: 'openai', apiKey: 'sk-oai-real' },
        ],
      }))
      const result = await llmComponent.check()
      expect(result.status).toBe('ok')
      expect(result.details?.providers).toEqual(['anthropic', 'openai'])
    })

    it('reports ok from { profiles: { key: {...} } } dict shape', async () => {
      writeFileSync(authProfilesPath(), JSON.stringify({
        profiles: {
          'default-anthropic': { provider: 'anthropic', apiKey: 'sk-ant-dict' },
          'codex-oauth': { provider: 'openai-codex', mode: 'oauth', access: 'access-token' },
        },
      }))
      const result = await llmComponent.check()
      expect(result.status).toBe('ok')
      expect(result.details?.providers).toEqual(['anthropic', 'openai-codex'])
    })

    it('reports ok with multiple providers when several are configured', async () => {
      writeFileSync(authProfilesPath(), JSON.stringify([
        { provider: 'anthropic', apiKey: 'sk-ant-fake' },
        { provider: 'openai', apiKey: 'sk-fake' },
        { provider: 'grok', apiKey: 'xai-fake' },
      ]))
      const result = await llmComponent.check()
      expect(result.status).toBe('ok')
      expect((result.details?.providers as string[]).length).toBe(3)
    })

    it('reports warn when auth-profiles.json is malformed', async () => {
      writeFileSync(authProfilesPath(), 'not-json {{{')
      const result = await llmComponent.check()
      expect(result.status).toBe('warn')
      expect(result.message).toContain('Could not parse')
    })
  })

  describe('llm.install()', () => {
    it('is a noop that returns the runtime docs URL', async () => {
      const result = await llmComponent.install(opts)
      expect(result.status).toBe('noop')
      expect(result.message).toContain('runtime adapter')
    })
  })

  // -------------------------------------------------------------------------
  // channels component
  // -------------------------------------------------------------------------

  describe('channels.check()', () => {
    it('reports warn when runtime channel config is missing', async () => {
      const result = await channelsComponent.check()
      expect(result.status).toBe('warn')
      expect(result.message).toContain('missing')
    })

    it('reports warn when runtime config has no channels key', async () => {
      writeFileSync(runtimeConfigPath(), JSON.stringify({ runtime: { auth: { token: 'x' } } }))
      const result = await channelsComponent.check()
      expect(result.status).toBe('warn')
      expect(result.message).toContain('missing')
    })

    it('reports warn when channels is not an object', async () => {
      writeFileSync(runtimeConfigPath(), JSON.stringify({ channels: 'wrong-type' }))
      const result = await channelsComponent.check()
      expect(result.status).toBe('warn')
      expect(result.message).toContain('not an object')
    })

    it('reports warn when channels exist but all credentials are empty', async () => {
      writeFileSync(runtimeConfigPath(), JSON.stringify({
        channels: {
          discord: { token: '' },
          telegram: { apiKey: '   ' },
        },
      }))
      const result = await channelsComponent.check()
      expect(result.status).toBe('warn')
    })

    it('reports ok when any channel has a token', async () => {
      writeFileSync(runtimeConfigPath(), JSON.stringify({
        channels: {
          discord: { token: 'fake-discord-token' },
          telegram: { apiKey: '' },
        },
      }))
      const result = await channelsComponent.check()
      expect(result.status).toBe('ok')
      expect(result.details?.channels).toEqual(['discord'])
    })

    it('reports ok when multiple channels are configured', async () => {
      writeFileSync(runtimeConfigPath(), JSON.stringify({
        channels: {
          discord: { token: 'fake-discord' },
          slack: { token: 'xoxb-fake' },
          telegram: { botToken: 'fake-bot' },
        },
      }))
      const result = await channelsComponent.check()
      expect(result.status).toBe('ok')
      expect((result.details?.channels as string[]).length).toBe(3)
    })

    it('reports warn when runtime config is malformed', async () => {
      writeFileSync(runtimeConfigPath(), 'not-json {{{')
      const result = await channelsComponent.check()
      expect(result.status).toBe('warn')
      expect(result.message).toContain('Could not parse')
    })
  })

  describe('channels.install()', () => {
    it('is a noop that returns the runtime docs URL', async () => {
      const result = await channelsComponent.install(opts)
      expect(result.status).toBe('noop')
      expect(result.message).toContain('runtime adapter')
    })
  })
})
