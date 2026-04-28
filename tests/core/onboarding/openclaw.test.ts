/**
 * Tests for the runtime onboarding component historically named "openclaw".
 *
 * The component no longer probes OpenClaw paths directly. It asks the configured
 * runtime adapter for readiness, roster, and raw config integrity data.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'

let useExistingServices = true
let initError: Error | null = null
let runtimeAvailable = true
let runtimeAgents: Array<{ id: string; name: string; role?: string; status: string }> = []
let runtimeConfig: unknown = null
let runtimeConfigError: Error | null = null

const runtime = {
  name: 'openclaw',
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

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

describe('onboarding openclaw component', () => {
  let openclawComponent: typeof import('../../../src/core/onboarding/openclaw').openclawComponent
  let OPENCLAW_INSTALL_URL: string

  beforeEach(async () => {
    useExistingServices = true
    initError = null
    runtimeAvailable = true
    runtimeAgents = [{ id: 'main', name: 'Main', role: 'Orchestrator', status: 'active' }]
    runtimeConfig = { agents: { list: [{ id: 'main' }] } }
    runtimeConfigError = null
    vi.resetModules()
    const mod = await import('../../../src/core/onboarding/openclaw')
    openclawComponent = mod.openclawComponent
    OPENCLAW_INSTALL_URL = mod.OPENCLAW_INSTALL_URL
  })

  describe('check()', () => {
    it('reports missing when the runtime adapter cannot initialize', async () => {
      useExistingServices = false
      initError = new Error('adapter init failed')

      const result = await openclawComponent.check()
      expect(result.status).toBe('missing')
      expect(result.message).toContain('could not initialize')
      expect(result.remediation).toContain(OPENCLAW_INSTALL_URL)
    })

    it('reports missing when the runtime adapter is not reachable', async () => {
      runtimeAvailable = false

      const result = await openclawComponent.check()
      expect(result.status).toBe('missing')
      expect(result.message).toContain('not reachable')
    })

    it('reports broken when the runtime returns no agents', async () => {
      runtimeAgents = []
      runtimeConfig = { agents: { list: [] } }

      const result = await openclawComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('no agents')
    })

    it('reports broken when runtime config cannot be read', async () => {
      runtimeConfigError = new Error('bad json')

      const result = await openclawComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('could not be read')
    })

    it('reports ok for a reachable runtime with a main agent', async () => {
      const result = await openclawComponent.check()
      expect(result.status).toBe('ok')
      expect(result.message).toContain('runtime adapter is available')
      expect(result.details?.mainAgentId).toBe('main')
    })
  })

  describe('integrity check', () => {
    it("reports an error when no agent has id 'main'", async () => {
      runtimeAgents = [{ id: 'bob', name: 'Bob', status: 'active' }]
      runtimeConfig = { agents: { list: [{ id: 'bob', workspace: '/tmp/bob' }] } }

      const result = await openclawComponent.check()
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

      const result = await openclawComponent.check()
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

      const result = await openclawComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain("'a'")
      expect(result.message).toContain("'b'")
      expect(result.message).toContain('/x')
    })
  })

  describe('install()', () => {
    it('is a noop that returns the install URL message', async () => {
      const result = await openclawComponent.install({
        interactive: false,
        autoApprove: true,
        json: false,
        checkOnly: false,
        force: false,
      })
      expect(result.status).toBe('noop')
      expect(result.message).toContain(OPENCLAW_INSTALL_URL)
      expect(result.durationMs).toBe(0)
    })
  })
})
