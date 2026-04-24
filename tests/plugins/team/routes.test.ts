/**
 * Tests for team plugin routes and search content type registration.
 *
 * First test suite for the team plugin (was zero coverage). Scope is
 * intentionally narrow: smoke-test plugin activation, validate that the
 * /search route is auto-registered via the test helpers (per C16 wiring),
 * and verify a representative non-search route is registered.
 *
 * The team plugin is an adapter over OpenClaw; all OpenClaw-touching
 * modules are stubbed so the test never reads from ~/.openclaw/.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ---------------------------------------------------------------------------
// Temp directory
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-team-routes-${Date.now()}`)

// ES imports are hoisted above mock.module — set env so the guards do not trip.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + "-openclaw"

// ---------------------------------------------------------------------------
// Mandatory mocks — declared before any plugin import
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

const { logWarn, logInfo, logError, logDebug } = (() => ({
  logWarn: mock(),
  logInfo: mock(),
  logError: mock(),
  logDebug: mock(),
}))()

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: logInfo,
    warn: logWarn,
    error: logError,
    debug: logDebug,
  }),
}))

mock.module('../../../src/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))

// OpenClaw HTTP client — no real gateway calls
mock.module('../../../src/core/openclaw-client', () => ({
  sendMessage: mock(async () => 'ok'),
  invokeTool: mock(async () => ({ ok: true })),
  sendChannelMessage: mock(async () => 'ok'),
  restartGateway: mock(async () => {}),
  ping: mock(async () => true),
  getAgentLastReply: mock(() => null),
}))

// Settings — return a fully-shaped stub
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    mainAgentId: 'main',
    antfly: { enabled: false, auditTtl: undefined },
  }),
  resetSettingsCache: mock(),
}))

mock.module('../../../src/core/main-agent', () => ({
  getMainAgentId: () => 'main',
}))

// mcporter — would otherwise spawn child processes
mock.module('../../../src/core/mcporter', () => ({
  syncConfig: mock(() => []),
}))

// agents — sendMessageToAgent is the only thing imported by team
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

mock.module('../../../src/lib/content', () => ({
  readHeartbeats: mock(() => ({})),
}))

// Shared mutable roster so individual tests can simulate missing agents
// without redefining the full adapter mock.
const { rosterAgents } = (() => ({
  rosterAgents: {
    current: [
      { id: 'main', name: 'Main', emoji: '🤖', role: 'Orchestrator', headshot: '' },
      { id: 'chef', name: 'Chef', emoji: '🌿', role: 'Cook', headshot: '' },
    ] as Array<{ id: string; name: string; emoji: string; role: string; headshot: string }>,
  },
}))()

// OpenClaw adapter — fully stubbed, never touches ~/.openclaw/
mock.module('@bakin/team/lib/openclaw-adapter', () => ({
  listAgents: mock(() => rosterAgents.current),
  getAgentIds: mock(() => rosterAgents.current.map((a) => a.id)),
  getAgentModel: mock(() => 'claude-opus-4'),
  getAgentProfile: mock((id: string) => ({
    id,
    name: id,
    emoji: '🤖',
    role: '',
    headshot: '',
    model: 'claude-opus-4',
    workspacePath: '/tmp/ws',
    soul: 'sample soul text',
    identity: null,
    rules: null,
    tools: null,
    heartbeatMd: null,
    subagentPerms: null,
  })),
  listWorkspaceFiles: mock(() => []),
  readWorkspaceFile: mock(() => null),
  writeWorkspaceFile: mock(() => {}),
  listSkills: mock(() => []),
  readSkillFile: mock(() => null),
  listMemoryFiles: mock(() => []),
  readMemoryFile: mock(() => null),
  addAgent: mock(async (input: Record<string, unknown>) => ({ id: input.id, workspace: `/tmp/ws/${input.id}` })),
  removeAgent: mock(async () => true),
  removeFromAllowLists: mock(),
  updateAgentField: mock(),
  getOpenClawConfig: mock(() => ({ agents: { list: [] } })),
  openclawExec: mock(async () => '{}'),
  synthesizeIdentityMd: mock(() => '# IDENTITY.md\n'),
  addToAllowLists: mock(),
  setSubagentPermissions: mock(),
  updateAgentIdentity: mock(async () => ['name', 'role']),
}))

// The team plugin's relative import path inside the plugin uses './lib/openclaw-adapter'.
// Add a relative-path alias so vi.mock catches both shapes.
mock.module('../../../plugins/team/lib/openclaw-adapter', () => ({
  listAgents: mock(() => rosterAgents.current),
  getAgentIds: mock(() => rosterAgents.current.map((a) => a.id)),
  getAgentModel: mock(() => 'claude-opus-4'),
  getAgentProfile: mock((id: string) => ({
    id,
    name: id,
    emoji: '🤖',
    role: '',
    headshot: '',
    model: 'claude-opus-4',
    workspacePath: '/tmp/ws',
    soul: 'sample soul text',
    identity: null,
    rules: null,
    tools: null,
    heartbeatMd: null,
    subagentPerms: null,
  })),
  listWorkspaceFiles: mock(() => []),
  readWorkspaceFile: mock(() => null),
  writeWorkspaceFile: mock(() => {}),
  listSkills: mock(() => []),
  readSkillFile: mock(() => null),
  listMemoryFiles: mock(() => []),
  readMemoryFile: mock(() => null),
  addAgent: mock(async (input: Record<string, unknown>) => ({ id: input.id, workspace: `/tmp/ws/${input.id}` })),
  removeAgent: mock(async () => true),
  removeFromAllowLists: mock(),
  updateAgentField: mock(),
  getOpenClawConfig: mock(() => ({ agents: { list: [] } })),
  openclawExec: mock(async () => '{}'),
  synthesizeIdentityMd: mock(() => '# IDENTITY.md\n'),
  addToAllowLists: mock(),
  setSubagentPermissions: mock(),
  updateAgentIdentity: mock(async () => ['name', 'role']),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { activatePlugin, findRoute, callSearchRoute, callRoute } from '../test-helpers'
// Dynamic require — ES imports are hoisted above top-level env setup above.
const teamPlugin = require('../../../plugins/team/index').default as typeof import('../../../plugins/team/index').default
import type { ActivatedPlugin } from '../test-helpers'

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('team plugin — activation', () => {
  it('activates without error', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    expect(activated.routes.length).toBeGreaterThan(0)
    expect(activated.execTools.length).toBeGreaterThan(0)
  })

  it('registers the team search content type', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    expect(activated.ctx.search.registerContentType).toHaveBeenCalled()
    const call = (activated.ctx.search.registerContentType as ReturnType<typeof mock>).mock.calls[0]?.[0]
    expect(call?.table).toBe('team')
  })
})

describe('team plugin — /search route (auto-registered)', () => {
  let activated: ActivatedPlugin

  beforeAll(async () => {
    activated = await activatePlugin(teamPlugin, testDir)
  })

  it('auto-registers GET /search via the test helper', () => {
    const route = findRoute(activated.routes, 'GET', '/search')
    expect(route).toBeDefined()
  })

  it('returns seeded results for a query', async () => {
    activated.seedResults([
      {
        id: 'main-operator',
        table: 'bakin_team',
        score: 1,
        fields: { name: 'Main Operator', soul: 'curious tinkerer' },
      },
    ])

    const { status, body } = await callSearchRoute(activated, 'main-operator')
    expect(status).toBe(200)
    const results = (body as { results?: unknown[] }).results
    expect(Array.isArray(results)).toBe(true)
    expect(results).toHaveLength(1)
    expect((results![0] as { id: string }).id).toBe('main-operator')
  })

  it('returns 400 when q is missing', async () => {
    const route = findRoute(activated.routes, 'GET', '/search')!
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: {} })
    expect(status).toBe(400)
    expect((body as { error?: string }).error).toMatch(/Missing/)
  })
})

describe('team plugin — non-search routes', () => {
  it('registers GET / for listing agents', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    const route = findRoute(activated.routes, 'GET', '/')
    expect(route).toBeDefined()
    expect(route?.description).toMatch(/agent/i)
  })
})

// ---------------------------------------------------------------------------
// team.json reportsTo normalization & graceful degradation
// ---------------------------------------------------------------------------

describe('team plugin — reportsTo normalization on write', () => {
  const teamJsonPath = join(testDir, 'plugin-settings', 'team.json')

  /**
   * Write the raw team.json (bypassing the plugin) so tests can seed
   * legacy values without going through the normalized POST path.
   */
  function seedTeamJson(teams: unknown[]): void {
    mkdirSync(join(testDir, 'plugin-settings'), { recursive: true })
    writeFileSync(
      teamJsonPath,
      JSON.stringify({ displaySettings: {}, teams }, null, 2),
    )
  }

  function readTeamJson(): { teams: Array<Record<string, unknown>> } {
    const raw = JSON.parse(readFileSync(teamJsonPath, 'utf-8')) as {
      teams: Array<Record<string, unknown>>
    }
    return raw
  }

  beforeEach(() => {
    if (existsSync(teamJsonPath)) {
      rmSync(teamJsonPath, { force: true })
    }
    logWarn.mockClear()
    // Reset roster to default for each test
    rosterAgents.current = [
      { id: 'main', name: 'Main', emoji: '🤖', role: 'Orchestrator', headshot: '' },
      { id: 'chef', name: 'Chef', emoji: '🌿', role: 'Cook', headshot: '' },
    ]
  })

  it('write with reportsTo="main" stores null in team.json', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    const route = findRoute(activated.routes, 'POST', '/teams')!
    const { status } = await callRoute(route, activated.ctx, {
      body: { id: 'builders', label: 'Builders', reportsTo: 'main' },
    })
    expect(status).toBe(200)
    const file = readTeamJson()
    const team = file.teams.find((t) => t.id === 'builders')!
    expect(team.reportsTo).toBeNull()
  })

  it('write with reportsTo undefined stores null in team.json', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    const route = findRoute(activated.routes, 'POST', '/teams')!
    const { status } = await callRoute(route, activated.ctx, {
      body: { id: 'creators', label: 'Creators' },
    })
    expect(status).toBe(200)
    const file = readTeamJson()
    const team = file.teams.find((t) => t.id === 'creators')!
    expect(team.reportsTo).toBeNull()
  })

  it('write with unknown non-null reportsTo preserves the value (chef not in roster)', async () => {
    // "chef" is technically in the roster above, but we want to prove the
    // write path does not validate against the roster — it only normalizes
    // the "this is the main agent" case. Point at a clearly-unknown id.
    const activated = await activatePlugin(teamPlugin, testDir)
    const route = findRoute(activated.routes, 'POST', '/teams')!
    const { status } = await callRoute(route, activated.ctx, {
      body: { id: 'explorers', label: 'Explorers', reportsTo: 'ghost' },
    })
    expect(status).toBe(200)
    const file = readTeamJson()
    const team = file.teams.find((t) => t.id === 'explorers')!
    expect(team.reportsTo).toBe('ghost')
  })

  it('write with reportsTo="chef" (known roster member) preserves the value', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    const route = findRoute(activated.routes, 'POST', '/teams')!
    const { status } = await callRoute(route, activated.ctx, {
      body: { id: 'cooks', label: 'Cooks', reportsTo: 'chef' },
    })
    expect(status).toBe(200)
    const file = readTeamJson()
    const team = file.teams.find((t) => t.id === 'cooks')!
    expect(team.reportsTo).toBe('chef')
  })
})

