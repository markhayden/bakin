import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  HealthCheckRegistrationInput,
  HealthRepairActionDefinition,
} from '@makinbakin/sdk/types'

const TEST_DIR = join(tmpdir(), `bakin-mcp-registration-${process.pid}-${Date.now()}`)
const TEST_OPENCLAW_HOME = join(TEST_DIR, '.openclaw')
const ORIGINAL_OPENCLAW_HOME = process.env.OPENCLAW_HOME
const ORIGINAL_BAKIN_HOME = process.env.BAKIN_HOME

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/content-dir', () => {
  // Require the canonical module (src/core/content-dir is a re-export shim).
  const actual = require('../../packages/core/src/content-dir') as typeof import('../../packages/core/src/content-dir')
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

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
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

beforeAll(() => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  if (!existsSync(TEST_OPENCLAW_HOME)) mkdirSync(TEST_OPENCLAW_HOME, { recursive: true })
  process.env.OPENCLAW_HOME = TEST_OPENCLAW_HOME
  process.env.BAKIN_HOME = TEST_DIR
})

afterAll(() => {
  if (ORIGINAL_OPENCLAW_HOME === undefined) delete process.env.OPENCLAW_HOME
  else process.env.OPENCLAW_HOME = ORIGINAL_OPENCLAW_HOME
  if (ORIGINAL_BAKIN_HOME === undefined) delete process.env.BAKIN_HOME
  else process.env.BAKIN_HOME = ORIGINAL_BAKIN_HOME
  try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}
})

describe('MCP server tool registration', () => {
  it('registers every script and plugin tool with valid Zod schemas', async () => {
    // 1. Importing mcp-server pulls in all six self-registering script tools.
    //    The export also gives us registerTools() so we can drive an in-process server.
    const { registerTools } = require('../../src/core/mcp-server') as typeof import('../../src/core/mcp-server')
    const { addExecTool, getAllExecTools } = require('@/core/exec-tools/registry') as typeof import('@/core/exec-tools/registry')

    // 2. Activate every plugin from bakin.config.ts using a context that
    //    forwards registerExecTool to the global addExecTool — exactly like
    //    the production plugin-registry does.
    const config = (await import('../../bakin.config')).default
    const { MarkdownStorageAdapter } = require('../../src/lib/storage/markdown-adapter') as typeof import('../../src/lib/storage/markdown-adapter')
    const { BakinEventBus } = require('../../src/lib/events/event-bus') as typeof import('../../src/lib/events/event-bus')
    const { createMockRuntimeAdapter } = require('@bakin/core/adapters/runtime/testing') as typeof import('@bakin/core/adapters/runtime/testing')

    const storage = new MarkdownStorageAdapter(TEST_DIR)
    const events = new BakinEventBus(() => {})
    const runtime = createMockRuntimeAdapter()
    const healthChecks: Array<{ id: string; definition: HealthCheckRegistrationInput }> = []
    const healthRepairActions: Array<{ id: string; definition: HealthRepairActionDefinition }> = []

    for (const entry of config.plugins) {
      const mod = await import(/* @vite-ignore */ `../../${entry.path}/index`)
      const plugin = mod.default || mod.plugin || mod
      if (!plugin || typeof plugin.activate !== 'function') continue

      const ctx = {
        storage,
        events,
        pluginId: plugin.id,
        registerNav: () => {},
        registerRoute: () => {},
        registerSlot: () => {},
        registerExecTool: (tool: import('@bakin/core/plugin-types').ExecToolDefinition) => {
          tool.source = `plugin:${plugin.id}`
          addExecTool(tool)
        },
        registerSkill: () => {},
        registerWorkflow: () => {},
        registerNodeType: (def: { kind: string }) => `${plugin.id}.${def.kind}`,
        registerNotificationChannel: (def: { id: string }) => `${plugin.id}.${def.id}`,
        registerHealthCheck: (definition: HealthCheckRegistrationInput) => {
          const id = `${plugin.id}.${definition.id}`
          healthChecks.push({ id, definition })
          return id
        },
        registerHealthRepairAction: (definition: HealthRepairActionDefinition) => {
          const id = `${plugin.id}.${definition.id}`
          healthRepairActions.push({ id, definition })
          return id
        },
        watchFiles: () => {},
        getSettings: () => ({}),
        updateSettings: () => {},
        activity: { log: () => {}, audit: () => {} },
        search: {
          registerContentType: () => {},
          registerFileBackedContentType: () => {},
          index: async () => {},
          remove: async () => {},
          transform: async () => {},
          query: async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' as const } }),
        },
        hooks: {
          register: () => () => {},
          has: () => false,
          invoke: async () => undefined,
        },
        runtime,
      }

      await plugin.activate(ctx)
    }

    const tools = getAllExecTools()
    expect(tools.length).toBeGreaterThan(50)
    expect(healthChecks.length).toBeGreaterThan(0)
    expect(healthRepairActions.length).toBeGreaterThan(0)
    expect(new Set(healthChecks.map(({ id }) => id)).size).toBe(healthChecks.length)
    expect(new Set(healthRepairActions.map(({ id }) => id)).size).toBe(healthRepairActions.length)

    // 3. Every tool's parameters must be a ZodRawShape — every value an instance
    //    of z.ZodType. The original PR #80 regression (plain object literals)
    //    fails this assertion with the offending tool name.
    const offenders: string[] = []
    for (const tool of tools) {
      if (!tool.parameters || typeof tool.parameters !== 'object') {
        offenders.push(`${tool.name}: parameters not an object`)
        continue
      }
      for (const [paramName, schema] of Object.entries(tool.parameters)) {
        if (!(schema instanceof z.ZodType)) {
          offenders.push(`${tool.name}.${paramName}: not a Zod schema`)
        }
      }
    }
    expect(offenders).toEqual([])

    // 4. Drive registerTools against a real in-process McpServer. If any
    //    tool is malformed in a way TypeScript missed, this throws.
    const server = new McpServer({ name: 'bakin-test', version: '1.0.0' })
    expect(() => registerTools(server, () => 'test-agent')).not.toThrow()
  })
})
