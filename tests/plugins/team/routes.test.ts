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

// Mutable board for the DELETE /teams/:teamId active-task guard (review R6).
type GuardTask = { id: string; team?: string; agent?: string }
const guardBoard: { columns: Record<string, GuardTask[]> } = { columns: { backlog: [], todo: [], inProgress: [], review: [], blocked: [], done: [], archived: [] } }
const taskStoreGuardMock = () => ({ readTaskboard: () => guardBoard })
mock.module('../../../src/core/task-store', taskStoreGuardMock)
mock.module('@/core/task-store', taskStoreGuardMock)
// ---------------------------------------------------------------------------

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  initBakinHome: () => ({ created: [], seeded: [] }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    agents: join(testDir, 'agents'),
    heartbeats: join(testDir, 'heartbeats'),
  }),
}))

mock.module('../../../packages/core/src/content-dir', () => ({
  initBakinHome: () => ({ created: [], seeded: [] }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
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

mock.module('../../../packages/adapter-openclaw/src/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
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
  getUsageObservationCursor: mock(() => 0),
  reconcileObservedUsage: mock(() => false),
  // The search outbox pump (imported transitively) records drain telemetry.
  recordUsage: mock(() => {}),
  getUsageFeed: mock(() => ({ totals: { count: 0, errors: 0, errorRate: 0 }, topByName: [], byAgent: [], recent: [] })),
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
    models: {
      listAvailable: async () => [],
      routingSupport: () => ({
        defaultModel: true,
        fallbackModels: true,
        defaultSubagentModel: true,
        aliases: true,
        perAgentSubagentModel: true,
      }),
      // P2.4: the default-model fallback reads the routing policy, not config.
      routingPolicy: async () => ({
        defaultModel: 'claude-opus-4',
        fallbackModels: [],
        defaultSubagentModel: null,
        aliases: {},
      }),
      setRoutingPolicy: async () => {},
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
import { RuntimeError } from '../../../packages/core/src/adapters/runtime'
const teamPlugin = (await import('../../../plugins/team/index')).default as typeof import('../../../plugins/team/index').default
import type { ActivatedPlugin } from '../test-helpers'
import { installedByPath } from '@bakin/core/agent-packages/markers'
import type { RegisteredAPIRoute, PluginContext } from '@bakin/core/plugin-types'

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

  it('omits headshot URLs when no avatar file exists', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    const route = findRoute(activated.routes, 'GET', '/')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)
    const agents = (body as { agents: Array<{ id: string; headshot: string }> }).agents
    expect(agents.find((agent) => agent.id === 'main')?.headshot).toBe('')
  })

  it('returns JSON for missing avatar files', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    const route = findRoute(activated.routes, 'GET', '/:agentId/avatar')!
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: { agentId: 'main' } })
    expect(status).toBe(404)
    expect(body).toEqual({ error: 'Avatar not found' })
  })
})

// ---------------------------------------------------------------------------
// Avatar upload + serve — dual-format (webp/png/jpg) behavior (#339)
// ---------------------------------------------------------------------------

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const JUNK = new Uint8Array([0x00, 0x01, 0x02, 0x03])