describe('team plugin — reportsTo graceful degradation on read', () => {
  const teamJsonPath = join(testDir, 'plugin-settings', 'team.json')

  function seedTeamJson(teams: unknown[]): void {
    mkdirSync(join(testDir, 'plugin-settings'), { recursive: true })
    writeFileSync(
      teamJsonPath,
      JSON.stringify({ displaySettings: {}, teams }, null, 2),
    )
  }

  beforeEach(() => {
    if (existsSync(teamJsonPath)) {
      rmSync(teamJsonPath, { force: true })
    }
    logWarn.mockClear()
    // Default roster contains main + chef (not "main-operator")
    rosterAgents.current = [
      { id: 'main', name: 'Main', emoji: '🤖', role: 'Orchestrator', headshot: '' },
      { id: 'chef', name: 'Chef', emoji: '🌿', role: 'Cook', headshot: '' },
    ]
  })

  it('degrades reportsTo pointing at a missing agent to null and logs once', async () => {
    seedTeamJson([
      { id: 'builders', label: 'Builders', reportsTo: 'main-operator' },
    ])
    const activated = await activatePlugin(teamPlugin, testDir)
    const route = findRoute(activated.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)
    const teams = (body as { teams: Array<{ id: string; reportsTo: string | null }> }).teams
    const builders = teams.find((t) => t.id === 'builders')!
    expect(builders.reportsTo).toBeNull()

    const warnCalls = logWarn.mock.calls.filter((call) =>
      String(call[0]).includes('unknown agent id'),
    )
    expect(warnCalls.length).toBe(1)
    expect(warnCalls[0][1]).toMatchObject({ teamId: 'builders', reportsTo: 'main-operator' })
  })

  it('preserves reportsTo=null in the response', async () => {
    seedTeamJson([
      { id: 'builders', label: 'Builders', reportsTo: null },
    ])
    const activated = await activatePlugin(teamPlugin, testDir)
    const route = findRoute(activated.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)
    const teams = (body as { teams: Array<{ id: string; reportsTo: string | null }> }).teams
    expect(teams.find((t) => t.id === 'builders')!.reportsTo).toBeNull()

    const warnCalls = logWarn.mock.calls.filter((call) =>
      String(call[0]).includes('unknown agent id'),
    )
    expect(warnCalls.length).toBe(0)
  })

  it('preserves reportsTo="chef" when chef is in the roster', async () => {
    seedTeamJson([
      { id: 'cooks', label: 'Cooks', reportsTo: 'chef' },
    ])
    const activated = await activatePlugin(teamPlugin, testDir)
    const route = findRoute(activated.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)
    const teams = (body as { teams: Array<{ id: string; reportsTo: string | null }> }).teams
    expect(teams.find((t) => t.id === 'cooks')!.reportsTo).toBe('chef')

    const warnCalls = logWarn.mock.calls.filter((call) =>
      String(call[0]).includes('unknown agent id'),
    )
    expect(warnCalls.length).toBe(0)
  })

  it('logs once per team when multiple reportsTo are unknown', async () => {
    seedTeamJson([
      { id: 'teamA', label: 'Team A', reportsTo: 'ghost1' },
      { id: 'teamB', label: 'Team B', reportsTo: 'ghost2' },
    ])
    const activated = await activatePlugin(teamPlugin, testDir)
    const route = findRoute(activated.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)
    const teams = (body as { teams: Array<{ id: string; reportsTo: string | null }> }).teams
    expect(teams.find((t) => t.id === 'teamA')!.reportsTo).toBeNull()
    expect(teams.find((t) => t.id === 'teamB')!.reportsTo).toBeNull()

    const warnCalls = logWarn.mock.calls.filter((call) =>
      String(call[0]).includes('unknown agent id'),
    )
    expect(warnCalls.length).toBe(2)
    const teamIds = warnCalls.map((c) => (c[1] as { teamId: string }).teamId).sort()
    expect(teamIds).toEqual(['teamA', 'teamB'])
  })
})

