/**
 * Tests for the team plugin's openclaw-adapter validation pass in
 * `listAgents()`. Verifies the adapter rejects duplicate ids, rejects
 * duplicate resolved workspaces, and returns an empty list when the
 * canonical `main` agent is missing.
 *
 * The adapter reads from `~/.openclaw/openclaw.json` via
 * `readOpenClawConfig` in `@bakin/core/openclaw-config`. We mock that
 * module and the logger so tests can drive config shapes without ever
 * touching the real filesystem.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Mandatory test-isolation mocks — declared before any plugin import
// ---------------------------------------------------------------------------

const testDir = vi.hoisted(() => {
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  return join(tmpdir(), `bakin-test-team-adapter-${Date.now()}`)
})

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

// Shared logger mock — the adapter calls createLogger('team:openclaw') at
// module init so we capture the singleton and assert on it per test.
// vi.hoisted is required because vi.mock factories run before the test
// module body executes.
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => loggerMock,
}))

vi.mock('../../../src/core/watcher', () => ({
  registerSyncHook: vi.fn(),
  registerUnlinkHook: vi.fn(),
}))

// OpenClaw client — adapter doesn't import it directly, but other modules
// pulled in transitively might. Stub to be safe.
vi.mock('../../../src/core/openclaw-client', () => ({
  sendMessage: vi.fn(async () => 'ok'),
  invokeTool: vi.fn(async () => ({ ok: true })),
  sendChannelMessage: vi.fn(async () => 'ok'),
  restartGateway: vi.fn(async () => {}),
  ping: vi.fn(async () => true),
  getAgentLastReply: vi.fn(() => null),
}))

// main-agent — `resolveRole` falls back on tryGetMainAgentId for the
// orchestrator-role label. Stub to avoid reading settings.
vi.mock('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
}))

// openclaw-home — adapter touches getOpenClawHome/getOpenClawPath at
// module init. Point them at a non-existent tmp path so filesystem reads
// for workspace files (called from resolveRole) return null gracefully.
vi.mock('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))

// The module under test — drive config shapes through this mock.
const readOpenClawConfigMock = vi.hoisted(() => vi.fn(() => null as unknown))
vi.mock('@bakin/core/openclaw-config', () => ({
  readOpenClawConfig: () => readOpenClawConfigMock(),
  resetOpenClawConfigCache: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import after mocks are declared
// ---------------------------------------------------------------------------

import { listAgents } from '../../../plugins/team/lib/openclaw-adapter'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setConfig(config: unknown): void {
  readOpenClawConfigMock.mockReturnValue(config)
}

describe('team/openclaw-adapter · listAgents', () => {
  beforeEach(() => {
    loggerMock.info.mockClear()
    loggerMock.warn.mockClear()
    loggerMock.error.mockClear()
    loggerMock.debug.mockClear()
    readOpenClawConfigMock.mockReset()
  })

  it('accepts a clean config with main + another agent', () => {
    setConfig({
      agents: {
        list: [
          { id: 'main', identity: { name: 'Crab' } },
          { id: 'patch', workspace: '/ws/patch' },
        ],
      },
    })

    const result = listAgents()

    expect(result).toHaveLength(2)
    expect(result.map((a) => a.id)).toEqual(['main', 'patch'])
    expect(result[0].name).toBe('Crab')
    expect(loggerMock.error).not.toHaveBeenCalled()
  })

  it('drops a duplicate id and logs one error (first wins)', () => {
    setConfig({
      agents: {
        list: [
          { id: 'main' },
          { id: 'main', identity: { name: 'Shadow' } },
        ],
      },
    })

    const result = listAgents()

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('main')
    // Duplicate should NOT have overridden the first entry's name/identity.
    expect(result[0].name).toBe('main')
    expect(loggerMock.error).toHaveBeenCalledTimes(1)
    expect(loggerMock.error.mock.calls[0][0]).toMatch(/duplicate.*main/i)
  })

  it('returns empty and logs the missing-main error when no main agent exists', () => {
    setConfig({ agents: { list: [{ id: 'bob' }] } })

    const result = listAgents()

    expect(result).toEqual([])
    expect(loggerMock.error).toHaveBeenCalledTimes(1)
    expect(loggerMock.error.mock.calls[0][0]).toMatch(/must contain.*main/i)
  })

  it('drops an agent colliding on the defaults-inherited workspace', () => {
    setConfig({
      agents: {
        defaults: { workspace: '/shared/ws' },
        list: [
          { id: 'main' },
          { id: 'roscoe' },
        ],
      },
    })

    const result = listAgents()

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('main')
    expect(loggerMock.error).toHaveBeenCalledTimes(1)
    const msg = loggerMock.error.mock.calls[0][0] as string
    expect(msg).toMatch(/workspace.*shared/i)
    expect(msg).toContain('roscoe')
    expect(msg).toContain('main')
  })

  it('drops an explicit workspace collision but keeps other valid agents', () => {
    setConfig({
      agents: {
        list: [
          { id: 'a', workspace: '/ws/x' },
          { id: 'b', workspace: '/ws/x' },
          { id: 'main', workspace: '/ws/y' },
        ],
      },
    })

    const result = listAgents()

    expect(result).toHaveLength(2)
    expect(result.map((r) => r.id)).toEqual(['a', 'main'])
    expect(loggerMock.error).toHaveBeenCalledTimes(1)
    const msg = loggerMock.error.mock.calls[0][0] as string
    expect(msg).toContain('b')
    expect(msg).toContain('a')
    expect(msg).toContain('/ws/x')
  })

  it('returns empty for an empty agents list and logs missing-main', () => {
    setConfig({ agents: { list: [] } })

    const result = listAgents()

    expect(result).toEqual([])
    expect(loggerMock.error).toHaveBeenCalledTimes(1)
    expect(loggerMock.error.mock.calls[0][0]).toMatch(/must contain.*main/i)
  })

  it('returns empty when readOpenClawConfig yields null/empty and logs missing-main', () => {
    setConfig(null)

    const result = listAgents()

    expect(result).toEqual([])
    expect(loggerMock.error).toHaveBeenCalledTimes(1)
    expect(loggerMock.error.mock.calls[0][0]).toMatch(/must contain.*main/i)
  })

  it('preserves original order of surviving entries when dedupe kicks in', () => {
    setConfig({
      agents: {
        list: [
          { id: 'main' },
          { id: 'dup', workspace: '/x' },
          { id: 'dup' }, // duplicate id — drop
          { id: 'patch', workspace: '/p' },
        ],
      },
    })

    const result = listAgents()

    expect(result.map((a) => a.id)).toEqual(['main', 'dup', 'patch'])
    expect(loggerMock.error).toHaveBeenCalledTimes(1)
    expect(loggerMock.error.mock.calls[0][0]).toMatch(/duplicate.*dup/i)
  })
})
