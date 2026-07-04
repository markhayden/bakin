import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

let runtimeAgentIds: string[]
let runtimeConfig: Record<string, unknown>
let replaceCalls: Array<{ next: unknown; reason: string }>

function runtimeAgents() {
  return runtimeAgentIds.map((id) => ({ id, name: id, status: 'active' }))
}

function runtime() {
  return {
    agents: {
      list: async () => runtimeAgents(),
    },
    config: {
      get: async () => runtimeConfig,
      replace: async (next: unknown, reason: string) => {
        runtimeConfig = next as Record<string, unknown>
        replaceCalls.push({ next, reason })
      },
    },
  }
}

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../src/core/app-services', () => ({
  getAppServices: () => ({ runtime: runtime() }),
  maybeGetAppServices: () => ({ runtime: runtime() }),
  createAppServices: async () => ({ runtime: runtime() }),
}))

describe('OpenClaw native Bakin integration', () => {
  let syncOpenClawMcpConfig: typeof import('../../src/core/openclaw-integration').syncOpenClawMcpConfig
  let verifyOpenClawMcpConfig: typeof import('../../src/core/openclaw-integration').verifyOpenClawMcpConfig

  beforeEach(async () => {
    runtimeAgentIds = ['main', 'pixel', 'patch']
    runtimeConfig = {}
    replaceCalls = []
    vi.resetModules()
    const mod = await import('../../src/core/openclaw-integration')
    syncOpenClawMcpConfig = mod.syncOpenClawMcpConfig
    verifyOpenClawMcpConfig = mod.verifyOpenClawMcpConfig
  })

  afterEach(() => {
    runtimeConfig = {}
    replaceCalls = []
  })

  it('writes native OpenClaw mcp.servers entries for every runtime agent', async () => {
    runtimeConfig = {
      agents: { list: runtimeAgents() },
      mcp: { servers: { existing: { url: 'http://localhost:9999/mcp' } } },
    }

    const changes = await syncOpenClawMcpConfig(3737)

    expect(changes).toEqual([
      'added bakin-main',
      'added bakin-pixel',
      'added bakin-patch',
    ])
    expect(replaceCalls).toHaveLength(1)
    // Scope naming follows runtime-config-raw's house style (no 'bakin.' prefix)
    expect(replaceCalls[0].reason).toBe('onboarding.openclaw-mcp')

    expect((runtimeConfig.mcp as any).servers.existing.url).toBe('http://localhost:9999/mcp')
    expect((runtimeConfig.mcp as any).servers['bakin-main'].url).toBe('http://localhost:3737/mcp?agent=main')
    expect((runtimeConfig.mcp as any).servers['bakin-pixel'].url).toBe('http://localhost:3737/mcp?agent=pixel')
    expect((runtimeConfig.mcp as any).servers['bakin-patch'].url).toBe('http://localhost:3737/mcp?agent=patch')
  })

  it('updates changed ports and removes stale Bakin entries', async () => {
    runtimeConfig = {
      mcp: {
        servers: {
          'bakin-main': { url: 'http://localhost:3737/mcp?agent=main' },
          'bakin-old': { url: 'http://localhost:3737/mcp?agent=old' },
        },
      },
    }

    const changes = await syncOpenClawMcpConfig(4000)

    expect(changes).toContain('updated bakin-main')
    expect(changes).toContain('removed bakin-old (agent no longer in runtime config)')
    expect(replaceCalls).toHaveLength(1)

    expect((runtimeConfig.mcp as any).servers['bakin-main'].url).toBe('http://localhost:4000/mcp?agent=main')
    expect((runtimeConfig.mcp as any).servers['bakin-old']).toBeUndefined()
  })

  it('verifies native MCP entries without writing', async () => {
    runtimeConfig = {
      mcp: {
        servers: {
          'bakin-main': { url: 'http://localhost:3737/mcp?agent=main' },
          'bakin-stale': { url: 'http://localhost:3737/mcp?agent=stale' },
        },
      },
    }

    const status = await verifyOpenClawMcpConfig(3737)

    expect(status.agentEntries.find((entry) => entry.name === 'bakin-main')?.correct).toBe(true)
    expect(status.agentEntries.find((entry) => entry.name === 'bakin-pixel')?.correct).toBe(false)
    expect(status.staleEntries).toEqual(['bakin-stale'])
    expect(replaceCalls).toHaveLength(0)
  })

  it('does not write when native MCP entries are already current', async () => {
    runtimeConfig = {
      mcp: {
        servers: {
          'bakin-main': { url: 'http://localhost:3737/mcp?agent=main' },
          'bakin-pixel': { url: 'http://localhost:3737/mcp?agent=pixel' },
          'bakin-patch': { url: 'http://localhost:3737/mcp?agent=patch' },
        },
      },
    }

    const changes = await syncOpenClawMcpConfig(3737)

    expect(changes).toEqual([])
    expect(replaceCalls).toHaveLength(0)
  })
})