// ---------------------------------------------------------------------------
// POST / — enhanced with dispatchable + teamId
// ---------------------------------------------------------------------------

describe('team plugin — POST / (create agent with new fields)', () => {
  let activated: ActivatedPlugin
  let adapter: Record<string, ReturnType<typeof mock>>

  beforeAll(async () => {
    activated = await activatePlugin(teamPlugin, testDir)
  })

  beforeEach(async () => {
    adapter = await import('../../../plugins/team/lib/openclaw-adapter') as unknown as Record<string, ReturnType<typeof mock>>
    adapter.addAgent.mockClear()
    adapter.addToAllowLists.mockClear()
  })

  it('passes role, vibe, primaryFunction, defaultMode, tools to addAgent', async () => {
    const route = findRoute(activated.routes, 'POST', '/')!
    const { status } = await callRoute(route, activated.ctx, {
      body: {
        id: 'explorer',
        name: 'Explorer',
        emoji: '🔍',
        role: 'Research Agent',
        vibe: 'Curious and thorough',
        primaryFunction: 'Multi-source research',
        defaultMode: 'Research mode',
        tools: '# TOOLS.md\n\nUse web search first.',
      },
    })
    expect(status).toBe(200)
    expect(adapter.addAgent).toHaveBeenCalledWith(expect.objectContaining({
      id: 'explorer',
      name: 'Explorer',
      role: 'Research Agent',
      vibe: 'Curious and thorough',
      primaryFunction: 'Multi-source research',
      defaultMode: 'Research mode',
      tools: '# TOOLS.md\n\nUse web search first.',
    }))
  })

  it('calls addToAllowLists with "main" when no dispatchable provided', async () => {
    const route = findRoute(activated.routes, 'POST', '/')!
    await callRoute(route, activated.ctx, {
      body: { id: 'trainer', name: 'Trainer' },
    })
    expect(adapter.addToAllowLists).toHaveBeenCalledWith('trainer', 'main')
  })

  it('calls addToAllowLists with "all" when dispatchable="all"', async () => {
    const route = findRoute(activated.routes, 'POST', '/')!
    await callRoute(route, activated.ctx, {
      body: { id: 'trainer', name: 'Trainer', dispatchable: 'all' },
    })
    expect(adapter.addToAllowLists).toHaveBeenCalledWith('trainer', 'all')
  })

  it('calls addToAllowLists with specific list when dispatchable is array', async () => {
    const route = findRoute(activated.routes, 'POST', '/')!
    await callRoute(route, activated.ctx, {
      body: { id: 'trainer', name: 'Trainer', dispatchable: ['chef', 'main'] },
    })
    expect(adapter.addToAllowLists).toHaveBeenCalledWith('trainer', ['chef', 'main'])
  })

  it('writes teamId to display settings when provided', async () => {
    const route = findRoute(activated.routes, 'POST', '/')!
    const teamJsonPath = join(testDir, 'plugin-settings', 'team.json')
    mkdirSync(join(testDir, 'plugin-settings'), { recursive: true })
    writeFileSync(teamJsonPath, JSON.stringify({ displaySettings: {}, teams: [] }))

    const { status } = await callRoute(route, activated.ctx, {
      body: { id: 'coach', name: 'Coach', teamId: 'builders' },
    })
    expect(status).toBe(200)
    const saved = JSON.parse(readFileSync(teamJsonPath, 'utf-8'))
    expect(saved.displaySettings.coach?.teamId).toBe('builders')
  })
})

