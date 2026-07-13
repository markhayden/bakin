/**
 * Tests for team plugin agent lifecycle MCP exec tools.
 *
 * Covers the 4 new tools: create_agent, update_identity, delete_agent, set_permissions.
 * All runtime-facing modules are stubbed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ---------------------------------------------------------------------------
// Temp directory
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-team-exec-${Date.now()}`)

// ES imports are hoisted above mock.module — set env so the guards do not trip.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + "-openclaw"

// ---------------------------------------------------------------------------
// Mandatory mocks
// ---------------------------------------------------------------------------

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    agents: join(testDir, 'agents'),
    heartbeats: join(testDir, 'heartbeats'),
  }),
}))

mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    agents: join(testDir, 'agents'),
    heartbeats: join(testDir, 'heartbeats'),
  }),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../../src/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))

mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    mainAgentId: 'main',
    search: { adapter: 'antfly', settings: { enabled: false, auditTtl: undefined } },
  }),
  resetSettingsCache: mock(),
}))

mock.module('../../../packages/adapter-openclaw/src/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/agents', () => ({
  sendMessageToAgent: mock(async () => ({ ok: true })),
}))

mock.module('../../../src/core/agent-usage', () => ({
  getAllAgentUsage: mock(() => []),
}))

mock.module('../../../src/lib/agents', () => ({
  startAgent: mock(async () => {}),
  stopAgent: mock(async () => {}),
}))

mock.module('../../../src/lib/content-files', () => ({
  readHeartbeats: mock(() => ({})),
}))

// Shared mutable roster
const { rosterAgents } = (() => ({
  rosterAgents: {
    current: [
      { id: 'main', name: 'Main', emoji: '🤖', role: 'Orchestrator', headshot: '' },
      { id: 'chef', name: 'Chef', emoji: '🌿', role: 'Cook', headshot: '' },
      { id: 'pixel', name: 'Pixel', emoji: '🎨', role: 'Designer', headshot: '' },
    ] as Array<{ id: string; name: string; emoji: string; role: string; headshot: string }>,
  },
}))()

const { runtimeMocks } = (() => ({
  runtimeMocks: {
    create: mock(async (input: Record<string, unknown>) => ({
      id: input.id,
      name: input.name,
      role: input.role,
      model: input.model,
      status: 'active',
      metadata: { ...(input.metadata as Record<string, unknown> | undefined), workspacePath: `/tmp/ws/${input.id}` },
    })),
    remove: mock(async () => {}),
    update: mock(async (agentId: string, input: Record<string, unknown>) => ({
      id: agentId,
      name: input.name ?? agentId,
      role: input.role,
      status: 'active',
      metadata: input.metadata,
    })),
    updateAllowlist: mock(async () => {}),
    readWorkspaceFile: mock(async (): Promise<{ path: string; content: string; updatedAt?: string } | null> => null),
    writeWorkspaceFile: mock(async () => {}),
  },
}))()

function makeRuntimeMock() {
  return {
    name: 'test-runtime',
    version: '0.0.0',
    requiredCoreVersion: '*',
    initialize: async () => {},
    shutdown: async () => {},
    ping: async () => true,
    restart: async () => {},
    agents: {
      list: async () => rosterAgents.current.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status: 'active',
        metadata: { emoji: agent.emoji, workspacePath: `/tmp/ws/${agent.id}`, subagentAllowAgents: null },
      })),
      get: async (agentId: string) => {
        const agent = rosterAgents.current.find((entry) => entry.id === agentId)
        return agent ? {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          status: 'active',
          metadata: { emoji: agent.emoji, workspacePath: `/tmp/ws/${agent.id}`, subagentAllowAgents: null },
        } : null
      },
      create: runtimeMocks.create,
      update: runtimeMocks.update,
      remove: runtimeMocks.remove,
      listWorkspaceFiles: async () => [],
      readWorkspaceFile: runtimeMocks.readWorkspaceFile,
      writeWorkspaceFile: runtimeMocks.writeWorkspaceFile,
      updateAllowlist: runtimeMocks.updateAllowlist,
    },
    messaging: { send: async () => ({ id: 'msg-1' }), stream: async function* () {} },
    tools: { invoke: async () => ({ ok: true }) },
    channels: {
      list: async () => [],
      sendNotification: async () => ({ deliveries: [] }),
      sendMessage: async () => ({ deliveries: [] }),
      deliverContent: async () => ({ deliveries: [] }),
      createApproval: async () => ({ deliveries: [] }),
      editApproval: async (args: { deliveries: unknown[] }) => ({ deliveries: args.deliveries }),
      cancelApproval: async () => {},
      resolveApproval: async () => {},
      subscribeApprovalResponses: () => () => {},
    },
    skills: { list: async () => [], get: async () => null, write: async () => {}, remove: async () => {} },
    sessions: { list: async () => [], get: async () => null },
    memory: { listTiers: async () => [], listEntries: async () => [], getEntry: async () => null },
    cron: {
      list: async () => [],
      get: async () => null,
      create: async (input: Record<string, unknown>) => ({ id: input.id ?? 'cron-1', ...input }),
      update: async (id: string, patch: Record<string, unknown>) => ({ id, ...patch }),
      remove: async () => {},
      runNow: async (jobId: string) => ({ id: 'run-1', jobId, status: 'succeeded' }),
      listRuns: async () => [],
    },
    config: {
      get: async () => ({ agents: { defaults: { model: { primary: 'claude-opus-4' } } } }),
      update: async () => {},
      raw: async () => undefined,
    },
  }
}

mock.module('@bakin/core/adapters/runtime/testing', () => ({
  createMockRuntimeAdapter: () => makeRuntimeMock(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { activatePlugin, findTool, callTool } from '../test-helpers'
const teamPlugin = (await import('../../../plugins/team/index')).default as typeof import('../../../plugins/team/index').default
import type { ActivatedPlugin } from '../test-helpers'

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let activated: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  mkdirSync(join(testDir, 'plugin-settings'), { recursive: true })
  writeFileSync(join(testDir, 'plugin-settings', 'team.json'), JSON.stringify({ displaySettings: {}, teams: [] }))
  activated = await activatePlugin(teamPlugin, testDir)
})

beforeEach(() => {
  Object.values(runtimeMocks).forEach((m) => m.mockClear())
  rosterAgents.current = [
    { id: 'main', name: 'Main', emoji: '🤖', role: 'Orchestrator', headshot: '' },
    { id: 'chef', name: 'Chef', emoji: '🌿', role: 'Cook', headshot: '' },
    { id: 'pixel', name: 'Pixel', emoji: '🎨', role: 'Designer', headshot: '' },
  ]
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// bakin_exec_team_create_agent
// ---------------------------------------------------------------------------

describe('bakin_exec_team_create_agent', () => {
  it('is registered', () => {
    expect(findTool(activated.execTools, 'bakin_exec_team_create_agent')).toBeDefined()
  })

  it('creates an agent with all fields', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_create_agent')!
    const result = await callTool(tool, {
      name: 'Jessica',
      emoji: '🔎',
      role: 'Research Agent',
      vibe: 'Sharp, credible',
      primaryFunction: 'Multi-source research',
    })
    expect(result.ok).toBe(true)
    expect(result.id).toBe('jessica')
    expect(result.instructions).toBeDefined()
    expect(runtimeMocks.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'jessica',
      name: 'Jessica',
      role: 'Research Agent',
      metadata: expect.objectContaining({
        primaryFunction: 'Multi-source research',
      }),
    }))
  })

  it('derives ID from name when id not provided', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_create_agent')!
    const result = await callTool(tool, { name: 'Explorer Runner' })
    expect(result.id).toBe('explorer-runner')
  })

  it('uses explicit id when provided', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_create_agent')!
    const result = await callTool(tool, { id: 'custom-id', name: 'Custom Agent' })
    expect(result.id).toBe('custom-id')
  })

  it('rejects "main" as agent ID', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_create_agent')!
    const result = await callTool(tool, { id: 'main', name: 'Main Clone' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/main/)
  })

  it('rejects duplicate agent ID', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_create_agent')!
    const result = await callTool(tool, { id: 'chef', name: 'Chef Clone' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/already exists/)
  })

  it('adds the new agent to main allowlist by default', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_create_agent')!
    await callTool(tool, { name: 'New Agent' })
    expect(runtimeMocks.updateAllowlist).toHaveBeenCalledWith('main', { add: ['new-agent'] })
  })

  it('adds the new agent to all allowlists when dispatchable="all"', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_create_agent')!
    await callTool(tool, { name: 'Public Agent', dispatchable: 'all' })
    expect(runtimeMocks.updateAllowlist).toHaveBeenCalledWith('main', { add: ['public-agent'] })
    expect(runtimeMocks.updateAllowlist).toHaveBeenCalledWith('chef', { add: ['public-agent'] })
    expect(runtimeMocks.updateAllowlist).toHaveBeenCalledWith('pixel', { add: ['public-agent'] })
  })

  it('writes teamId to display settings', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_create_agent')!
    await callTool(tool, { name: 'Team Agent', teamId: 'builders' })
    const saved = JSON.parse(readFileSync(join(testDir, 'plugin-settings', 'team.json'), 'utf-8'))
    expect(saved.displaySettings['team-agent']?.teamId).toBe('builders')
  })
})

// ---------------------------------------------------------------------------
// bakin_exec_team_update_identity
// ---------------------------------------------------------------------------

describe('bakin_exec_team_update_identity', () => {
  it('is registered', () => {
    expect(findTool(activated.execTools, 'bakin_exec_team_update_identity')).toBeDefined()
  })

  it('updates identity with provided fields through the runtime adapter', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_update_identity')!
    const result = await callTool(tool, {
      agentId: 'chef',
      name: 'Chef v2',
      role: 'Head Chef',
    })
    expect(result.ok).toBe(true)
    expect(result.updated).toEqual(['name', 'role'])
    expect(runtimeMocks.update).toHaveBeenCalledWith('chef', expect.objectContaining({
      name: 'Chef v2',
      role: 'Head Chef',
    }))
  })

  it('returns error when agent not found', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_update_identity')!
    await expect(callTool(tool, { agentId: 'ghost', name: 'Ghost' })).rejects.toThrow(/not found/)
  })
})

// ---------------------------------------------------------------------------
// bakin_exec_team_delete_agent
// ---------------------------------------------------------------------------

describe('bakin_exec_team_delete_agent', () => {
  it('is registered', () => {
    expect(findTool(activated.execTools, 'bakin_exec_team_delete_agent')).toBeDefined()
  })

  it('deletes an agent with confirm=true', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_delete_agent')!
    const result = await callTool(tool, { agentId: 'chef', confirm: true })
    expect(result.ok).toBe(true)
    expect(result.trashed).toBe(true)
    expect(runtimeMocks.remove).toHaveBeenCalledWith('chef')
    expect(runtimeMocks.updateAllowlist).toHaveBeenCalledWith('main', { remove: ['chef'] })
  })

  it('rejects deletion without confirm=true', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_delete_agent')!
    const result = await callTool(tool, { agentId: 'chef', confirm: false })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/confirm/)
  })

  it('rejects deletion of main agent', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_delete_agent')!
    const result = await callTool(tool, { agentId: 'main', confirm: true })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/main/)
  })

  it('returns error when agent not found', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_delete_agent')!
    const result = await callTool(tool, { agentId: 'ghost', confirm: true })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/)
  })
})

// ---------------------------------------------------------------------------
// bakin_exec_team_set_permissions
// ---------------------------------------------------------------------------

describe('bakin_exec_team_set_permissions', () => {
  it('is registered', () => {
    expect(findTool(activated.execTools, 'bakin_exec_team_set_permissions')).toBeDefined()
  })

  it('sets permissions for valid agent and targets', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_set_permissions')!
    const result = await callTool(tool, { agentId: 'main', allowAgents: ['chef', 'pixel'] })
    expect(result.ok).toBe(true)
    expect(runtimeMocks.updateAllowlist).toHaveBeenCalledWith('main', { replace: ['chef', 'pixel'] })
  })

  it('rejects unknown agent ID in source', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_set_permissions')!
    const result = await callTool(tool, { agentId: 'ghost', allowAgents: ['chef'] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/)
  })

  it('rejects unknown agent IDs in allowAgents', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_set_permissions')!
    const result = await callTool(tool, { agentId: 'main', allowAgents: ['chef', 'ghost'] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/ghost/)
  })

  it('rejects self-referencing dispatch', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_set_permissions')!
    const result = await callTool(tool, { agentId: 'main', allowAgents: ['main', 'chef'] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/itself/)
  })
})
