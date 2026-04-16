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
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, readFileSync, existsSync } from 'fs'

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

// Settings — needed by openclawExec for binaryPath
vi.mock('../../../src/core/settings', () => ({
  getSettings: () => ({
    openclaw: { binaryPath: '/usr/bin/openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
  }),
  resetSettingsCache: vi.fn(),
}))

// child_process — mock execFile for CLI shell-outs
const execFileMock = vi.hoisted(() => vi.fn((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
  cb(null, { stdout: '{}', stderr: '' })
}))
vi.mock('child_process', () => ({
  execFile: execFileMock,
}))

// The module under test — drive config shapes through this mock.
const { readOpenClawConfigMock, resetOpenClawConfigCacheMock } = vi.hoisted(() => ({
  readOpenClawConfigMock: vi.fn(() => null as unknown),
  resetOpenClawConfigCacheMock: vi.fn(),
}))
vi.mock('@bakin/core/openclaw-config', () => ({
  readOpenClawConfig: () => readOpenClawConfigMock(),
  resetOpenClawConfigCache: resetOpenClawConfigCacheMock,
}))

// ---------------------------------------------------------------------------
// Import after mocks are declared
// ---------------------------------------------------------------------------

import {
  listAgents, addAgent, removeAgent, removeFromAllowLists,
  openclawExec, synthesizeIdentityMd, addToAllowLists,
  setSubagentPermissions, parseIdentityMd, updateAgentIdentity,
} from '../../../plugins/team/lib/openclaw-adapter'

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
          { id: 'main-operator' },
        ],
      },
    })

    const result = listAgents()

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('main')
    expect(loggerMock.error).toHaveBeenCalledTimes(1)
    const msg = loggerMock.error.mock.calls[0][0] as string
    expect(msg).toMatch(/workspace.*shared/i)
    expect(msg).toContain('main-operator')
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

// ---------------------------------------------------------------------------
// synthesizeIdentityMd
// ---------------------------------------------------------------------------

describe('team/openclaw-adapter · synthesizeIdentityMd', () => {
  it('includes only non-empty fields', () => {
    const md = synthesizeIdentityMd({ name: 'Pixel', emoji: '🖼️', role: 'Image Artist' })
    expect(md).toContain('**Name:** Pixel')
    expect(md).toContain('**Emoji:** 🖼️')
    expect(md).toContain('**Role:** Image Artist')
    expect(md).not.toContain('**Vibe:**')
    expect(md).not.toContain('**Primary Function:**')
    expect(md).not.toContain('**Default Mode:**')
  })

  it('includes all fields when provided', () => {
    const md = synthesizeIdentityMd({
      name: 'Jessica Fetcher',
      emoji: '🔎',
      role: 'Research Agent',
      vibe: 'Sharp, credible',
      primaryFunction: 'Multi-source research',
      defaultMode: 'Broad discovery first',
    })
    expect(md).toContain('**Name:** Jessica Fetcher')
    expect(md).toContain('**Vibe:** Sharp, credible')
    expect(md).toContain('**Primary Function:** Multi-source research')
    expect(md).toContain('**Default Mode:** Broad discovery first')
  })

  it('starts with the header', () => {
    const md = synthesizeIdentityMd({ name: 'Test' })
    expect(md.startsWith('# IDENTITY.md\n')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// openclawExec
// ---------------------------------------------------------------------------

describe('team/openclaw-adapter · openclawExec', () => {
  beforeEach(() => {
    execFileMock.mockClear()
    execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: '{"ok": true}', stderr: '' })
    })
  })

  it('calls execFile with the binary path from settings', async () => {
    await openclawExec(['agents', 'list', '--json'])
    expect(execFileMock).toHaveBeenCalledTimes(1)
    const [bin, args] = execFileMock.mock.calls[0]
    expect(bin).toBe('/usr/bin/openclaw')
    expect(args).toEqual(['agents', 'list', '--json'])
  })

  it('returns stdout on success', async () => {
    const result = await openclawExec(['agents', 'list'])
    expect(result).toBe('{"ok": true}')
  })

  it('throws on non-zero exit', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
      cb(new Error('Command failed: openclaw agents add'))
    })
    await expect(openclawExec(['agents', 'add', 'bad'])).rejects.toThrow('Command failed')
  })
})