// ---------------------------------------------------------------------------
// DELETE /:agentId — with allowlist cleanup
// ---------------------------------------------------------------------------

describe('team plugin — DELETE /:agentId (allowlist cleanup)', () => {
  let activated: ActivatedPlugin
  let adapter: Record<string, ReturnType<typeof mock>>

  beforeAll(async () => {
    activated = await activatePlugin(teamPlugin, testDir)
  })

  beforeEach(async () => {
    adapter = await import('../../../plugins/team/lib/openclaw-adapter') as unknown as Record<string, ReturnType<typeof mock>>
    adapter.removeAgent.mockClear()
    adapter.removeFromAllowLists.mockClear()
  })

  it('calls removeFromAllowLists after successful deletion', async () => {
    const route = findRoute(activated.routes, 'DELETE', '/:agentId')!
    const { status } = await callRoute(route, activated.ctx, {
      searchParams: { agentId: 'chef' },
    })
    expect(status).toBe(200)
    expect(adapter.removeAgent).toHaveBeenCalledWith('chef')
    expect(adapter.removeFromAllowLists).toHaveBeenCalledWith('chef')
  })
})

// ---------------------------------------------------------------------------
// PUT /:agentId/identity
// ---------------------------------------------------------------------------

describe('team plugin — PUT /:agentId/identity', () => {
  let activated: ActivatedPlugin
  let adapter: Record<string, ReturnType<typeof mock>>

  beforeAll(async () => {
    activated = await activatePlugin(teamPlugin, testDir)
  })

  beforeEach(async () => {
    adapter = await import('../../../plugins/team/lib/openclaw-adapter') as unknown as Record<string, ReturnType<typeof mock>>
    adapter.updateAgentIdentity.mockClear()
    adapter.updateAgentIdentity.mockResolvedValue(['name', 'role'])
  })

  it('calls updateAgentIdentity with provided fields', async () => {
    const route = findRoute(activated.routes, 'PUT', '/:agentId/identity')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { agentId: 'chef' },
      body: { name: 'Chef v2', role: 'Head Chef' },
    })
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
    expect((body as { updated: string[] }).updated).toEqual(['name', 'role'])
    expect(adapter.updateAgentIdentity).toHaveBeenCalledWith('chef', expect.objectContaining({
      name: 'Chef v2',
      role: 'Head Chef',
    }))
  })

  it('returns 404 when agent not found', async () => {
    adapter.updateAgentIdentity.mockRejectedValue(new Error('Agent "ghost" not found in roster'))
    const route = findRoute(activated.routes, 'PUT', '/:agentId/identity')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { agentId: 'ghost' },
      body: { name: 'Ghost' },
    })
    expect(status).toBe(404)
    expect((body as { error: string }).error).toMatch(/not found/)
  })
})

