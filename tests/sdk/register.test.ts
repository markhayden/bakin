// @vitest-environment jsdom

/**
 * Tests for @bakin/sdk registerPlugin / unregisterPlugin / registry version.
 *
 * The registry is browser-global, so between-test isolation explicitly
 * unregisters any plugin ids used by the test.
 */
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'

// Defensive content-dir mock per CLAUDE.md test-isolation rules.
mock.module('../../src/core/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-sdk-register-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
mock.module('../../packages/core/src/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-sdk-register-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})

import {
  registerPlugin,
  unregisterPlugin,
  registerPluginCleanup,
  getRegistryVersion,
  subscribeRegistry,
  getAllNavItems,
  getNavItemsSnapshot,
  getPluginNavItems,
  getPluginRoute,
  getPluginRoutes,
} from '@bakin/sdk'
import { getSlotEntries } from '@bakin/sdk/slots'

function NoopComp() { return null }

const USED_IDS = ['x', 'A', 'B', 'cleanup-test', 'routes']

afterEach(() => {
  for (const id of USED_IDS) unregisterPlugin(id)
})

describe('unregisterPlugin — per-plugin teardown', () => {
  it('drops nav items + owned slot entries, and re-registering works', () => {
    registerPlugin({
      id: 'x',
      navItems: [{ id: 'x-nav', label: 'X', href: '/x' }],
      slots: { 'test.slot': NoopComp },
    })

    expect(getPluginNavItems('x')).toHaveLength(1)
    expect(getAllNavItems().some((n) => n.id === 'x-nav')).toBe(true)
    expect(getSlotEntries('test.slot')).toHaveLength(1)

    unregisterPlugin('x')

    expect(getPluginNavItems('x')).toHaveLength(0)
    expect(getAllNavItems().some((n) => n.id === 'x-nav')).toBe(false)
    expect(getSlotEntries('test.slot')).toHaveLength(0)

    // Re-register succeeds.
    registerPlugin({
      id: 'x',
      navItems: [{ id: 'x-nav', label: 'X2', href: '/x' }],
      slots: { 'test.slot': NoopComp },
    })
    expect(getPluginNavItems('x')[0].label).toBe('X2')
    expect(getSlotEntries('test.slot')).toHaveLength(1)
  })
})

describe('unregisterPlugin — cross-plugin isolation', () => {
  it('removes only the target plugin\'s slot entries', () => {
    registerPlugin({ id: 'A', slots: { 'shared': NoopComp } })
    registerPlugin({ id: 'B', slots: { 'shared': NoopComp } })
    expect(getSlotEntries('shared')).toHaveLength(2)

    unregisterPlugin('A')
    const entries = getSlotEntries('shared')
    expect(entries).toHaveLength(1)
    expect(entries[0].owner).toBe('B')
  })
})

describe('client route registry', () => {
  it('registers and matches exact and dynamic plugin routes', () => {
    registerPlugin({
      id: 'routes',
      routes: {
        '/messaging/calendar': NoopComp,
        '/projects/:id': NoopComp,
        '/projects/[id]/edit': NoopComp,
      },
    })

    expect(getPluginRoutes('routes')).toHaveLength(3)
    expect(getPluginRoute('/messaging/calendar')).toMatchObject({
      pluginId: 'routes',
      path: '/messaging/calendar',
      params: {},
    })
    expect(getPluginRoute('/projects/abc-123')).toMatchObject({
      pluginId: 'routes',
      path: '/projects/:id',
      params: { id: 'abc-123' },
    })
    expect(getPluginRoute('/projects/abc-123/edit')).toMatchObject({
      pluginId: 'routes',
      path: '/projects/[id]/edit',
      params: { id: 'abc-123' },
    })
  })

  it('removes route entries on unregister', () => {
    registerPlugin({ id: 'routes', routes: { '/x': NoopComp } })
    expect(getPluginRoute('/x')).not.toBeNull()
    unregisterPlugin('routes')
    expect(getPluginRoute('/x')).toBeNull()
  })
})

describe('registerPluginCleanup', () => {
  it('runs enrolled cleanup fns when the plugin is unregistered', () => {
    const spy = mock()
    registerPlugin({ id: 'cleanup-test' })
    registerPluginCleanup('cleanup-test', spy)

    unregisterPlugin('cleanup-test')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('is idempotent — unregister twice runs cleanup exactly once', () => {
    const spy = mock()
    registerPlugin({ id: 'cleanup-test' })
    registerPluginCleanup('cleanup-test', spy)

    unregisterPlugin('cleanup-test')
    unregisterPlugin('cleanup-test')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('runs multiple cleanup fns in registration order', () => {
    const calls: string[] = []
    registerPlugin({ id: 'cleanup-test' })
    registerPluginCleanup('cleanup-test', () => calls.push('first'))
    registerPluginCleanup('cleanup-test', () => calls.push('second'))

    unregisterPlugin('cleanup-test')
    expect(calls).toEqual(['first', 'second'])
  })

  it('swallows errors thrown by a cleanup fn so subsequent ones still run', () => {
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const later = mock()
    registerPlugin({ id: 'cleanup-test' })
    registerPluginCleanup('cleanup-test', () => { throw new Error('boom') })
    registerPluginCleanup('cleanup-test', later)

    unregisterPlugin('cleanup-test')
    expect(later).toHaveBeenCalledTimes(1)
    consoleErrorSpy.mockRestore()
  })
})

describe('getRegistryVersion + subscribeRegistry', () => {
  it('bumps on every register and unregister', () => {
    const before = getRegistryVersion()
    registerPlugin({ id: 'x' })
    const afterRegister = getRegistryVersion()
    expect(afterRegister).toBeGreaterThan(before)

    unregisterPlugin('x')
    const afterUnregister = getRegistryVersion()
    expect(afterUnregister).toBeGreaterThan(afterRegister)
  })

  it('notifies subscribers on every mutation', () => {
    const listener = mock()
    const unsubscribe = subscribeRegistry(listener)

    registerPlugin({ id: 'x' })
    expect(listener).toHaveBeenCalledTimes(1)

    unregisterPlugin('x')
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    registerPlugin({ id: 'x' })
    expect(listener).toHaveBeenCalledTimes(2)  // no further calls after unsubscribe
  })

  it('exposes a stable nav snapshot for useSyncExternalStore', () => {
    const before = getNavItemsSnapshot()
    expect(getNavItemsSnapshot()).toBe(before)

    registerPlugin({ id: 'x', navItems: [{ id: 'x-nav', label: 'X', href: '/x' }] })
    const afterRegister = getNavItemsSnapshot()
    expect(afterRegister).not.toBe(before)
    expect(afterRegister.some((item) => item.id === 'x-nav')).toBe(true)
    expect(getNavItemsSnapshot()).toBe(afterRegister)

    const copy = getAllNavItems()
    expect(copy).toEqual([...afterRegister])
    expect(copy).not.toBe(afterRegister)

    unregisterPlugin('x')
    expect(getNavItemsSnapshot()).not.toBe(afterRegister)
  })
})