// ---------------------------------------------------------------------------
// addAgent (async CLI adapter)
// ---------------------------------------------------------------------------

describe('team/openclaw-adapter · addAgent', () => {
  beforeEach(() => {
    execFileMock.mockClear()
    loggerMock.info.mockClear()
    loggerMock.error.mockClear()
    readOpenClawConfigMock.mockReset()
    resetOpenClawConfigCacheMock.mockClear()
    execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: '{}', stderr: '' })
    })
  })

  afterAll(() => {
    // Clean up any workspace dirs created in the temp openclaw dir
    const openclawDir = join(testDir, 'openclaw', 'workspaces')
    if (existsSync(openclawDir)) {
      rmSync(openclawDir, { recursive: true, force: true })
    }
  })

  it('shells out to openclaw agents add with correct args', async () => {
    setConfig({ agents: { list: [{ id: 'main' }] } })

    // Ensure workspace dir parent exists
    mkdirSync(join(testDir, 'openclaw', 'workspaces'), { recursive: true })

    await addAgent({ id: 'pixel', name: 'Pixel', emoji: '🖼️' })

    // First call: agents add
    const addCall = execFileMock.mock.calls[0]
    expect(addCall[0]).toBe('/usr/bin/openclaw')
    expect(addCall[1]).toContain('agents')
    expect(addCall[1]).toContain('add')
    expect(addCall[1]).toContain('pixel')
    expect(addCall[1]).toContain('--non-interactive')
    expect(addCall[1]).toContain('--json')

    // Second call: agents set-identity
    const identityCall = execFileMock.mock.calls[1]
    expect(identityCall[1]).toContain('set-identity')
    expect(identityCall[1]).toContain('--agent')
    expect(identityCall[1]).toContain('pixel')
    expect(identityCall[1]).toContain('--name')
    expect(identityCall[1]).toContain('Pixel')
    expect(identityCall[1]).toContain('--emoji')
    expect(identityCall[1]).toContain('🖼️')
  })

  it('includes --model when model is provided', async () => {
    setConfig({ agents: { list: [{ id: 'main' }] } })
    mkdirSync(join(testDir, 'openclaw', 'workspaces'), { recursive: true })

    await addAgent({ id: 'test-model', name: 'Test', model: 'anthropic/claude-sonnet-4-6' })

    const addArgs = execFileMock.mock.calls[0][1] as string[]
    expect(addArgs).toContain('--model')
    expect(addArgs).toContain('anthropic/claude-sonnet-4-6')
  })

  it('writes IDENTITY.md to the workspace', async () => {
    setConfig({ agents: { list: [{ id: 'main' }] } })
    mkdirSync(join(testDir, 'openclaw', 'workspaces'), { recursive: true })

    await addAgent({ id: 'id-test', name: 'IdTest', role: 'Tester', vibe: 'Calm' })

    const wsPath = join(testDir, 'openclaw', 'workspaces', 'id-test')
    const identity = readFileSync(join(wsPath, 'IDENTITY.md'), 'utf-8')
    expect(identity).toContain('**Name:** IdTest')
    expect(identity).toContain('**Role:** Tester')
    expect(identity).toContain('**Vibe:** Calm')
  })

  it('writes SOUL.md when soul is provided', async () => {
    setConfig({ agents: { list: [{ id: 'main' }] } })
    mkdirSync(join(testDir, 'openclaw', 'workspaces'), { recursive: true })

    await addAgent({ id: 'soul-test', name: 'SoulTest', soul: 'You are a test agent.' })

    const wsPath = join(testDir, 'openclaw', 'workspaces', 'soul-test')
    const soul = readFileSync(join(wsPath, 'SOUL.md'), 'utf-8')
    expect(soul).toBe('You are a test agent.')
  })

  it('writes TOOLS.md when tools is provided', async () => {
    setConfig({ agents: { list: [{ id: 'main' }] } })
    mkdirSync(join(testDir, 'openclaw', 'workspaces'), { recursive: true })

    await addAgent({ id: 'tools-test', name: 'ToolsTest', tools: '# Tools\n- search' })

    const wsPath = join(testDir, 'openclaw', 'workspaces', 'tools-test')
    const tools = readFileSync(join(wsPath, 'TOOLS.md'), 'utf-8')
    expect(tools).toBe('# Tools\n- search')
  })

  it('throws when agent already exists', async () => {
    setConfig({ agents: { list: [{ id: 'main' }, { id: 'pixel' }] } })

    await expect(addAgent({ id: 'pixel', name: 'Pixel' })).rejects.toThrow('already exists')
  })

  it('busts the config cache after creation', async () => {
    setConfig({ agents: { list: [{ id: 'main' }] } })
    mkdirSync(join(testDir, 'openclaw', 'workspaces'), { recursive: true })

    await addAgent({ id: 'cache-test', name: 'CacheTest' })

    expect(resetOpenClawConfigCacheMock).toHaveBeenCalled()
  })

  it('returns the id and workspace path', async () => {
    setConfig({ agents: { list: [{ id: 'main' }] } })
    mkdirSync(join(testDir, 'openclaw', 'workspaces'), { recursive: true })

    const result = await addAgent({ id: 'ret-test', name: 'RetTest' })

    expect(result.id).toBe('ret-test')
    expect(result.workspace).toContain('workspaces/ret-test')
  })
})

