/**
 * Tests for the runtime onboarding component.
 *
 * The component does not probe provider paths directly. It asks the configured
 * runtime adapter for readiness and validates ROSTER integrity (P2.5: the raw
 * config surface is gone from the contract — the adapter resolves each
 * agent's effective workspace into metadata).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-runtime-onboarding-test-${Date.now()}`)
let useExistingServices = true
let initError: Error | null = null
let runtimeAvailable = true
let runtimeAgents: Array<{ id: string; name: string; role?: string; status: string; metadata?: Record<string, unknown> }> = []
let rosterError: Error | null = null

let provisionCalls = 0
const runtime = {
  name: 'test-runtime',
  version: 'test',
  requiredCoreVersion: '*',
  ping: async () => runtimeAvailable,
  provisionToolAccess: async () => {
    provisionCalls++
  },
  agents: {
    list: async () => {
      if (rosterError) throw rosterError
      return runtimeAgents
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
mock.module('../../../src/core/app-services-store', () => ({
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
    rosterError = null
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

    it('reports missing when the runtime adapter is cannot serve turns', async () => {
      runtimeAvailable = false

      const result = await runtimeComponent.check()
      expect(result.status).toBe('missing')
      expect(result.message).toContain('cannot serve turns')
    })

    it('reports broken with the emptyRoster marker when the runtime returns no agents', async () => {
      runtimeAgents = []

      const result = await runtimeComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('no agents')
      // The orchestrator keys first-run seeding on this marker — a check
      // stays read-only, onboarding provisions.
      expect(result.details?.emptyRoster).toBe(true)
    })

    it('integrity-broken rosters carry NO emptyRoster marker (never auto-provisioned)', async () => {
      runtimeAgents = [
        { id: 'a', name: 'A', status: 'active' },
        { id: 'a', name: 'A2', status: 'active' },
      ]
      const result = await runtimeComponent.check()
      expect(result.status).toBe('broken')
      expect(result.details?.emptyRoster).toBeUndefined()
    })

    it('reports broken when the roster cannot be read', async () => {
      rosterError = new Error('bad roster')

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
  })

  describe('integrity check', () => {
    it('reports an error when the roster declares no orchestrator', async () => {
      runtimeAgents = [{ id: 'bob', name: 'Bob', status: 'active', metadata: { workspacePath: '/tmp/bob' } }]

      const result = await runtimeComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('declares no orchestrator')
    })

    it("passes with a NON-'main' orchestrator declared by role (P2.6)", async () => {
      runtimeAgents = [
        { id: 'atlas', name: 'Atlas', role: 'orchestrator', status: 'active', metadata: { workspacePath: '/tmp/atlas' } },
        { id: 'pixel', name: 'Pixel', status: 'active', metadata: { workspacePath: '/tmp/pixel' } },
      ]

      const result = await runtimeComponent.check()
      expect(result.status).toBe('ok')
      expect(result.details?.mainAgentId).toBe('atlas')
    })

    it('reports an error when two agents share the same id', async () => {
      runtimeAgents = [
        { id: 'main', name: 'Main', status: 'active', metadata: { workspacePath: '/tmp/main-ws' } },
        { id: 'main', name: 'Main 2', status: 'active', metadata: { workspacePath: '/tmp/other-ws' } },
      ]

      const result = await runtimeComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('duplicate')
      expect(result.message).toContain("'main'")
    })

    it('reports an error when two agents collide on resolved workspace', async () => {
      runtimeAgents = [
        { id: 'a', name: 'A', status: 'active', metadata: { workspacePath: '/x' } },
        { id: 'b', name: 'B', status: 'active', metadata: { workspacePath: '/x' } },
        { id: 'main', name: 'Main', status: 'active', metadata: { workspacePath: '/y' } },
      ]

      const result = await runtimeComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain("'a'")
      expect(result.message).toContain("'b'")
      expect(result.message).toContain('/x')
    })

    it('skips agents without a resolved workspace rather than treating them as collisions', async () => {
      runtimeAgents = [
        { id: 'main', name: 'Main', role: 'Orchestrator', status: 'active' },
        { id: 'pixel', name: 'Pixel', status: 'active' },
      ]

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

describe('provisionRuntimeForOnboarding', () => {
  it('provisions the active runtime (adapter-owned first-run seeding)', async () => {
    const mod = await import('@/core/onboarding/runtime')
    const before = (globalThis as Record<string, unknown>).__unused // noop
    void before
    const calls = provisionCalls
    await mod.provisionRuntimeForOnboarding()
    expect(provisionCalls).toBe(calls + 1)
  })
})
