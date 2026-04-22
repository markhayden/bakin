/**
 * Bridge verification test (issue #81, item 4 — Main Operator's concern).
 *
 * Confirms that when an exec tool throws, the real error message reaches
 * the MCP client (and therefore the agent) intact — not normalized into
 * a generic "internal error" string.
 *
 * Drives a real in-process MCP Client → McpServer pair via InMemoryTransport.
 * If the bridge ever starts swallowing error text, this test fails with the
 * actual normalized payload so we can hand it back to OpenClaw.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const TEST_DIR = join(tmpdir(), `bakin-mcp-bridge-${process.pid}-${Date.now()}`)
const ORIGINAL_BAKIN_HOME = process.env.BAKIN_HOME

vi.mock('../../src/core/content-dir', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/content-dir')>(
    '../../src/core/content-dir',
  )
  return {
    ...actual,
    getContentDir: () => TEST_DIR,
    getBakinPaths: () => ({
      home: TEST_DIR,
      assets: join(TEST_DIR, 'assets'),
      audit: join(TEST_DIR, 'audit.jsonl'),
      heartbeats: join(TEST_DIR, 'heartbeats'),
      inbox: join(TEST_DIR, 'inbox'),
      pluginSettings: join(TEST_DIR, 'plugin-settings'),
      schedule: join(TEST_DIR, 'schedule'),
      workflows: join(TEST_DIR, 'workflows'),
      projects: join(TEST_DIR, 'projects'),
      team: join(TEST_DIR, 'team'),
      messaging: join(TEST_DIR, 'messaging'),
      docs: join(TEST_DIR, 'docs'),
      settings: join(TEST_DIR, 'settings.json'),
      memory: join(TEST_DIR, 'MEMORY-LOG.md'),
      plugins: join(TEST_DIR, 'plugins'),
      logs: join(TEST_DIR, 'logs'),
    }),
    isUsingBakinHome: () => false,
  }
})

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

beforeAll(() => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  process.env.BAKIN_HOME = TEST_DIR
})

afterAll(() => {
  if (ORIGINAL_BAKIN_HOME === undefined) delete process.env.BAKIN_HOME
  else process.env.BAKIN_HOME = ORIGINAL_BAKIN_HOME
  try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}
})

const UNIQUE_ERROR_MARKER = 'BRIDGE_TEST_UNIQUE_8d3f1c0a_should_pass_through'

describe('MCP bridge error passthrough', () => {
  it('forwards thrown handler error text to the client unchanged', async () => {
    const { registerTools } = await import('../../src/core/mcp-server')
    const registry = await import('../../scripts/lib/registry')
    const { addExecTool } = registry

    // Stub getToolContext — this test only cares about handler-error
    // passthrough, not the real PluginToolContext wiring.
    vi.spyOn(registry, 'getToolContext').mockReturnValue(undefined)

    addExecTool({
      name: 'bakin_exec_test_throw',
      label: 'Test throw',
      description: 'Throws on call. Used by the bridge passthrough test.',
      source: 'core',
      parameters: { reason: z.string().optional().describe('Optional reason') },
      handler: async () => {
        throw new Error(UNIQUE_ERROR_MARKER)
      },
    })

    const server = new McpServer({ name: 'bakin-bridge-test', version: '1.0.0' })
    registerTools(server, () => 'test-agent')

    const client = new Client({ name: 'bridge-test-client', version: '1.0.0' })

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    try {
      const result = await client.callTool({
        name: 'bakin_exec_test_throw',
        arguments: {},
      })

      // Tool errors come back as content with isError: true (not as protocol errors)
      expect(result.isError).toBe(true)
      const content = result.content as Array<{ type: string; text?: string }>
      expect(Array.isArray(content)).toBe(true)
      const text = content.map(c => c.text || '').join('\n')

      // The real error string must survive the bridge.
      expect(text).toContain(UNIQUE_ERROR_MARKER)
    } finally {
      await client.close()
      await server.close()
    }
  })
})
