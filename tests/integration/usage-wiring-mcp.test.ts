/**
 * Integration test: MCP tool invocation path emits usage entries.
 *
 * Proves that the recorder wiring in `src/core/mcp-server.ts`'s `registerTools`
 * callback is live end-to-end. The recorder is NOT mocked — we assert against
 * the real `getUsageFeed()` output so any regression that removes or bypasses
 * `recordUsage()` fails this test.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod'

const testDir = join(tmpdir(), `bakin-usage-wiring-mcp-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    settings: join(testDir, 'settings.json'),
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
  }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    settings: join(testDir, 'settings.json'),
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
  }),
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../src/core/watcher', () => ({
  createInboxHandler: () => () => {},
  default: { createInboxHandler: () => () => {} },
  watch: mock(),
  watchFiles: mock(),
  registerWatchPattern: mock(),
  start: mock(),
  stop: mock(),
  registerSyncHook: mock(() => () => {}),
  registerUnlinkHook: mock(() => () => {}),
}))

// Stubbing appendAudit keeps the test in-memory — otherwise tool invocations
// would try to write to the audit jsonl under testDir.
mock.module('../../src/core/audit', () => ({
  appendAudit: mock(),
}))

afterAll(() => {
  const { rmSync } = require('fs')
  rmSync(testDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Mock McpServer — captures the callback registered for each tool so we can
// invoke it directly without booting a full HTTP transport.
// ---------------------------------------------------------------------------
type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}>

function makeMockServer(): { server: any; captured: Map<string, ToolHandler> } {
  const captured = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _params: unknown, handler: ToolHandler) => {
      captured.set(name, handler)
    },
  }
  return { server, captured }
}

describe('MCP usage wiring (integration)', () => {
  beforeEach(async () => {
    const { clearUsage } = require('../../src/core/usage') as typeof import('../../src/core/usage')
    clearUsage()
  })

  it('records a successful tool invocation as an mcp usage entry', async () => {
    const { addExecTool } = require('@/core/exec-tools/registry') as typeof import('@/core/exec-tools/registry')
    const { registerTools } = require('../../src/core/mcp-server') as typeof import('../../src/core/mcp-server')
    const { getUsageFeed } = require('../../src/core/usage') as typeof import('../../src/core/usage')

    const toolName = `test_dummy_success_${Date.now()}`
    addExecTool({
      name: toolName,
      description: 'test dummy success',
      label: 'Dummy Success',
      parameters: { foo: z.string().optional() },
      handler: async () => ({ ok: true, data: 'hello' }),
    })

    const { server, captured } = makeMockServer()
    registerTools(server, () => 'testAgent')
    const handler = captured.get(toolName)
    expect(handler).toBeDefined()

    const result = await handler!({})
    expect(result.isError).toBeFalsy()

    const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
    const entry = feed.recent.find((e) => e.name === toolName)
    expect(entry).toBeDefined()
    expect(entry!.kind).toBe('mcp')
    expect(entry!.activityClass).toBe('user')
    expect(entry!.agent).toBe('testAgent')
    expect(entry!.status).toBe('ok')
    expect(entry!.durationMs).not.toBeNull()
    expect(entry!.durationMs!).toBeGreaterThanOrEqual(0)
    expect((entry!.meta as Record<string, unknown>)?.label).toBe('Dummy Success')
  })

  it('hides the successful heartbeat wrapper by default and reveals it as routine on opt-in', async () => {
    const { registerTools } = require('../../src/core/mcp-server') as typeof import('../../src/core/mcp-server')
    const { getExecTool } = require('@/core/exec-tools/registry') as typeof import('@/core/exec-tools/registry')
    const { getUsageFeed } = require('../../src/core/usage') as typeof import('../../src/core/usage')

    const heartbeat = getExecTool('bakin_exec_heartbeat')
    expect(heartbeat).toBeDefined()
    // Heartbeat does not consume PluginToolContext; leave full AppServices out
    // of this focused transport/usage integration test.
    const originalSource = heartbeat!.source
    heartbeat!.source = undefined

    try {
      const { server, captured } = makeMockServer()
      registerTools(server, () => 'testAgent')
      const handler = captured.get('bakin_exec_heartbeat')
      expect(handler).toBeDefined()

      const result = await handler!({ status: 'idle', message: 'mcp regression' })
      expect(result.isError).toBeFalsy()

      const defaultFeed = getUsageFeed({ kind: 'mcp', window: '5m' })
      expect(defaultFeed.recent.find((entry) => entry.name === 'bakin_exec_heartbeat')).toBeUndefined()

      const routineFeed = getUsageFeed({ kind: 'mcp', window: '5m', includeRoutine: true })
      const wrapper = routineFeed.recent.find((entry) => entry.name === 'bakin_exec_heartbeat')
      expect(wrapper).toMatchObject({
        activityClass: 'routine',
        agent: 'testAgent',
        status: 'ok',
      })
    } finally {
      heartbeat!.source = originalSource
    }
  })

  it('records a not-ok handler result as an error entry', async () => {
    const { addExecTool } = require('@/core/exec-tools/registry') as typeof import('@/core/exec-tools/registry')
    const { registerTools } = require('../../src/core/mcp-server') as typeof import('../../src/core/mcp-server')
    const { getUsageFeed } = require('../../src/core/usage') as typeof import('../../src/core/usage')

    const toolName = `test_dummy_notok_${Date.now()}`
    addExecTool({
      name: toolName,
      description: 'test dummy notok',
      parameters: {},
      handler: async () => ({ ok: false, error: 'nope' }),
    })

    const { server, captured } = makeMockServer()
    registerTools(server, () => 'testAgent')
    const handler = captured.get(toolName)!
    const result = await handler({})
    expect(result.isError).toBe(true)

    const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
    const entry = feed.recent.find((e) => e.name === toolName)
    expect(entry).toBeDefined()
    expect(entry!.status).toBe('error')
    expect(String((entry!.meta as Record<string, unknown>)?.error)).toContain('nope')
  })

  it('records a thrown handler exception as an error entry', async () => {
    const { addExecTool } = require('@/core/exec-tools/registry') as typeof import('@/core/exec-tools/registry')
    const { registerTools } = require('../../src/core/mcp-server') as typeof import('../../src/core/mcp-server')
    const { getUsageFeed } = require('../../src/core/usage') as typeof import('../../src/core/usage')

    const toolName = `test_dummy_throws_${Date.now()}`
    addExecTool({
      name: toolName,
      description: 'test dummy throws',
      parameters: {},
      handler: async () => {
        throw new Error('boom')
      },
    })

    const { server, captured } = makeMockServer()
    registerTools(server, () => 'testAgent')
    const handler = captured.get(toolName)!
    const result = await handler({})
    expect(result.isError).toBe(true)

    const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
    const entry = feed.recent.find((e) => e.name === toolName)
    expect(entry).toBeDefined()
    expect(entry!.status).toBe('error')
    expect(String((entry!.meta as Record<string, unknown>)?.error)).toContain('boom')
  })

  it('regression sentinel: three invocations produce count=3, errors=2', async () => {
    const { clearUsage, getUsageFeed } = require('../../src/core/usage') as typeof import('../../src/core/usage')
    const { addExecTool } = require('@/core/exec-tools/registry') as typeof import('@/core/exec-tools/registry')
    const { registerTools } = require('../../src/core/mcp-server') as typeof import('../../src/core/mcp-server')

    clearUsage()

    const stamp = Date.now()
    const names = {
      ok: `test_sentinel_ok_${stamp}`,
      notok: `test_sentinel_notok_${stamp}`,
      throws: `test_sentinel_throws_${stamp}`,
    }

    addExecTool({
      name: names.ok,
      description: 'ok',
      parameters: {},
      handler: async () => ({ ok: true }),
    })
    addExecTool({
      name: names.notok,
      description: 'notok',
      parameters: {},
      handler: async () => ({ ok: false, error: 'x' }),
    })
    addExecTool({
      name: names.throws,
      description: 'throws',
      parameters: {},
      handler: async () => {
        throw new Error('y')
      },
    })

    const { server, captured } = makeMockServer()
    registerTools(server, () => 'testAgent')

    await captured.get(names.ok)!({})
    await captured.get(names.notok)!({})
    await captured.get(names.throws)!({})

    const feed = getUsageFeed({ kind: 'mcp', window: '5m' })
    expect(feed.totals.count).toBe(3)
    expect(feed.totals.errors).toBe(2)
  })
})
