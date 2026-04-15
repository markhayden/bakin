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
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
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

// OpenClaw adapter — fully stubbed, never touches ~/.openclaw/
vi.mock('@bakin/team/lib/openclaw-adapter', () => ({
  listAgents: vi.fn(() => [
    { id: 'main', name: 'Main', emoji: '🤖', role: 'Orchestrator', headshot: '' },
    { id: 'chef', name: 'Chef', emoji: '🌿', role: 'Cook', headshot: '' },
  ]),
  getAgentIds: vi.fn(() => ['main', 'chef']),
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
  addAgent: vi.fn(),
  removeAgent: vi.fn(() => true),
  updateAgentField: vi.fn(),
  getOpenClawConfig: vi.fn(() => ({ agents: { list: [] } })),
}))

// The team plugin's relative import path inside the plugin uses './lib/openclaw-adapter'.
// Add a relative-path alias so vi.mock catches both shapes.
vi.mock('../../../plugins/team/lib/openclaw-adapter', () => ({
  listAgents: vi.fn(() => [
    { id: 'main', name: 'Main', emoji: '🤖', role: 'Orchestrator', headshot: '' },
    { id: 'chef', name: 'Chef', emoji: '🌿', role: 'Cook', headshot: '' },
  ]),
  getAgentIds: vi.fn(() => ['main', 'chef']),
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
  addAgent: vi.fn(),
  removeAgent: vi.fn(() => true),
  updateAgentField: vi.fn(),
  getOpenClawConfig: vi.fn(() => ({ agents: { list: [] } })),
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
