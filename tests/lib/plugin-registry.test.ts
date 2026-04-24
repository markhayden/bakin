import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-plugin-registry-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
}))
mock.module('@bakin/tasks/lib/flow-store', () => ({}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))

// Spy on the logger so we can assert collisions are logged but contained.
// Hoisted so it's defined before vi.mock's factory runs at import time
// (test-helpers calls createLogger() at module load).
const { errorLog } = (() => ({ errorLog: mock() }))()
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: errorLog,
    debug: mock(),
  }),
}))

import {
  clearSourceRegistry,
  getDefinition,
} from '@bakin/workflows/lib/source-registry'
import type { BakinPlugin, PluginContext } from '@/lib/plugin-types'
import { activatePlugin } from '../plugins/test-helpers'

function makeWorkflowsPlugin(
  body: (ctx: PluginContext) => void,
  id = 'test-plugin',
): BakinPlugin {
  return {
    id,
    name: id,
    version: '1.0.0',
    activate: (ctx) => {
      body(ctx)
    },
  }
}

describe('PluginContext.registerWorkflow', () => {
  beforeEach(() => {
    clearSourceRegistry()
    errorLog.mockClear()
  })
  afterEach(() => {
    clearSourceRegistry()
  })

  it('registers a workflow under the calling plugin id', async () => {
    const plugin = makeWorkflowsPlugin((ctx) => {
      ctx.registerWorkflow({
        id: 'my-wf',
        name: 'My Workflow',
        description: 'demo',
        version: 1,
        steps: [{ id: 's1', type: 'agent', label: 'Do', agent: 'chef' }],
      })
    }, 'plugin-a')

    await activatePlugin(plugin, testDir)

    const entry = getDefinition('my-wf')
    expect(entry).toBeDefined()
    expect(entry!.source).toBe('plugin')
    expect(entry!.pluginId).toBe('plugin-a')
    expect(entry!.definition.name).toBe('My Workflow')
  })

  it('falls back to slug(name) when the definition has no id', async () => {
    const plugin = makeWorkflowsPlugin((ctx) => {
      ctx.registerWorkflow({
        name: 'My Cool Workflow',
        description: 'no id',
        version: 1,
        steps: [{ id: 's1', type: 'agent', label: 'Do', agent: 'chef' }],
      })
    }, 'plugin-a')

    await activatePlugin(plugin, testDir)

    const entry = getDefinition('my-cool-workflow')
    expect(entry).toBeDefined()
  })

  it('contains a cross-plugin id collision (logs error, does not throw out of activate)', async () => {
    // First plugin registers id 'shared'
    const pluginA = makeWorkflowsPlugin((ctx) => {
      ctx.registerWorkflow({
        id: 'shared',
        name: 'A',
        description: 'a',
        version: 1,
        steps: [{ id: 's1', type: 'agent', label: 'Do', agent: 'chef' }],
      })
    }, 'plugin-a')
    await activatePlugin(pluginA, testDir)

    // Second plugin tries to claim 'shared' — must NOT throw
    const pluginB = makeWorkflowsPlugin((ctx) => {
      ctx.registerWorkflow({
        id: 'shared',
        name: 'B',
        description: 'b',
        version: 1,
        steps: [{ id: 's1', type: 'agent', label: 'Do', agent: 'chef' }],
      })
    }, 'plugin-b')

    await expect(activatePlugin(pluginB, testDir)).resolves.toBeDefined()

    // Original entry untouched
    const entry = getDefinition('shared')
    expect(entry!.pluginId).toBe('plugin-a')
    expect(entry!.definition.name).toBe('A')

    // Error was logged
    expect(errorLog).toHaveBeenCalled()
    const logged = errorLog.mock.calls.flat().join(' ')
    expect(logged).toMatch(/shared/)
  })

  it('lets the same plugin re-register the same id (hot reload)', async () => {
    const ids: string[] = []
    const pluginA = makeWorkflowsPlugin((ctx) => {
      ctx.registerWorkflow({
        id: 'wf',
        name: ids.length === 0 ? 'First' : 'Second',
        description: 'd',
        version: 1,
        steps: [{ id: 's1', type: 'agent', label: 'Do', agent: 'chef' }],
      })
      ids.push('called')
    }, 'plugin-a')

    await activatePlugin(pluginA, testDir)
    // Simulate hot reload by re-activating the same plugin
    await expect(activatePlugin(pluginA, testDir)).resolves.toBeDefined()

    const entry = getDefinition('wf')
    expect(entry!.pluginId).toBe('plugin-a')
    expect(entry!.definition.name).toBe('Second')
  })
})
