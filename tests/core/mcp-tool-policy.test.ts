import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const TEST_DIR = join(tmpdir(), `bakin-mcp-policy-${process.pid}-${Date.now()}`)
const ORIGINAL_BAKIN_HOME = process.env.BAKIN_HOME
const appendAuditMock = mock()

process.env.BAKIN_HOME = TEST_DIR

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../src/core/audit', () => ({
  appendAudit: appendAuditMock,
}))

mock.module('../../src/core/watcher', () => ({
  watch: mock(),
  watchFiles: mock(),
  registerWatchPattern: mock(),
  start: mock(),
  stop: mock(),
  registerSyncHook: mock(() => () => {}),
  registerUnlinkHook: mock(() => () => {}),
}))

afterAll(() => {
  if (ORIGINAL_BAKIN_HOME === undefined) delete process.env.BAKIN_HOME
  else process.env.BAKIN_HOME = ORIGINAL_BAKIN_HOME
  try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}
})

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(TEST_DIR, { recursive: true })
  process.env.BAKIN_HOME = TEST_DIR
  appendAuditMock.mockClear()

  const { clearUsage } = require('../../src/core/usage') as typeof import('../../src/core/usage')
  clearUsage()
})

describe('MCP tool policy', () => {
  it('lists and invokes only tools allowed by a managed agent package', async () => {
    const suffix = `managed_${Date.now()}`
    const allowedTool = `bakin_exec_policy_allowed_${suffix}`
    const blockedTool = `bakin_exec_policy_blocked_${suffix}`
    registerDummyTool(allowedTool)
    registerDummyTool(blockedTool)
    writeAgentPackage('pixel', 'managed', [allowedTool])

    const { client, close } = await connectPolicyClient('pixel')
    try {
      const listed = await client.listTools()
      const names = listed.tools.map((tool) => tool.name)
      expect(names).toContain(allowedTool)
      expect(names).not.toContain(blockedTool)

      const allowed = await client.callTool({ name: allowedTool, arguments: {} })
      expect(allowed.isError).toBeFalsy()

      const denied = await client.callTool({ name: blockedTool, arguments: {} })
      expect(denied.isError).toBe(true)
      const deniedText = toolText(denied)
      expect(deniedText).toContain(blockedTool)
      expect(deniedText).toContain('pixel')
      expect(appendAuditMock).toHaveBeenCalledWith(
        TEST_DIR,
        `exec.${blockedTool}.denied`,
        'pixel',
        expect.objectContaining({ reason: expect.any(String) }),
        'mcp',
      )
    } finally {
      await close()
    }
  })

  it('supports wildcard package allowlists', async () => {
    const suffix = `wildcard_${Date.now()}`
    const allowedTool = `bakin_exec_policy_assets_${suffix}`
    const blockedTool = `bakin_exec_policy_tasks_${suffix}`
    registerDummyTool(allowedTool)
    registerDummyTool(blockedTool)
    writeAgentPackage('pixel', 'managed', ['bakin_exec_policy_assets_*'])

    const { client, close } = await connectPolicyClient('pixel')
    try {
      const listed = await client.listTools()
      const names = listed.tools.map((tool) => tool.name)
      expect(names).toContain(allowedTool)
      expect(names).not.toContain(blockedTool)
    } finally {
      await close()
    }
  })

  it('scopes adopted agents when their package declares allowedTools', async () => {
    const suffix = `adopted_${Date.now()}`
    const allowedTool = `bakin_exec_policy_adopted_allowed_${suffix}`
    const blockedTool = `bakin_exec_policy_adopted_blocked_${suffix}`
    registerDummyTool(allowedTool)
    registerDummyTool(blockedTool)
    writeAgentPackage('pixel', 'adopted', [allowedTool])

    const { client, close } = await connectPolicyClient('pixel')
    try {
      const listed = await client.listTools()
      const names = listed.tools.map((tool) => tool.name)
      expect(names).toContain(allowedTool)
      expect(names).not.toContain(blockedTool)

      const allowed = await client.callTool({ name: allowedTool, arguments: {} })
      expect(allowed.isError).toBeFalsy()

      const denied = await client.callTool({ name: blockedTool, arguments: {} })
      expect(denied.isError).toBe(true)
      expect(toolText(denied)).toContain('allowedTools policy')
    } finally {
      await close()
    }
  })

  it('keeps adopted agents with no package policy unrestricted until configured', async () => {
    const toolName = `bakin_exec_policy_adopted_unconfigured_${Date.now()}`
    registerDummyTool(toolName)
    writeAgentPackage('pixel', 'adopted', undefined)

    const { client, close } = await connectPolicyClient('pixel')
    try {
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name)).toContain(toolName)

      const result = await client.callTool({ name: toolName, arguments: {} })
      expect(result.isError).toBeFalsy()
    } finally {
      await close()
    }
  })

  it('fails closed for managed agents whose package has no tool policy', async () => {
    const toolName = `bakin_exec_policy_missing_${Date.now()}`
    registerDummyTool(toolName)
    writeAgentPackage('pixel', 'managed', undefined)

    const { client, close } = await connectPolicyClient('pixel')
    try {
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name)).not.toContain(toolName)

      const denied = await client.callTool({ name: toolName, arguments: {} })
      expect(denied.isError).toBe(true)
      expect(toolText(denied)).toContain('no allowedTools policy')
    } finally {
      await close()
    }
  })

  it('keeps unmanaged legacy agents permissive', async () => {
    const toolName = `bakin_exec_policy_legacy_${Date.now()}`
    registerDummyTool(toolName)
    writeEmptyLockfile()

    const { client, close } = await connectPolicyClient('legacy')
    try {
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name)).toContain(toolName)

      const result = await client.callTool({ name: toolName, arguments: {} })
      expect(result.isError).toBeFalsy()
    } finally {
      await close()
    }
  })
})

