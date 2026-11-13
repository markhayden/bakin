import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { installInOperation } from '../../helpers/operation-harness'

// Installs run inside a local operation (#895): its lock file and audit land
// under the content dir, so it must be a temp dir.
const testDir = join(tmpdir(), `bakin-test-rec-agents-${Date.now()}`)
const contentDir = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDir)
mock.module('../../../packages/core/src/content-dir', contentDir)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

type AgentState = 'absent' | 'unmanaged' | 'adopted' | 'managed'

let states: Record<string, AgentState>
const installCalls: Array<{ source: string; installAs?: string; adopt?: boolean }> = []

mock.module('../../../packages/core/src/agent-packages/lockfile', () => ({
  readLockfile: () => ({ version: 1, packages: {} }),
}))

mock.module('../../../src/core/agent-packages/agent-state', () => ({
  getAgentState: async (agentId: string) => ({ agentId, state: states[agentId] ?? 'absent' }),
}))

/** Agents whose package model this home cannot run: the installer left it off. */
let modelFallbacks: Record<string, { declared: string; reason: string }> = {}
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
      ...(modelFallbacks[opts.installAs ?? ''] ? { modelFallback: modelFallbacks[opts.installAs ?? ''] } : {}),
    }
  },
}))

describe('recommended agents onboarding component', () => {
  let recommendedAgentsComponent: typeof import('../../../src/core/onboarding/recommended-agents').recommendedAgentsComponent

  beforeEach(async () => {
    states = {}
    installCalls.length = 0
    modelFallbacks = {}
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

    const result = await installInOperation(recommendedAgentsComponent, {
      autoApprove: false,
      allowServiceClaim: false,
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

  it('says which agent runs on the home default because its own model cannot run here (#1055)', async () => {
    modelFallbacks = { enrich: { declared: 'openai/gpt-5.4-mini', reason: 'no credentials for openai' } }

    const result = await installInOperation(recommendedAgentsComponent, {
      autoApprove: false,
      allowServiceClaim: false,
      selectedRecommendedAgentIds: ['pixel', 'enrich'],
    })

    expect(result.status).toBe('installed')
    expect(result.message).toBe("Installed official agent packages: installed pixel, enrich. enrich uses this home's default model (its own, openai/gpt-5.4-mini, cannot run here: no credentials for openai).")
  })

  it('says nothing about models when every package model can run', async () => {
    const result = await installInOperation(recommendedAgentsComponent, {
      autoApprove: false,
      allowServiceClaim: false,
      selectedRecommendedAgentIds: ['enrich'],
    })

    expect(result.message).toBe('Installed official agent package: installed enrich')
  })
})
