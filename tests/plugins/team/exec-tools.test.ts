/**
 * Tests for team plugin agent lifecycle MCP exec tools.
 *
 * Covers the 4 new tools: create_agent, update_identity, delete_agent, set_permissions.
 * All OpenClaw-touching modules are stubbed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ---------------------------------------------------------------------------
// Temp directory
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-team-exec-${Date.now()}`)

// ---------------------------------------------------------------------------
// Mandatory mocks
// ---------------------------------------------------------------------------

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    agents: join(testDir, 'agents'),
    heartbeats: join(testDir, 'heartbeats'),
  }),
}))

vi.mock('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    agents: join(testDir, 'agents'),
    heartbeats: join(testDir, 'heartbeats'),
  }),
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../../src/core/watcher', () => ({
  registerSyncHook: vi.fn(),
  registerUnlinkHook: vi.fn(),
}))

vi.mock('../../../src/core/openclaw-client', () => ({
  sendMessage: vi.fn(async () => 'ok'),
  invokeTool: vi.fn(async () => ({ ok: true })),
  sendChannelMessage: vi.fn(async () => 'ok'),
  restartGateway: vi.fn(async () => {}),
  ping: vi.fn(async () => true),
  getAgentLastReply: vi.fn(() => null),
}))

vi.mock('../../../src/core/settings', () => ({
  getSettings: () => ({
    mainAgentId: 'main',
    antfly: { enabled: false, auditTtl: undefined },
  }),
  resetSettingsCache: vi.fn(),
}))

vi.mock('../../../src/core/main-agent', () => ({
  getMainAgentId: () => 'main',
}))

vi.mock('../../../src/core/mcporter', () => ({
  syncConfig: vi.fn(() => []),
}))

vi.mock('../../../src/core/agents', () => ({
  sendMessageToAgent: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../../../src/core/agent-usage', () => ({
  getAllAgentUsage: vi.fn(() => []),
}))

vi.mock('../../../src/lib/agents', () => ({
  startAgent: vi.fn(async () => {}),
  stopAgent: vi.fn(async () => {}),
}))

vi.mock('../../../src/lib/content', () => ({
  readHeartbeats: vi.fn(() => ({})),
}))

// Shared mutable roster
const { rosterAgents } = vi.hoisted(() => ({
  rosterAgents: {
    current: [
      { id: 'main', name: 'Main', emoji: '🤖', role: 'Orchestrator', headshot: '' },
      { id: 'basil', name: 'Basil', emoji: '🌿', role: 'Cook', headshot: '' },
      { id: 'pixel', name: 'Pixel', emoji: '🎨', role: 'Designer', headshot: '' },
    ] as Array<{ id: string; name: string; emoji: string; role: string; headshot: string }>,
  },
}))

const { adapterMocks } = vi.hoisted(() => ({
  adapterMocks: {
    addAgent: vi.fn(async (input: Record<string, unknown>) => ({ id: input.id, workspace: `/tmp/ws/${input.id}` })),
    removeAgent: vi.fn(async () => true),
    addToAllowLists: vi.fn(),
    removeFromAllowLists: vi.fn(),
    setSubagentPermissions: vi.fn(),
    updateAgentIdentity: vi.fn(async () => ['name', 'role']),
    getAgentIds: vi.fn(() => rosterAgents.current.map((a) => a.id)),
  },
}))

function makeAdapterMock() {
  return {
    listAgents: vi.fn(() => rosterAgents.current),
    getAgentIds: adapterMocks.getAgentIds,
    getAgentModel: vi.fn(() => 'claude-opus-4'),
    getAgentProfile: vi.fn((id: string) => ({
      id, name: id, emoji: '🤖', role: '', headshot: '',
      model: 'claude-opus-4', workspacePath: '/tmp/ws',
      soul: '', identity: null, rules: null, tools: null,
      heartbeatMd: null, subagentPerms: null,
    })),
    listWorkspaceFiles: vi.fn(() => []),
    readWorkspaceFile: vi.fn(() => null),
    writeWorkspaceFile: vi.fn(() => {}),
    listSkills: vi.fn(() => []),
    readSkillFile: vi.fn(() => null),
    listMemoryFiles: vi.fn(() => []),
    readMemoryFile: vi.fn(() => null),
    addAgent: adapterMocks.addAgent,
    removeAgent: adapterMocks.removeAgent,
    removeFromAllowLists: adapterMocks.removeFromAllowLists,
    addToAllowLists: adapterMocks.addToAllowLists,
    setSubagentPermissions: adapterMocks.setSubagentPermissions,
    updateAgentIdentity: adapterMocks.updateAgentIdentity,
    updateAgentField: vi.fn(),
    getOpenClawConfig: vi.fn(() => ({ agents: { list: [] } })),
    openclawExec: vi.fn(async () => '{}'),
    synthesizeIdentityMd: vi.fn(() => '# IDENTITY.md\n'),
  }
}

vi.mock('@bakin/team/lib/openclaw-adapter', () => makeAdapterMock())
vi.mock('../../../plugins/team/lib/openclaw-adapter', () => makeAdapterMock())

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { activatePlugin, findTool, callTool } from '../test-helpers'
import teamPlugin from '../../../plugins/team/index'
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
  Object.values(adapterMocks).forEach((m) => m.mockClear())
  rosterAgents.current = [
    { id: 'main', name: 'Main', emoji: '🤖', role: 'Orchestrator', headshot: '' },
    { id: 'basil', name: 'Basil', emoji: '🌿', role: 'Cook', headshot: '' },
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
      name: 'Jessica Fetcher',
      emoji: '🔎',
      role: 'Research Agent',
      vibe: 'Sharp, credible',
      primaryFunction: 'Multi-source research',
    })
    expect(result.ok).toBe(true)
    expect(result.id).toBe('jessica-fetcher')
    expect(result.instructions).toBeDefined()
    expect(adapterMocks.addAgent).toHaveBeenCalledWith(expect.objectContaining({
      id: 'jessica-fetcher',
      name: 'Jessica Fetcher',
      role: 'Research Agent',
    }))
  })

  it('derives ID from name when id not provided', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_create_agent')!
    const result = await callTool(tool, { name: 'Scout Runner' })
    expect(result.id).toBe('scout-runner')
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
    const result = await callTool(tool, { id: 'basil', name: 'Basil Clone' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/already exists/)
  })

  it('calls addToAllowLists with "main" by default', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_create_agent')!
    await callTool(tool, { name: 'New Agent' })
    expect(adapterMocks.addToAllowLists).toHaveBeenCalledWith('new-agent', 'main')
  })

  it('calls addToAllowLists with "all" when dispatchable="all"', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_create_agent')!
    await callTool(tool, { name: 'Public Agent', dispatchable: 'all' })
    expect(adapterMocks.addToAllowLists).toHaveBeenCalledWith('public-agent', 'all')
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

  it('calls updateAgentIdentity with provided fields', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_update_identity')!
    const result = await callTool(tool, {
      agentId: 'basil',
      name: 'Basil v2',
      role: 'Head Chef',
    })
    expect(result.ok).toBe(true)
    expect(result.updated).toEqual(['name', 'role'])
    expect(adapterMocks.updateAgentIdentity).toHaveBeenCalledWith('basil', expect.objectContaining({
      name: 'Basil v2',
      role: 'Head Chef',
    }))
  })

  it('returns error when agent not found', async () => {
    adapterMocks.updateAgentIdentity.mockRejectedValueOnce(new Error('Agent "ghost" not found in roster'))
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
    const result = await callTool(tool, { agentId: 'basil', confirm: true })
    expect(result.ok).toBe(true)
    expect(result.trashed).toBe(true)
    expect(adapterMocks.removeAgent).toHaveBeenCalledWith('basil')
    expect(adapterMocks.removeFromAllowLists).toHaveBeenCalledWith('basil')
  })

  it('rejects deletion without confirm=true', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_delete_agent')!
    const result = await callTool(tool, { agentId: 'basil', confirm: false })
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
    adapterMocks.removeAgent.mockResolvedValueOnce(false)
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
    const result = await callTool(tool, { agentId: 'main', allowAgents: ['basil', 'pixel'] })
    expect(result.ok).toBe(true)
    expect(adapterMocks.setSubagentPermissions).toHaveBeenCalledWith('main', ['basil', 'pixel'])
  })

  it('rejects unknown agent ID in source', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_set_permissions')!
    const result = await callTool(tool, { agentId: 'ghost', allowAgents: ['basil'] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/)
  })

  it('rejects unknown agent IDs in allowAgents', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_set_permissions')!
    const result = await callTool(tool, { agentId: 'main', allowAgents: ['basil', 'ghost'] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/ghost/)
  })

  it('rejects self-referencing dispatch', async () => {
    const tool = findTool(activated.execTools, 'bakin_exec_team_set_permissions')!
    const result = await callTool(tool, { agentId: 'main', allowAgents: ['main', 'basil'] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/itself/)
  })
})
