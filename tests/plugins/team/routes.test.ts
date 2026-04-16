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
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ---------------------------------------------------------------------------
// Temp directory
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-team-routes-${Date.now()}`)

// ---------------------------------------------------------------------------
// Mandatory mocks — declared before any plugin import
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

const { logWarn, logInfo, logError, logDebug } = vi.hoisted(() => ({
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: logInfo,
    warn: logWarn,
    error: logError,
    debug: logDebug,
  }),
}))

vi.mock('../../../src/core/watcher', () => ({
  registerSyncHook: vi.fn(),
  registerUnlinkHook: vi.fn(),
}))

// OpenClaw HTTP client — no real gateway calls
vi.mock('../../../src/core/openclaw-client', () => ({
  sendMessage: vi.fn(async () => 'ok'),
  invokeTool: vi.fn(async () => ({ ok: true })),
  sendChannelMessage: vi.fn(async () => 'ok'),
  restartGateway: vi.fn(async () => {}),
  ping: vi.fn(async () => true),
  getAgentLastReply: vi.fn(() => null),
}))

// Settings — return a fully-shaped stub
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

// mcporter — would otherwise spawn child processes
vi.mock('../../../src/core/mcporter', () => ({
  syncConfig: vi.fn(() => []),
}))

// agents — sendMessageToAgent is the only thing imported by team
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

// Shared mutable roster so individual tests can simulate missing agents
// without redefining the full adapter mock.
const { rosterAgents } = vi.hoisted(() => ({
  rosterAgents: {
    current: [
      { id: 'main', name: 'Main', emoji: '🤖', role: 'Orchestrator', headshot: '' },
      { id: 'basil', name: 'Basil', emoji: '🌿', role: 'Cook', headshot: '' },
    ] as Array<{ id: string; name: string; emoji: string; role: string; headshot: string }>,
  },
}))

// OpenClaw adapter — fully stubbed, never touches ~/.openclaw/
vi.mock('@bakin/team/lib/openclaw-adapter', () => ({
  listAgents: vi.fn(() => rosterAgents.current),
  getAgentIds: vi.fn(() => rosterAgents.current.map((a) => a.id)),
  getAgentModel: vi.fn(() => 'claude-opus-4'),
  getAgentProfile: vi.fn((id: string) => ({
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
  listWorkspaceFiles: vi.fn(() => []),
  readWorkspaceFile: vi.fn(() => null),
  writeWorkspaceFile: vi.fn(() => {}),
  listSkills: vi.fn(() => []),
  readSkillFile: vi.fn(() => null),
  listMemoryFiles: vi.fn(() => []),
  readMemoryFile: vi.fn(() => null),
  addAgent: vi.fn(async (input: Record<string, unknown>) => ({ id: input.id, workspace: `/tmp/ws/${input.id}` })),
  removeAgent: vi.fn(async () => true),
  removeFromAllowLists: vi.fn(),
  updateAgentField: vi.fn(),
  getOpenClawConfig: vi.fn(() => ({ agents: { list: [] } })),
  openclawExec: vi.fn(async () => '{}'),
  synthesizeIdentityMd: vi.fn(() => '# IDENTITY.md\n'),
}))

// The team plugin's relative import path inside the plugin uses './lib/openclaw-adapter'.
// Add a relative-path alias so vi.mock catches both shapes.
vi.mock('../../../plugins/team/lib/openclaw-adapter', () => ({
  listAgents: vi.fn(() => rosterAgents.current),
  getAgentIds: vi.fn(() => rosterAgents.current.map((a) => a.id)),
  getAgentModel: vi.fn(() => 'claude-opus-4'),
  getAgentProfile: vi.fn((id: string) => ({
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
  listWorkspaceFiles: vi.fn(() => []),
  readWorkspaceFile: vi.fn(() => null),
  writeWorkspaceFile: vi.fn(() => {}),
  listSkills: vi.fn(() => []),
  readSkillFile: vi.fn(() => null),
  listMemoryFiles: vi.fn(() => []),
  readMemoryFile: vi.fn(() => null),
  addAgent: vi.fn(async (input: Record<string, unknown>) => ({ id: input.id, workspace: `/tmp/ws/${input.id}` })),
  removeAgent: vi.fn(async () => true),
  removeFromAllowLists: vi.fn(),
  updateAgentField: vi.fn(),
  getOpenClawConfig: vi.fn(() => ({ agents: { list: [] } })),
  openclawExec: vi.fn(async () => '{}'),
  synthesizeIdentityMd: vi.fn(() => '# IDENTITY.md\n'),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { activatePlugin, findRoute, callSearchRoute, callRoute } from '../test-helpers'
import teamPlugin from '../../../plugins/team/index'
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
    const call = (activated.ctx.search.registerContentType as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
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
        id: 'roscoe',
        table: 'bakin_team',
        score: 1,
        fields: { name: 'Roscoe', soul: 'curious tinkerer' },
      },
    ])

    const { status, body } = await callSearchRoute(activated, 'roscoe')
    expect(status).toBe(200)
    const results = (body as { results?: unknown[] }).results
    expect(Array.isArray(results)).toBe(true)
    expect(results).toHaveLength(1)
    expect((results![0] as { id: string }).id).toBe('roscoe')
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
      { id: 'basil', name: 'Basil', emoji: '🌿', role: 'Cook', headshot: '' },
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

  it('write with unknown non-null reportsTo preserves the value (basil not in roster)', async () => {
    // "basil" is technically in the roster above, but we want to prove the
    // write path does not validate against the roster — it only normalizes
    // the "this is the main agent" case. Point at a clearly-unknown id.
    const activated = await activatePlugin(teamPlugin, testDir)
    const route = findRoute(activated.routes, 'POST', '/teams')!
    const { status } = await callRoute(route, activated.ctx, {
      body: { id: 'scouts', label: 'Scouts', reportsTo: 'ghost' },
    })
    expect(status).toBe(200)
    const file = readTeamJson()
    const team = file.teams.find((t) => t.id === 'scouts')!
    expect(team.reportsTo).toBe('ghost')
  })

  it('write with reportsTo="basil" (known roster member) preserves the value', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    const route = findRoute(activated.routes, 'POST', '/teams')!
    const { status } = await callRoute(route, activated.ctx, {
      body: { id: 'cooks', label: 'Cooks', reportsTo: 'basil' },
    })
    expect(status).toBe(200)
    const file = readTeamJson()
    const team = file.teams.find((t) => t.id === 'cooks')!
    expect(team.reportsTo).toBe('basil')
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
    // Default roster contains main + basil (not "roscoe")
    rosterAgents.current = [
      { id: 'main', name: 'Main', emoji: '🤖', role: 'Orchestrator', headshot: '' },
      { id: 'basil', name: 'Basil', emoji: '🌿', role: 'Cook', headshot: '' },
    ]
  })

  it('degrades reportsTo pointing at a missing agent to null and logs once', async () => {
    seedTeamJson([
      { id: 'builders', label: 'Builders', reportsTo: 'roscoe' },
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
    expect(warnCalls[0][1]).toMatchObject({ teamId: 'builders', reportsTo: 'roscoe' })
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

  it('preserves reportsTo="basil" when basil is in the roster', async () => {
    seedTeamJson([
      { id: 'cooks', label: 'Cooks', reportsTo: 'basil' },
    ])
    const activated = await activatePlugin(teamPlugin, testDir)
    const route = findRoute(activated.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)
    const teams = (body as { teams: Array<{ id: string; reportsTo: string | null }> }).teams
    expect(teams.find((t) => t.id === 'cooks')!.reportsTo).toBe('basil')

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