// The upload route reads a raw binary body; callRoute JSON-encodes bodies, so
// build the Request directly and invoke the handler (agentId comes via query,
// matching how the dispatcher injects the path param).
async function uploadAvatar(route: RegisteredAPIRoute, ctx: PluginContext, agentId: string, bytes: Uint8Array): Promise<Response> {
  const req = new Request(`http://localhost/${agentId}/avatar?agentId=${agentId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    // Runtime accepts a Uint8Array body; the cast satisfies the strict
    // ArrayBufferLike-vs-ArrayBuffer BodyInit typing in test tsconfig.
    body: bytes as unknown as BodyInit,
  })
  return route.handler(req, ctx)
}

describe('team plugin — avatar upload (dual-format)', () => {
  it('preserves an uploaded webp and serves it as image/webp', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    const upload = findRoute(activated.routes, 'POST', '/:agentId/avatar')!
    const up = await uploadAvatar(upload, activated.ctx, 'pix-webp', WEBP)
    expect(up.status).toBe(200)
    expect(existsSync(join(testDir, 'agents', 'pix-webp', 'avatar.webp'))).toBe(true)

    const serve = findRoute(activated.routes, 'GET', '/:agentId/avatar')!
    const { response } = await callRoute(serve, activated.ctx, { searchParams: { agentId: 'pix-webp' }, rawResponse: true })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/webp')
  })

  it('preserves an uploaded png and serves it as image/png', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    const upload = findRoute(activated.routes, 'POST', '/:agentId/avatar')!
    await uploadAvatar(upload, activated.ctx, 'pix-png', PNG)
    expect(existsSync(join(testDir, 'agents', 'pix-png', 'avatar.png'))).toBe(true)
  })

  it('serves 304 for a matching If-None-Match and DECLARES it on the route', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    const upload = findRoute(activated.routes, 'POST', '/:agentId/avatar')!
    await uploadAvatar(upload, activated.ctx, 'pix-cache', WEBP)

    const serve = findRoute(activated.routes, 'GET', '/:agentId/avatar')!
    // Undeclared statuses make the dev-mode response validator warn on every
    // conditional browser refetch ("undeclared response status 304").
    // `responses` is a RouteDefinition field the legacy RegisteredAPIRoute type omits.
    const declared = (serve as unknown as { responses?: Record<string, unknown> }).responses
    expect(Object.keys(declared ?? {})).toContain('304')

    const first = await callRoute(serve, activated.ctx, { searchParams: { agentId: 'pix-cache' }, rawResponse: true })
    expect(first.response.status).toBe(200)
    const etag = first.response.headers.get('ETag')
    expect(etag).toBeTruthy()

    const req = new Request('http://localhost/pix-cache/avatar?agentId=pix-cache', {
      headers: { 'If-None-Match': etag! },
    })
    const res = await serve.handler(req, activated.ctx)
    expect(res.status).toBe(304)
  })

  it('rejects non-image bytes with 400', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    const upload = findRoute(activated.routes, 'POST', '/:agentId/avatar')!
    const res = await uploadAvatar(upload, activated.ctx, 'pix-junk', JUNK)
    expect(res.status).toBe(400)
    expect(existsSync(join(testDir, 'agents', 'pix-junk'))).toBe(false)
  })

  it('deletes a stale other-format sibling and its .installedBy sidecar', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    const upload = findRoute(activated.routes, 'POST', '/:agentId/avatar')!

    // Seed a package-projected webp avatar + sidecar.
    const agentDir = join(testDir, 'agents', 'pix-swap')
    mkdirSync(agentDir, { recursive: true })
    const webp = join(agentDir, 'avatar.webp')
    writeFileSync(webp, WEBP)
    writeFileSync(installedByPath(webp), JSON.stringify({ package: 'pix', version: '1.0.0', sha256: 'x' }))

    // Upload a jpg over it.
    await uploadAvatar(upload, activated.ctx, 'pix-swap', JPG)

    expect(existsSync(join(agentDir, 'avatar.jpg'))).toBe(true)
    expect(existsSync(webp)).toBe(false)
    expect(existsSync(installedByPath(webp))).toBe(false)
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

  it("maps the adapters' typed not_found to 404 (kind classification, never message text)", async () => {
    // Both real adapters reject allowlist mutations on a missing agent with
    // RuntimeError kind 'not_found' (R28) — the route must classify by kind.
    runtimeMocks.updateAllowlist.mockRejectedValueOnce(
      new RuntimeError('anything: the message text must not matter', { kind: 'not_found' }),
    )
    const route = findRoute(activated.routes, 'PUT', '/:agentId/permissions')!
    const { status } = await callRoute(route, activated.ctx, {
      searchParams: { agentId: 'main' },
      body: { allowAgents: ['chef'] },
    })
    expect(status).toBe(404)
  })

  it('maps untyped runtime failures to 500 even when the text says "not found"', async () => {
    // The old string classifier would have returned 404 here — kind-based
    // classification must not.
    runtimeMocks.updateAllowlist.mockRejectedValueOnce(new Error('thing not found somewhere'))
    const route = findRoute(activated.routes, 'PUT', '/:agentId/permissions')!
    const { status } = await callRoute(route, activated.ctx, {
      searchParams: { agentId: 'main' },
      body: { allowAgents: ['chef'] },
    })
    expect(status).toBe(500)
  })

  it('maps the self-dispatch guard to 400 via its typed class', async () => {
    const route = findRoute(activated.routes, 'PUT', '/:agentId/permissions')!
    const { status, body } = await callRoute(route, activated.ctx, {
      searchParams: { agentId: 'main' },
      body: { allowAgents: ['main', 'chef'] },
    })
    expect(status).toBe(400)
    expect((body as { error: string }).error).toMatch(/cannot dispatch to itself/)
  })
})

describe('team plugin — GET /:agentId/heartbeat', () => {
  let activated: ActivatedPlugin

  beforeAll(async () => {
    activated = await activatePlugin(teamPlugin, testDir)
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

// ---------------------------------------------------------------------------
// DELETE /teams/:teamId — active-task guard (review R6)
// ---------------------------------------------------------------------------

describe('team plugin — DELETE /teams/:teamId guard (review R6)', () => {
  beforeEach(() => {
    for (const col of Object.values(guardBoard.columns)) col.length = 0
  })

  it('refuses with 409 while active tasks reference the team', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    const create = findRoute(activated.routes, 'POST', '/teams')!
    await callRoute(create, activated.ctx, { body: { id: 'growth', label: 'Growth' } })

    guardBoard.columns.todo.push({ id: 'task-1', team: 'growth' })
    const del = findRoute(activated.routes, 'DELETE', '/teams/:teamId')!
    const { status, body } = await callRoute(del, activated.ctx, { searchParams: { teamId: 'growth' } })
    expect(status).toBe(409)
    expect(String(body.error)).toContain('growth')
    expect(body.taskIds).toEqual(['task-1'])
  })

  it('deletes cleanly when no active tasks reference the team', async () => {
    const activated = await activatePlugin(teamPlugin, testDir)
    const create = findRoute(activated.routes, 'POST', '/teams')!
    await callRoute(create, activated.ctx, { body: { id: 'growth2', label: 'Growth 2' } })

    guardBoard.columns.done.push({ id: 'task-done', team: 'growth2' }) // done does not block
    const del = findRoute(activated.routes, 'DELETE', '/teams/:teamId')!
    const { status } = await callRoute(del, activated.ctx, { searchParams: { teamId: 'growth2' } })
    expect(status).toBe(200)
  })
})
