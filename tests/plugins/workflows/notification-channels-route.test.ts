/**
 * Notification channels — workflows-plugin hook + REST route integration.
 *
 * Activates the workflows plugin, then asserts that the `workflows.list*`
 * / `workflows.get*` channel hooks are wired and the GET /notification-channels
 * route returns the built-in runtime channels.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = (() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-channels-route-${Date.now()}`)
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
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('../../../src/core/openclaw-client', () => ({
  sendMessage: mock(),
  sendChannelMessage: mock(),
}))
mock.module('../../../src/core/watcher', () => ({
  watchFiles: mock(),
  registerSyncHook: mock(() => () => {}),
  registerUnlinkHook: mock(() => () => {}),
  start: mock(),
  stop: mock(),
}))
mock.module('../../../plugins/tasks/lib/flow-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))
;(globalThis as any).__bakinBroadcast = mock()

const workflowsPlugin = require('../../../plugins/workflows/index').default as typeof import('../../../plugins/workflows/index').default
import { activatePlugin, findRoute, callRoute } from '../test-helpers'
import type { ActivatedPlugin } from '../test-helpers'
import type { NotificationChannelDef } from '../../../plugins/workflows/lib/notification-channel-registry'

let plugin: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  plugin = await activatePlugin(workflowsPlugin, testDir)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('GET /notification-channels', () => {
  it('is registered', () => {
    expect(findRoute(plugin.routes, 'GET', '/notification-channels')).toBeDefined()
  })

  it('returns the built-in runtime channels', async () => {
    const route = findRoute(plugin.routes, 'GET', '/notification-channels')!
    const { status, body } = await callRoute(route, plugin.ctx)
    expect(status).toBe(200)
    const channels = body.channels as NotificationChannelDef[]
    expect(channels.length).toBeGreaterThanOrEqual(4)
    const builtinIds = channels.filter(c => c.runtime === 'builtin').map(c => c.id).sort()
    expect(builtinIds).toEqual(['alerts', 'announcements', 'email', 'general'])
  })

  it('each channel carries label, initials, and icon metadata', async () => {
    const route = findRoute(plugin.routes, 'GET', '/notification-channels')!
    const { body } = await callRoute(route, plugin.ctx)
    const channels = body.channels as NotificationChannelDef[]
    for (const channel of channels) {
      expect(channel.id).toBeDefined()
      expect(channel.label).toBeDefined()
      expect(channel.initials).toBeDefined()
      expect(channel.icon).toBeDefined()
    }
  })
})
