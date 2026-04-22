/**
 * Health plugin — /checks route + list/get hooks for the registry.
 *
 * Activates the plugin via the test helper, exercises the REST route and
 * the cross-plugin hooks, and asserts the `run` function is stripped at
 * the serialization boundary.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = vi.hoisted(() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-health-checks-route-${Date.now()}`)
})

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => `${testDir}/.openclaw`,
  getOpenClawPath: (p: string = '') => `${testDir}/.openclaw/${p}`,
}))
vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('../../../src/core/audit', () => ({ appendAudit: vi.fn() }))
vi.mock('../../../src/core/openclaw-client', () => ({
  sendMessage: vi.fn(), sendChannelMessage: vi.fn(),
}))
vi.mock('../../../src/core/watcher', () => ({ watchFiles: vi.fn() }))
vi.mock('../../../plugins/tasks/lib/flow-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))
;(globalThis as any).__bakinBroadcast = vi.fn()

import healthPlugin from '../../../plugins/health/index'
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