function registerDummyTool(name: string): void {
  const { addExecTool } = require('../../scripts/lib/registry') as typeof import('../../scripts/lib/registry')
  addExecTool({
    name,
    label: `Dummy ${name}`,
    description: `Dummy tool ${name}`,
    parameters: { value: z.string().optional() },
    handler: async () => ({ ok: true, name }),
  })
}

async function connectPolicyClient(agentId: string): Promise<{ client: Client; close: () => Promise<void> }> {
  const { registerTools } = require('../../src/core/mcp-server') as typeof import('../../src/core/mcp-server')
  const server = new McpServer({ name: `bakin-policy-${agentId}`, version: '1.0.0' })
  registerTools(server, () => agentId)

  const client = new Client({ name: `policy-client-${agentId}`, version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])

  return {
    client,
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}

function writeEmptyLockfile(): void {
  const { writeLockfile } = require('../../packages/core/src/agent-packages/lockfile') as typeof import('../../packages/core/src/agent-packages/lockfile')
  writeLockfile({ version: 1, packages: {} })
}

function writeAgentPackage(
  agentId: string,
  state: 'managed' | 'adopted',
  allowedTools: string[] | undefined,
): void {
  const {
    writeLockfile,
  } = require('../../packages/core/src/agent-packages/lockfile') as typeof import('../../packages/core/src/agent-packages/lockfile')
  const {
    getPackageSourceDir,
  } = require('../../packages/core/src/agent-packages/package-paths') as typeof import('../../packages/core/src/agent-packages/package-paths')

  writeLockfile({
    version: 1,
    packages: {
      [agentId]: {
        kind: 'agent',
        version: '0.1.0',
        source: `github:markhayden/bakin-agent-${agentId}`,
        ref: 'v0.1.0',
        commitSha: 'abc123',
        installedAt: '2026-04-30T00:00:00Z',
        state,
        agentId,
        projections: [],
        lessonsEnabled: [],
      },
    },
  })

  const packageDir = getPackageSourceDir(TEST_DIR, 'agent', agentId, '0.1.0')
  mkdirSync(packageDir, { recursive: true })
  const agentStanza: Record<string, unknown> = {
    identity: { name: agentId },
  }
  if (allowedTools !== undefined) agentStanza.allowedTools = allowedTools
  writeFileSync(
    join(packageDir, 'bakin-package.json'),
    JSON.stringify({
      id: agentId,
      kind: 'agent',
      name: agentId,
      version: '0.1.0',
      agent: agentStanza,
      install: {},
      contributions: {},
    }, null, 2),
    'utf-8',
  )
}

function toolText(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content
  return content?.map((entry) => entry.text ?? '').join('\n') ?? ''
}
