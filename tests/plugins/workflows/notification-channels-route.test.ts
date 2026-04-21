/**
 * Notification channels — workflows-plugin hook + REST route integration.
 *
 * Activates the workflows plugin, then asserts that the `workflows.list*`
 * / `workflows.get*` channel hooks are wired and the GET /notification-channels
 * route returns the seven built-in channels.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = vi.hoisted(() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-channels-route-${Date.now()}`)
})

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('../../../src/core/audit', () => ({ appendAudit: vi.fn() }))
vi.mock('../../../src/core/openclaw-client', () => ({
  sendMessage: vi.fn(),
  sendChannelMessage: vi.fn(),
}))
vi.mock('../../../src/core/watcher', () => ({ watchFiles: vi.fn() }))
vi.mock('../../../plugins/tasks/lib/flow-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))
;(globalThis as any).__bakinBroadcast = vi.fn()

import workflowsPlugin from '../../../plugins/workflows/index'
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

  it('returns the seven built-in channels', async () => {
    const route = findRoute(plugin.routes, 'GET', '/notification-channels')!
    const { status, body } = await callRoute(route, plugin.ctx)
    expect(status).toBe(200)
    const channels = body.channels as NotificationChannelDef[]
    expect(channels.length).toBeGreaterThanOrEqual(7)
    const builtinIds = channels.filter(c => c.runtime === 'builtin').map(c => c.id).sort()
    expect(builtinIds).toEqual(['discord', 'email', 'instagram', 'slack', 'tiktok', 'twitter', 'youtube'])
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