// ---------------------------------------------------------------------------
// PUT /:agentId/permissions
// ---------------------------------------------------------------------------

describe('team plugin — PUT /:agentId/permissions', () => {
  let activated: ActivatedPlugin
  let adapter: Record<string, ReturnType<typeof mock>>

  beforeAll(async () => {
    activated = await activatePlugin(teamPlugin, testDir)
  })

  beforeEach(async () => {
    adapter = await import('../../../plugins/team/lib/openclaw-adapter') as unknown as Record<string, ReturnType<typeof mock>>
    adapter.setSubagentPermissions.mockClear()
    rosterAgents.current = [
      { id: 'main', name: 'Main', emoji: '🤖', role: 'Orchestrator', headshot: '' },
      { id: 'chef', name: 'Chef', emoji: '🌿', role: 'Cook', headshot: '' },
    ]
  })

  it('updates permissions for valid agent IDs', async () => {
    const route = findRoute(activated.routes, 'PUT', '/:agentId/permissions')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { agentId: 'main' },
      body: { allowAgents: ['chef'] },
    })
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
    expect(adapter.setSubagentPermissions).toHaveBeenCalledWith('main', ['chef'])
  })

  it('returns 400 when allowAgents is not an array', async () => {
    const route = findRoute(activated.routes, 'PUT', '/:agentId/permissions')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { agentId: 'main' },
      body: { allowAgents: 'chef' },
    })
    expect(status).toBe(400)
    expect((body as { error: string }).error).toMatch(/string array/)
  })

  it('returns 400 when allowAgents contains unknown IDs', async () => {
    const route = findRoute(activated.routes, 'PUT', '/:agentId/permissions')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { agentId: 'main' },
      body: { allowAgents: ['chef', 'ghost'] },
    })
    expect(status).toBe(400)
    expect((body as { error: string }).error).toMatch(/ghost/)
  })
})