// ---------------------------------------------------------------------------
// removeAgent (async CLI adapter)
// ---------------------------------------------------------------------------

describe('team/openclaw-adapter · removeAgent', () => {
  beforeEach(() => {
    execFileMock.mockClear()
    loggerMock.info.mockClear()
    loggerMock.error.mockClear()
    readOpenClawConfigMock.mockReset()
    resetOpenClawConfigCacheMock.mockClear()
    execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: '{}', stderr: '' })
    })
  })

  it('shells out to openclaw agents delete with correct args', async () => {
    setConfig({ agents: { list: [{ id: 'main' }, { id: 'pixel' }] } })

    await removeAgent('pixel')

    expect(execFileMock).toHaveBeenCalledTimes(1)
    const [bin, args] = execFileMock.mock.calls[0]
    expect(bin).toBe('/usr/bin/openclaw')
    expect(args).toEqual(['agents', 'delete', 'pixel', '--force', '--json'])
  })

  it('returns true on success', async () => {
    setConfig({ agents: { list: [{ id: 'main' }, { id: 'pixel' }] } })
    const result = await removeAgent('pixel')
    expect(result).toBe(true)
  })

  it('returns false when agent does not exist in roster', async () => {
    setConfig({ agents: { list: [{ id: 'main' }] } })
    const result = await removeAgent('nonexistent')
    expect(result).toBe(false)
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('returns false when CLI fails', async () => {
    setConfig({ agents: { list: [{ id: 'main' }, { id: 'pixel' }] } })
    execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
      cb(new Error('CLI failed'))
    })

    const result = await removeAgent('pixel')
    expect(result).toBe(false)
    expect(loggerMock.error).toHaveBeenCalled()
  })

  it('busts the config cache after deletion', async () => {
    setConfig({ agents: { list: [{ id: 'main' }, { id: 'pixel' }] } })
    await removeAgent('pixel')
    expect(resetOpenClawConfigCacheMock).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// removeFromAllowLists
// ---------------------------------------------------------------------------

describe('team/openclaw-adapter · removeFromAllowLists', () => {
  beforeEach(() => {
    loggerMock.info.mockClear()
    readOpenClawConfigMock.mockReset()
    resetOpenClawConfigCacheMock.mockClear()
    // Ensure the openclaw.json directory exists for writeFileSync
    mkdirSync(join(testDir, 'openclaw'), { recursive: true })
  })

  it('removes the agent from all allowAgents lists', () => {
    setConfig({
      agents: {
        list: [
          { id: 'main', subagents: { allowAgents: ['pixel', 'patch', 'chef'] } },
          { id: 'chef', subagents: { allowAgents: ['pixel', 'rolo'] } },
          { id: 'patch' },
        ],
      },
    })

    removeFromAllowLists('pixel')

    // Verify the written JSON
    const written = JSON.parse(readFileSync(join(testDir, 'openclaw', 'openclaw.json'), 'utf-8'))
    expect(written.agents.list[0].subagents.allowAgents).toEqual(['patch', 'chef'])
    expect(written.agents.list[1].subagents.allowAgents).toEqual(['rolo'])
  })

  it('does nothing when agent is not in any allow list', () => {
    setConfig({
      agents: {
        list: [
          { id: 'main', subagents: { allowAgents: ['pixel'] } },
        ],
      },
    })

    removeFromAllowLists('nonexistent')

    expect(resetOpenClawConfigCacheMock).not.toHaveBeenCalled()
  })

  it('handles agents with no subagents field gracefully', () => {
    setConfig({
      agents: {
        list: [
          { id: 'main' },
          { id: 'pixel' },
        ],
      },
    })

    removeFromAllowLists('pixel')
    expect(resetOpenClawConfigCacheMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// addToAllowLists
// ---------------------------------------------------------------------------

describe('team/openclaw-adapter · addToAllowLists', () => {
  beforeEach(() => {
    readOpenClawConfigMock.mockReset()
    resetOpenClawConfigCacheMock.mockClear()
    loggerMock.info.mockClear()
    mkdirSync(join(testDir, 'openclaw'), { recursive: true })
  })

  it('dispatchable "main" adds to main only', () => {
    setConfig({
      agents: {
        list: [
          { id: 'main', subagents: { allowAgents: ['pixel'] } },
          { id: 'chef', subagents: { allowAgents: ['rolo'] } },
        ],
      },
    })

    addToAllowLists('jessica', 'main')

    const written = JSON.parse(readFileSync(join(testDir, 'openclaw', 'openclaw.json'), 'utf-8'))
    expect(written.agents.list[0].subagents.allowAgents).toEqual(['pixel', 'jessica'])
    expect(written.agents.list[1].subagents.allowAgents).toEqual(['rolo'])
  })

  it('dispatchable "all" adds to every agent', () => {
    setConfig({
      agents: {
        list: [
          { id: 'main', subagents: { allowAgents: ['pixel'] } },
          { id: 'chef' },
          { id: 'jessica' },
        ],
      },
    })

    addToAllowLists('jessica', 'all')

    const written = JSON.parse(readFileSync(join(testDir, 'openclaw', 'openclaw.json'), 'utf-8'))
    expect(written.agents.list[0].subagents.allowAgents).toContain('jessica')
    expect(written.agents.list[1].subagents.allowAgents).toContain('jessica')
    // Should not add self
    expect(written.agents.list[2].subagents?.allowAgents ?? []).not.toContain('jessica')
  })

  it('dispatchable string[] adds to specific agents plus main', () => {
    setConfig({
      agents: {
        list: [
          { id: 'main', subagents: { allowAgents: ['pixel'] } },
          { id: 'chef' },
          { id: 'explorer' },
        ],
      },
    })

    addToAllowLists('jessica', ['chef'])

    const written = JSON.parse(readFileSync(join(testDir, 'openclaw', 'openclaw.json'), 'utf-8'))
    expect(written.agents.list[0].subagents.allowAgents).toContain('jessica')
    expect(written.agents.list[1].subagents.allowAgents).toContain('jessica')
    expect(written.agents.list[2].subagents?.allowAgents ?? []).not.toContain('jessica')
  })

  it('does not add duplicates', () => {
    setConfig({
      agents: {
        list: [
          { id: 'main', subagents: { allowAgents: ['jessica'] } },
        ],
      },
    })

    addToAllowLists('jessica', 'main')
    expect(resetOpenClawConfigCacheMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// setSubagentPermissions
// ---------------------------------------------------------------------------

describe('team/openclaw-adapter · setSubagentPermissions', () => {
  beforeEach(() => {
    readOpenClawConfigMock.mockReset()
    resetOpenClawConfigCacheMock.mockClear()
    loggerMock.info.mockClear()
    mkdirSync(join(testDir, 'openclaw'), { recursive: true })
  })

  it('sets the allowAgents list on the target agent', () => {
    setConfig({
      agents: {
        list: [
          { id: 'main', subagents: { allowAgents: ['pixel'] } },
          { id: 'chef' },
        ],
      },
    })

    setSubagentPermissions('main', ['pixel', 'chef', 'jessica'])

    const written = JSON.parse(readFileSync(join(testDir, 'openclaw', 'openclaw.json'), 'utf-8'))
    expect(written.agents.list[0].subagents.allowAgents).toEqual(['pixel', 'chef', 'jessica'])
  })

  it('throws when agent not found', () => {
    setConfig({ agents: { list: [{ id: 'main' }] } })
    expect(() => setSubagentPermissions('ghost', ['pixel'])).toThrow('not found')
  })

  it('throws on self-referencing', () => {
    setConfig({ agents: { list: [{ id: 'main' }] } })
    expect(() => setSubagentPermissions('main', ['main'])).toThrow('cannot dispatch to itself')
  })

  it('creates subagents field if it does not exist', () => {
    setConfig({ agents: { list: [{ id: 'main' }] } })

    setSubagentPermissions('main', ['pixel'])

    const written = JSON.parse(readFileSync(join(testDir, 'openclaw', 'openclaw.json'), 'utf-8'))
    expect(written.agents.list[0].subagents.allowAgents).toEqual(['pixel'])
  })
})

// ---------------------------------------------------------------------------
// parseIdentityMd
// ---------------------------------------------------------------------------

describe('team/openclaw-adapter · parseIdentityMd', () => {
  it('parses structured fields from IDENTITY.md format', () => {
    const content = [
      '# IDENTITY.md',
      '',
      '- **Name:** Jessica Fetcher',
      '- **Role:** Research Agent',
      '- **Emoji:** 🔎',
      '- **Vibe:** Sharp, credible',
      '',
    ].join('\n')

    const parsed = parseIdentityMd(content)
    expect(parsed['Name']).toBe('Jessica Fetcher')
    expect(parsed['Role']).toBe('Research Agent')
    expect(parsed['Emoji']).toBe('🔎')
    expect(parsed['Vibe']).toBe('Sharp, credible')
  })

  it('returns empty for content with no structured fields', () => {
    expect(parseIdentityMd('just some text')).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// updateAgentIdentity
// ---------------------------------------------------------------------------

describe('team/openclaw-adapter · updateAgentIdentity', () => {
  const pixelWs = join(testDir, 'openclaw', 'workspaces', 'pixel')

  beforeEach(() => {
    execFileMock.mockClear()
    loggerMock.info.mockClear()
    readOpenClawConfigMock.mockReset()
    resetOpenClawConfigCacheMock.mockClear()
    execFileMock.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: '{}', stderr: '' })
    })
    mkdirSync(pixelWs, { recursive: true })
  })

  it('shells out to set-identity when name changes', async () => {
    setConfig({ agents: { list: [{ id: 'main' }, { id: 'pixel' }] } })

    await updateAgentIdentity('pixel', { name: 'Pixel 2.0' })

    const args = execFileMock.mock.calls[0][1] as string[]
    expect(args).toContain('set-identity')
    expect(args).toContain('--name')
    expect(args).toContain('Pixel 2.0')
  })

  it('returns list of updated fields', async () => {
    setConfig({ agents: { list: [{ id: 'main' }, { id: 'pixel' }] } })

    const updated = await updateAgentIdentity('pixel', { name: 'Pixel', role: 'Artist', soul: 'New soul' })

    expect(updated).toContain('name')
    expect(updated).toContain('role')
    expect(updated).toContain('soul')
  })

  it('throws when agent does not exist', async () => {
    setConfig({ agents: { list: [{ id: 'main' }] } })

    await expect(updateAgentIdentity('ghost', { name: 'Ghost' })).rejects.toThrow('not found')
  })

  it('does not call set-identity when only structured fields change', async () => {
    setConfig({ agents: { list: [{ id: 'main' }, { id: 'pixel' }] } })

    await updateAgentIdentity('pixel', { role: 'New Role', vibe: 'Calm' })

    expect(execFileMock).not.toHaveBeenCalled()
  })
})
