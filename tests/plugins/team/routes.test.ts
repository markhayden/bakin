/**
 * Tests for team plugin routes and search content type registration.
 *
 * First test suite for the team plugin (was zero coverage). Scope is
 * intentionally narrow: smoke-test plugin activation, validate that the
 * /search route is auto-registered via the test helpers (per C16 wiring),
 * and verify a representative non-search route is registered.
 *
 * The team plugin delegates to the active runtime adapter; runtime-facing
 * modules are stubbed so the test never reads from the user's real config.
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

// Settings — return a fully-shaped stub
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    mainAgentId: 'main',
    search: { adapter: 'antfly', settings: { enabled: false, auditTtl: undefined } },
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

mock.module('../../../src/core/usage', () => ({
  getStatsByMs: mock(() => ({ total: 0, errors: 0 })),
}))

mock.module('../../../plugins/team/lib/session-reader', () => ({
  readLatestSessionTranscript: mock(async () => null),
}))

mock.module('../../../src/lib/agents', () => ({
  startAgent: mock(async () => {}),
  stopAgent: mock(async () => {}),
}))

mock.module('../../../src/lib/content-files', () => ({
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
    getHealthChecks: () => [],
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
      updatePermissions: async () => {},
      updateAllowlist: runtimeMocks.updateAllowlist,
      heartbeat: async () => false,
    },
    messaging: { send: async () => ({ id: 'msg-1' }), stream: async function* () {} },
    tools: { invoke: async () => ({ ok: true }), list: async () => [] },
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
      onMessage: () => () => {},
      onInteraction: () => () => {},
    },
    skills: { list: async () => [], get: async () => null, write: async () => {}, remove: async () => {} },
    sessions: { list: async () => [], get: async () => null },
    memory: { listTiers: async () => [], listEntries: async () => [], getEntry: async () => null },
    tasks: {
      dispatch: async (args: { bakinTaskId: string }) => ({ flowId: `flow-${args.bakinTaskId}` }),
      getExecutionStatus: async (flowId: string) => ({ flowId, state: 'unknown' }),
      listExecutions: async () => [],
      cancelExecution: async () => {},
      subscribeExecutionUpdates: () => () => {},
    },
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

import { activatePlugin, findRoute, callSearchRoute, callRoute } from '../test-helpers'
const teamPlugin = (await import('../../../plugins/team/index')).default as typeof import('../../../plugins/team/index').default
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

  beforeAll(async () => {
    activated = await activatePlugin(teamPlugin, testDir)
  })

  beforeEach(() => {
    runtimeMocks.create.mockClear()
    runtimeMocks.writeWorkspaceFile.mockClear()
    runtimeMocks.updateAllowlist.mockClear()
  })

  it('passes role, vibe, primaryFunction, defaultMode, tools through the runtime adapter', async () => {
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
    expect(runtimeMocks.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'explorer',
      name: 'Explorer',
      role: 'Research Agent',
      metadata: expect.objectContaining({
        vibe: 'Curious and thorough',
        primaryFunction: 'Multi-source research',
        defaultMode: 'Research mode',
      }),
    }))
    expect(runtimeMocks.writeWorkspaceFile).toHaveBeenCalledWith('explorer', expect.objectContaining({
      path: 'TOOLS.md',
      content: '# TOOLS.md\n\nUse web search first.',
    }))
  })

  it('adds the new agent to main allowlist when no dispatchable provided', async () => {
    const route = findRoute(activated.routes, 'POST', '/')!
    await callRoute(route, activated.ctx, {
      body: { id: 'trainer', name: 'Trainer' },
    })
    expect(runtimeMocks.updateAllowlist).toHaveBeenCalledWith('main', { add: ['trainer'] })
  })

  it('adds the new agent to all allowlists when dispatchable="all"', async () => {
    const route = findRoute(activated.routes, 'POST', '/')!
    await callRoute(route, activated.ctx, {
      body: { id: 'trainer', name: 'Trainer', dispatchable: 'all' },
    })
    expect(runtimeMocks.updateAllowlist).toHaveBeenCalledWith('main', { add: ['trainer'] })
    expect(runtimeMocks.updateAllowlist).toHaveBeenCalledWith('chef', { add: ['trainer'] })
  })

  it('adds the new agent to selected allowlists when dispatchable is array', async () => {
    const route = findRoute(activated.routes, 'POST', '/')!
    await callRoute(route, activated.ctx, {
      body: { id: 'trainer', name: 'Trainer', dispatchable: ['chef', 'main'] },
    })
    expect(runtimeMocks.updateAllowlist).toHaveBeenCalledWith('main', { add: ['trainer'] })
    expect(runtimeMocks.updateAllowlist).toHaveBeenCalledWith('chef', { add: ['trainer'] })
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

  beforeAll(async () => {
    activated = await activatePlugin(teamPlugin, testDir)
  })

  beforeEach(() => {
    runtimeMocks.remove.mockClear()
    runtimeMocks.updateAllowlist.mockClear()
    rosterAgents.current = [
      { id: 'main', name: 'Main', emoji: '🤖', role: 'Orchestrator', headshot: '' },
      { id: 'chef', name: 'Chef', emoji: '🌿', role: 'Cook', headshot: '' },
    ]
  })

  it('removes the agent and drops it from runtime allowlists', async () => {
    const route = findRoute(activated.routes, 'DELETE', '/:agentId')!
    const { status } = await callRoute(route, activated.ctx, {
      searchParams: { agentId: 'chef' },
    })
    expect(status).toBe(200)
    expect(runtimeMocks.remove).toHaveBeenCalledWith('chef')
    expect(runtimeMocks.updateAllowlist).toHaveBeenCalledWith('main', { remove: ['chef'] })
  })
})

// ---------------------------------------------------------------------------
// PUT /:agentId/identity
// ---------------------------------------------------------------------------

describe('team plugin — PUT /:agentId/identity', () => {
  let activated: ActivatedPlugin

  beforeAll(async () => {
    activated = await activatePlugin(teamPlugin, testDir)
  })

  beforeEach(() => {
    runtimeMocks.update.mockClear()
    runtimeMocks.writeWorkspaceFile.mockClear()
    rosterAgents.current = [
      { id: 'main', name: 'Main', emoji: '🤖', role: 'Orchestrator', headshot: '' },
      { id: 'chef', name: 'Chef', emoji: '🌿', role: 'Cook', headshot: '' },
    ]
  })

  it('updates identity fields through the runtime adapter', async () => {
    const route = findRoute(activated.routes, 'PUT', '/:agentId/identity')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { agentId: 'chef' },
      body: { name: 'Chef v2', role: 'Head Chef' },
    })
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
    expect((body as { updated: string[] }).updated).toEqual(['name', 'role'])
    expect(runtimeMocks.update).toHaveBeenCalledWith('chef', expect.objectContaining({
      name: 'Chef v2',
      role: 'Head Chef',
    }))
  })

  it('returns 404 when agent not found', async () => {
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

  beforeAll(async () => {
    activated = await activatePlugin(teamPlugin, testDir)
  })

  beforeEach(() => {
    runtimeMocks.updateAllowlist.mockClear()
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
    expect(runtimeMocks.updateAllowlist).toHaveBeenCalledWith('main', { replace: ['chef'] })
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

describe('team plugin — GET /:agentId/heartbeat', () => {
  let activated: ActivatedPlugin

  beforeAll(async () => {
    activated = await activatePlugin(teamPlugin, testDir)
  })

  it('rejects missing agentId with 400', async () => {
    const route = findRoute(activated.routes, 'GET', '/:agentId/heartbeat')!
    const { status } = await callRoute(route, activated.ctx, { searchParams: {} })
    expect(status).toBe(400)
  })

  it('returns null heartbeat when none exists', async () => {
    runtimeMocks.readWorkspaceFile.mockResolvedValueOnce(null)

    const route = findRoute(activated.routes, 'GET', '/:agentId/heartbeat')!
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: { agentId: 'main' } })
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, heartbeat: null })
  })

  it('returns content + lastUpdated when the file exists', async () => {
    runtimeMocks.readWorkspaceFile.mockResolvedValueOnce({
      path: 'HEARTBEAT.md',
      content: '## Alive',
      updatedAt: '2026-04-25T10:00:00.000Z',
    })

    const route = findRoute(activated.routes, 'GET', '/:agentId/heartbeat')!
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: { agentId: 'pixel' } })
    expect(status).toBe(200)
    expect(body).toEqual({
      ok: true,
      heartbeat: { content: '## Alive', lastUpdated: '2026-04-25T10:00:00.000Z' },
    })
  })
})

describe('team plugin — GET /:agentId/active-context', () => {
  let activated: ActivatedPlugin

  beforeAll(async () => {
    activated = await activatePlugin(teamPlugin, testDir)
  })

  it('rejects missing agentId with 400', async () => {
    const route = findRoute(activated.routes, 'GET', '/:agentId/active-context')!
    const { status } = await callRoute(route, activated.ctx, { searchParams: {} })
    expect(status).toBe(400)
  })

  it('returns transcript=null when no session exists', async () => {
    const sessionMod = await import('../../../plugins/team/lib/session-reader')
    const spy = sessionMod.readLatestSessionTranscript as ReturnType<typeof mock>
    spy.mockResolvedValueOnce(null)

    const route = findRoute(activated.routes, 'GET', '/:agentId/active-context')!
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: { agentId: 'main' } })
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, transcript: null })
  })

  it('returns the parsed transcript and respects the max query param', async () => {
    const sessionMod = await import('../../../plugins/team/lib/session-reader')
    const spy = sessionMod.readLatestSessionTranscript as ReturnType<typeof mock>
    const transcript = {
      sessionId: 'sess-1',
      sessionStarted: '2026-04-25T10:00:00Z',
      messages: [{ role: 'user', content: 'hi' }],
      truncated: false,
      totalMessages: 1,
    }
    spy.mockResolvedValueOnce(transcript)

    const route = findRoute(activated.routes, 'GET', '/:agentId/active-context')!
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: { agentId: 'pixel', max: '50' } })
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, transcript })
    expect(spy).toHaveBeenCalledWith(activated.ctx.runtime.memory, 'pixel', { maxMessages: 50 })
  })
})

describe('team plugin — GET /:agentId/recent-activity', () => {
  let activated: ActivatedPlugin

  beforeAll(async () => {
    activated = await activatePlugin(teamPlugin, testDir)
  })

  it('rejects missing agentId with 400', async () => {
    const route = findRoute(activated.routes, 'GET', '/:agentId/recent-activity')!
    const { status } = await callRoute(route, activated.ctx, { searchParams: {} })
    expect(status).toBe(400)
  })

  it('returns counts across 5m / 1h / 24h windows + sinceServerStart', async () => {
    const usageMod = await import('../../../src/core/usage')
    const spy = usageMod.getStatsByMs as ReturnType<typeof mock>
    spy.mockReturnValueOnce({ total: 1, errors: 0 })
       .mockReturnValueOnce({ total: 5, errors: 1 })
       .mockReturnValueOnce({ total: 12, errors: 2 })

    const route = findRoute(activated.routes, 'GET', '/:agentId/recent-activity')!
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: { agentId: 'pixel' } })
    expect(status).toBe(200)
    const activity = (body as { activity: { windowMs: Record<string, number>; errors: Record<string, number>; sinceServerStart: string } }).activity
    expect(activity.windowMs).toEqual({ '5m': 1, '1h': 5, '24h': 12 })
    expect(activity.errors).toEqual({ '5m': 0, '1h': 1, '24h': 2 })
    expect(activity.sinceServerStart).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
