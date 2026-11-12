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
let pingCalls = 0
/** How the runtime's agents reach Bakin's tools; decides how reachability is judged. */
let toolAccessStyle: 'mcp' | 'in-process' = 'mcp'
/** What provisioning does to the roster (adapter-owned). */
let onProvision: () => void = () => {}
let provisionError: Error | null = null
const runtime = {
  name: 'test-runtime',
  version: 'test',
  requiredCoreVersion: '*',
  describeToolAccess: () => ({ style: toolAccessStyle }),
  ping: async () => {
    pingCalls++
    return runtimeAvailable
  },
  provisionToolAccess: async () => {
    provisionCalls++
    if (provisionError) throw provisionError
    onProvision()
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

  beforeEach(async () => {
    useExistingServices = true
    initError = null
    runtimeAvailable = true
    runtimeAgents = [{ id: 'main', name: 'Main', role: 'Orchestrator', status: 'active' }]
    rosterError = null
    toolAccessStyle = 'mcp'
    onProvision = () => {}
    provisionError = null
    provisionCalls = 0
    pingCalls = 0
    vi.resetModules()
    const mod = await import('@/core/onboarding/runtime')
    runtimeComponent = mod.runtimeComponent
  })

  describe('check()', () => {
    it('cannot initialize: an error the operator has to fix', async () => {
      useExistingServices = false
      initError = new Error('adapter init failed')

      const result = await runtimeComponent.check()
      expect(result.status).toBe('error')
      expect(result.message).toContain('could not initialize')
      expect(result.remediation).toContain('Setup guide: https://')
    })

    it('a runtime that has to answer and does not is an error', async () => {
      runtimeAvailable = false

      const result = await runtimeComponent.check()
      expect(result.status).toBe('error')
      expect(result.message).toContain('cannot be reached')
      expect(pingCalls).toBe(1)
    })

    it('an in-process runtime is reachable once it initializes: it is never pinged', async () => {
      // Pi's ping() also requires a login. Whether anyone is logged in is
      // the llm component's question, not this one's.
      toolAccessStyle = 'in-process'
      runtimeAvailable = false

      const result = await runtimeComponent.check()
      expect(result.status).toBe('ok')
      expect(pingCalls).toBe(0)
    })

    it('no agents yet is missing with the emptyRoster marker: the one thing the install sets up', async () => {
      runtimeAgents = []

      const result = await runtimeComponent.check()
      expect(result.status).toBe('missing')
      expect(result.message).toContain('no agents')
      expect(result.details?.emptyRoster).toBe(true)
      // The check itself never provisions.
      expect(provisionCalls).toBe(0)
    })

    it('an inconsistent roster is an error and carries NO emptyRoster marker (never provisioned over)', async () => {
      runtimeAgents = [
        { id: 'a', name: 'A', status: 'active' },
        { id: 'a', name: 'A2', status: 'active' },
      ]
      const result = await runtimeComponent.check()
      expect(result.status).toBe('error')
      expect(result.details?.emptyRoster).toBeUndefined()
    })

    it('a roster that cannot be read is an error', async () => {
      rosterError = new Error('bad roster')

      const result = await runtimeComponent.check()
      expect(result.status).toBe('error')
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
      expect(result.status).toBe('error')
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
      expect(result.status).toBe('error')
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
      expect(result.status).toBe('error')
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
    const noopOp = () => ({ stage() {}, skip() {}, item() {}, progress() {}, note() {}, throwIfCancelled() {} }) as unknown as Parameters<typeof runtimeComponent.install>[1]
    const OPTIONS = { autoApprove: false, allowServiceClaim: false }

    it('declares its plan and owns install-state: provisioning writes runtime state', () => {
      expect(runtimeComponent.plan.stages.map((stage) => stage.id)).toEqual(['provision'])
      expect(runtimeComponent.resources).toEqual(['install-state'])
      expect(runtimeComponent.failureCode).toBe('runtime_not_ready')
    })

    it('an empty roster is provisioned, validated again, and reported installed', async () => {
      runtimeAgents = []
      onProvision = () => { runtimeAgents = [{ id: 'main', name: 'Main', role: 'Orchestrator', status: 'active' }] }

      const result = await runtimeComponent.install(OPTIONS, noopOp())
      expect(provisionCalls).toBe(1)
      expect(result.status).toBe('installed')
      expect((await runtimeComponent.check()).status).toBe('ok')
    })

    it('a roster still empty after provisioning fails: this runtime creates no agents, the operator has to', async () => {
      runtimeAgents = []

      const result = await runtimeComponent.install(OPTIONS, noopOp())
      expect(provisionCalls).toBe(1)
      expect(result.status).toBe('failed')
      expect(result.message).toContain('still has no agents')
    })

    it('a roster that fails integrity after provisioning fails with what the check found', async () => {
      runtimeAgents = []
      onProvision = () => { runtimeAgents = [{ id: 'bob', name: 'Bob', status: 'active' }] }

      const result = await runtimeComponent.install(OPTIONS, noopOp())
      expect(result.status).toBe('failed')
      expect(result.message).toContain('declares no orchestrator')
    })

    it('never provisions over anything but an empty roster', async () => {
      for (const arrange of [
        () => { runtimeAvailable = false },
        () => { runtimeAgents = [{ id: 'a', name: 'A', status: 'active' }, { id: 'a', name: 'A2', status: 'active' }] },
        () => { rosterError = new Error('bad roster') },
      ]) {
        runtimeAvailable = true
        rosterError = null
        runtimeAgents = [{ id: 'main', name: 'Main', role: 'Orchestrator', status: 'active' }]
        arrange()
        const result = await runtimeComponent.install(OPTIONS, noopOp())
        expect(result.status).toBe('failed')
      }
      expect(provisionCalls).toBe(0)
    })

    it('an already provisioned runtime is a noop', async () => {
      const result = await runtimeComponent.install(OPTIONS, noopOp())
      expect(result.status).toBe('noop')
      expect(provisionCalls).toBe(0)
    })

    it('a provisioning failure is reported, not thrown', async () => {
      runtimeAgents = []
      provisionError = new Error('registry not writable')

      const result = await runtimeComponent.install(OPTIONS, noopOp())
      expect(result.status).toBe('failed')
      expect(result.message).toContain('registry not writable')
    })
  })
})
