/**
 * Tests for the runtime onboarding component.
 *
 * The component does not probe provider paths directly. It asks the configured
 * runtime adapter for readiness, roster, and raw config integrity data.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-runtime-onboarding-test-${Date.now()}`)
let useExistingServices = true
let initError: Error | null = null
let runtimeAvailable = true
let runtimeAgents: Array<{ id: string; name: string; role?: string; status: string }> = []
let runtimeConfig: unknown = null
let runtimeConfigError: Error | null = null

const runtime = {
  name: 'test-runtime',
  version: 'test',
  requiredCoreVersion: '*',
  ping: async () => runtimeAvailable,
  agents: {
    list: async () => runtimeAgents,
  },
  config: {
    raw: async () => {
      if (runtimeConfigError) throw runtimeConfigError
      return runtimeConfig
    },
  },
}

mock.module('../../../src/core/app-services', () => ({
  maybeGetAppServices: () => (useExistingServices ? { runtime } : undefined),
  createAppServices: async () => {
    if (initError) throw initError
    return { runtime }
  },
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ logs: join(testDir, 'logs') }),
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ logs: join(testDir, 'logs') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ logs: join(testDir, 'logs') }),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

describe('onboarding runtime component', () => {
  let runtimeComponent: typeof import('@/core/onboarding/runtime').runtimeComponent
  let RUNTIME_SETUP_URL: string

  beforeEach(async () => {
    useExistingServices = true
    initError = null
    runtimeAvailable = true
    runtimeAgents = [{ id: 'main', name: 'Main', role: 'Orchestrator', status: 'active' }]
    runtimeConfig = { agents: { list: [{ id: 'main' }] } }
    runtimeConfigError = null
    vi.resetModules()
    const mod = await import('@/core/onboarding/runtime')
    runtimeComponent = mod.runtimeComponent
    RUNTIME_SETUP_URL = mod.RUNTIME_SETUP_URL
  })

  describe('check()', () => {
    it('reports missing when the runtime adapter cannot initialize', async () => {
      useExistingServices = false
      initError = new Error('adapter init failed')

      const result = await runtimeComponent.check()
      expect(result.status).toBe('missing')
      expect(result.message).toContain('could not initialize')
      expect(result.remediation).toContain(RUNTIME_SETUP_URL)
    })

    it('reports missing when the runtime adapter is not reachable', async () => {
      runtimeAvailable = false

      const result = await runtimeComponent.check()
      expect(result.status).toBe('missing')
      expect(result.message).toContain('not reachable')
    })

    it('reports missing when the runtime config is absent before reading agents', async () => {
      runtimeAgents = []
      runtimeConfig = null

      const result = await runtimeComponent.check()
      expect(result.status).toBe('missing')
      expect(result.message).toContain('runtime config is not present')
      expect(result.remediation).toContain(RUNTIME_SETUP_URL)
    })

    it('reports broken when the runtime returns no agents', async () => {
      runtimeAgents = []
      runtimeConfig = { agents: { list: [] } }

      const result = await runtimeComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('no agents')
    })

    it('reports broken when runtime config cannot be read', async () => {
      runtimeConfigError = new Error('bad json')

      const result = await runtimeComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('could not be read')
    })

    it('reports ok for a reachable runtime with a main agent', async () => {
      const result = await runtimeComponent.check()
      expect(result.status).toBe('ok')
      expect(result.message).toContain('runtime adapter is available')
      expect(result.details?.mainAgentId).toBe('main')
    })

    it('accepts OpenClaw default-agent configs where agents.list is absent', async () => {
      runtimeAgents = [{ id: 'main', name: 'Main', role: 'Orchestrator', status: 'active' }]
      runtimeConfig = {
        agents: {
          defaults: {
            workspace: '/Users/markhayden/.openclaw/workspace',
            model: { primary: 'openai-codex/gpt-5.5' },
          },
        },
      }

      const result = await runtimeComponent.check()
      expect(result.status).toBe('ok')
      expect(result.details?.mainAgentId).toBe('main')
    })
  })

  describe('integrity check', () => {
    it("reports an error when no agent has id 'main'", async () => {
      runtimeAgents = [{ id: 'bob', name: 'Bob', status: 'active' }]
      runtimeConfig = { agents: { list: [{ id: 'bob', workspace: '/tmp/bob' }] } }

      const result = await runtimeComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('no agent')
      expect(result.message).toContain("'main'")
    })

    it('reports an error when two agents share the same id', async () => {
      runtimeConfig = {
        agents: {
          list: [
            { id: 'main', workspace: '/tmp/main-ws' },
            { id: 'main', workspace: '/tmp/other-ws' },
          ],
        },
      }

      const result = await runtimeComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('duplicate')
      expect(result.message).toContain("'main'")
    })

    it('reports an error when two agents collide on workspace', async () => {
      runtimeConfig = {
        agents: {
          list: [
            { id: 'a', workspace: '/x' },
            { id: 'b', workspace: '/x' },
            { id: 'main', workspace: '/y' },
          ],
        },
      }

      const result = await runtimeComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain("'a'")
      expect(result.message).toContain("'b'")
      expect(result.message).toContain('/x')
    })

    it('does not apply the default workspace to every subagent when agent workspaces are omitted', async () => {
      runtimeAgents = [
        { id: 'main', name: 'Main', role: 'Orchestrator', status: 'active' },
        { id: 'pixel', name: 'Pixel', status: 'active' },
      ]
      runtimeConfig = {
        agents: {
          defaults: { workspace: '/tmp/main-workspace' },
          list: [
            { id: 'main' },
            { id: 'pixel' },
          ],
        },
      }

      const result = await runtimeComponent.check()
      expect(result.status).toBe('ok')
    })
  })

  describe('install()', () => {
    it('is a noop that returns the install URL message', async () => {
      const result = await runtimeComponent.install({
        interactive: false,
        autoApprove: true,
        json: false,
        checkOnly: false,
        force: false,
      })
      expect(result.status).toBe('noop')
      expect(result.message).toContain(RUNTIME_SETUP_URL)
      expect(result.durationMs).toBe(0)
    })
  })
})
