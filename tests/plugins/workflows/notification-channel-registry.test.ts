/**
 * Notification-channel registry — unit tests for the store shape.
 *
 * Matches the coverage pattern of node-type-registry tests: register/get/list,
 * collision, plugin namespacing, plugin teardown, and module-load seeding.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-channel-registry-${Date.now()}`)

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
mock.module('../../../plugins/tasks/lib/flow-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))

import {
  registerNotificationChannel,
  getNotificationChannel,
  listNotificationChannels,
  unregisterNotificationChannel,
  registerPluginNotificationChannel,
  unregisterPluginNotificationChannels,
} from '../../../plugins/workflows/lib/notification-channel-registry'

const BUILTIN_IDS = ['general', 'announcements', 'alerts', 'email']

// Track ids we add per-test so we can clean up without touching builtins.
const added: string[] = []
afterEach(() => {
  for (const id of added) unregisterNotificationChannel(id)
  added.length = 0
})

describe('notification-channel-registry — builtins', () => {
  it('self-registers built-in runtime channels at module load', () => {
    const all = listNotificationChannels()
    const builtinIds = all.filter(c => c.runtime === 'builtin').map(c => c.id).sort()
    expect(builtinIds).toEqual([...BUILTIN_IDS].sort())
  })

  it('builtin channels carry display metadata', () => {
    const general = getNotificationChannel('general')
    expect(general).toEqual(expect.objectContaining({
      runtime: 'builtin',
      id: 'general',
      label: 'General',
      initials: 'GE',
      icon: 'MessageSquare',
    }))
  })
})

describe('notification-channel-registry — register / get / list', () => {
  it('registers and retrieves a new channel', () => {
    registerNotificationChannel({ runtime: 'plugin', pluginId: 'test', id: 'test.mastodon', label: 'Mastodon' })
    added.push('test.mastodon')
    expect(getNotificationChannel('test.mastodon')).toEqual(expect.objectContaining({
      id: 'test.mastodon',
      label: 'Mastodon',
    }))
  })

  it('throws on duplicate id', () => {
    registerNotificationChannel({ runtime: 'plugin', pluginId: 'test', id: 'test.dupe', label: 'Dupe' })
    added.push('test.dupe')
    expect(() =>
      registerNotificationChannel({ runtime: 'plugin', pluginId: 'test', id: 'test.dupe', label: 'Again' }),
    ).toThrow(/already registered/)
  })

  it('returns undefined for unknown ids', () => {
    expect(getNotificationChannel('nope')).toBeUndefined()
  })
})

describe('notification-channel-registry — plugin helper', () => {
  it('namespaces ids as {pluginId}.{id}', () => {
    const result = registerPluginNotificationChannel('socialstack', { id: 'bluesky', label: 'Bluesky' })
    added.push(result)
    expect(result).toBe('socialstack.bluesky')
    expect(getNotificationChannel('socialstack.bluesky')?.pluginId).toBe('socialstack')
  })

  it('preserves optional display metadata on registration', () => {
    const result = registerPluginNotificationChannel('socialstack', {
      id: 'threads',
      label: 'Threads',
      initials: 'TH',
      icon: 'Feather',
    })
    added.push(result)
    const def = getNotificationChannel(result)!
    expect(def.initials).toBe('TH')
    expect(def.icon).toBe('Feather')
  })
})

describe('notification-channel-registry — plugin teardown', () => {
  it('unregisterPluginNotificationChannels removes only the named plugin', () => {
    registerPluginNotificationChannel('plugin-a', { id: 'one', label: 'A-one' })
    registerPluginNotificationChannel('plugin-a', { id: 'two', label: 'A-two' })
    registerPluginNotificationChannel('plugin-b', { id: 'one', label: 'B-one' })
    // Nothing pushed to `added` — teardown does it.

    unregisterPluginNotificationChannels('plugin-a')

    expect(getNotificationChannel('plugin-a.one')).toBeUndefined()
    expect(getNotificationChannel('plugin-a.two')).toBeUndefined()
    expect(getNotificationChannel('plugin-b.one')).toBeDefined()

    // Cleanup plugin-b's survivor.
    unregisterNotificationChannel('plugin-b.one')
  })

  it('leaves builtins untouched on plugin teardown', () => {
    registerPluginNotificationChannel('plugin-x', { id: 'one', label: 'X-one' })
    unregisterPluginNotificationChannels('plugin-x')
    const builtinIds = listNotificationChannels().filter(c => c.runtime === 'builtin').map(c => c.id)
    expect(builtinIds).toHaveLength(BUILTIN_IDS.length)
  })
})
