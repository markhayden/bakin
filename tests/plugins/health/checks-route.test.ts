/**
 * Health plugin — /checks route + list/get hooks for the registry.
 *
 * Activates the plugin via the test helper, exercises the REST route and
 * the cross-plugin hooks, and asserts the `run` function is stripped at
 * the serialization boundary.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = (() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-health-checks-route-${Date.now()}`)
})()

// ES imports are hoisted above mock.module — set env so the content-dir
// guard doesn't trip when plugin modules call getContentDir at init.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => `${testDir}/.openclaw`,
  getOpenClawPath: (p: string = '') => `${testDir}/.openclaw/${p}`,
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('../../../src/core/watcher', () => ({
  watchFiles: mock(),
  registerSyncHook: mock(() => () => {}),
  registerUnlinkHook: mock(() => () => {}),
  start: mock(),
  stop: mock(),
}))
mock.module('@/core/task-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))
;(globalThis as any).__bakinBroadcast = mock()

const healthPlugin = require('../../../plugins/health/index').default as typeof import('../../../plugins/health/index').default
import {
  registerPluginHealthCheck,
  unregisterPluginHealthChecks,
} from '../../../plugins/health/lib/health-check-registry'
import { activatePlugin, findRoute, callRoute } from '../test-helpers'
import type { ActivatedPlugin } from '../test-helpers'

let plugin: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  plugin = await activatePlugin(healthPlugin, testDir)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

afterEach(() => {
  // Clear anything tests registered — keeps the module-level registry clean
  unregisterPluginHealthChecks('test-plugin')
  unregisterPluginHealthChecks('other-plugin')
})

describe('GET /checks', () => {
  it('is registered', () => {
    expect(findRoute(plugin.routes, 'GET', '/checks')).toBeDefined()
  })

  it('returns empty array when no plugin checks are registered', async () => {
    const route = findRoute(plugin.routes, 'GET', '/checks')!
    const { status, body } = await callRoute(route, plugin.ctx)
    expect(status).toBe(200)
    expect(body.checks).toEqual([])
  })

  it('returns registered checks with metadata only (run stripped)', async () => {
    registerPluginHealthCheck('test-plugin', {
      id: 'my-check',
      name: 'My check',
      autoFix: true,
      run: async () => [],
    })

    const route = findRoute(plugin.routes, 'GET', '/checks')!
    const { body } = await callRoute(route, plugin.ctx)
    const checks = body.checks as Array<Record<string, unknown>>
    expect(checks).toHaveLength(1)
    expect(checks[0]).toEqual({
      id: 'test-plugin.my-check',
      name: 'My check',
      pluginId: 'test-plugin',
      autoFix: true,
    })
    // Make sure `run` wasn't serialized
    expect('run' in checks[0]).toBe(false)
  })

  it('returns multiple checks across plugins', async () => {
    registerPluginHealthCheck('test-plugin', {
      id: 'one', name: 'One', run: async () => [],
    })
    registerPluginHealthCheck('other-plugin', {
      id: 'one', name: 'Other One', run: async () => [],
    })

    const route = findRoute(plugin.routes, 'GET', '/checks')!
    const { body } = await callRoute(route, plugin.ctx)
    const checks = body.checks as Array<Record<string, unknown>>
    expect(checks).toHaveLength(2)
    const ids = checks.map(c => c.id).sort()
    expect(ids).toEqual(['other-plugin.one', 'test-plugin.one'])
  })

  it('autoFix defaults to false in the response when not set on registration', async () => {
    registerPluginHealthCheck('test-plugin', {
      id: 'readonly', name: 'Readonly', run: async () => [],
    })

    const route = findRoute(plugin.routes, 'GET', '/checks')!
    const { body } = await callRoute(route, plugin.ctx)
    const checks = body.checks as Array<Record<string, unknown>>
    const found = checks.find(c => c.id === 'test-plugin.readonly')!
    expect(found.autoFix).toBe(false)
  })
})
