import { beforeEach, describe, expect, it, mock } from 'bun:test'

type AgentState = 'absent' | 'unmanaged' | 'adopted' | 'managed'

let states: Record<string, AgentState>
const installCalls: Array<{ source: string; installAs?: string; adopt?: boolean }> = []

mock.module('../../../packages/core/src/agent-packages/lockfile', () => ({
  readLockfile: () => ({ version: 1, packages: {} }),
}))

mock.module('../../../src/core/agent-packages/agent-state', () => ({
  getAgentState: async (agentId: string) => ({ agentId, state: states[agentId] ?? 'absent' }),
}))

mock.module('../../../src/core/agent-packages/installer', () => ({
  installPackage: async (opts: { source: string; installAs?: string; adopt?: boolean }) => {
    installCalls.push(opts)
    return {
      packageId: opts.installAs ?? 'unknown',
      kind: 'agent',
      createdAgent: opts.adopt !== true,
      adopted: opts.adopt === true,
      dependencies: [],
      skipped: [],
    }
  },
}))

describe('recommended agents onboarding component', () => {
  let recommendedAgentsComponent: typeof import('../../../src/core/onboarding/recommended-agents').recommendedAgentsComponent

  beforeEach(async () => {
    states = {}
    installCalls.length = 0
    vi.resetModules()
    const mod = await import('../../../src/core/onboarding/recommended-agents')
    recommendedAgentsComponent = mod.recommendedAgentsComponent
  })

  it('surfaces unmanaged official agents as adoptable selections', async () => {
    states.pixel = 'unmanaged'

    const result = await recommendedAgentsComponent.check()

    expect(result.status).toBe('missing')
    expect(result.details?.missing).toContain('pixel')
    expect(result.details?.adoptable).toEqual(['pixel'])
    const pixel = (result.details?.available as Array<{ id: string; state: string }>).find(agent => agent.id === 'pixel')
    expect(pixel?.state).toBe('unmanaged')
  })

  it('passes adopt when installing a selected unmanaged official agent', async () => {
    states.pixel = 'unmanaged'

    const result = await recommendedAgentsComponent.install({
      interactive: false,
      autoApprove: false,
      json: false,
      checkOnly: false,
      force: false,
      selectedRecommendedAgentIds: ['pixel'],
    })

    expect(result.status).toBe('installed')
    expect(result.message).toContain('adopted pixel')
    expect(installCalls).toEqual([{
      source: 'github:markhayden/bakin-bits-official#agents/pixel',
      installAs: 'pixel',
      adopt: true,
    }])
  })
})
