// @vitest-environment jsdom

/**
 * Tests for @makinbakin/sdk registerPlugin / unregisterPlugin / registry version.
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
  registerPluginCleanup,
  setNavBadge,
  getNavBadge,
} from '@makinbakin/sdk'
import {
  unregisterPlugin,
  getRegistryVersion,
  subscribeRegistry,
  getAllNavItems,
  getNavItemsSnapshot,
  getPluginNavItems,
  getPluginRoute,
  getPluginRoutes,
  getNavBadgesSnapshot,
  subscribeNavBadges,
} from '@makinbakin/sdk/internal'
import { getSlotEntries } from '@makinbakin/sdk/slots'

function NoopComp() { return null }

const USED_IDS = ['x', 'A', 'B', 'cleanup-test', 'routes', 'badge-A', 'badge-B']

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
        '/messaging': NoopComp,
        '/messaging/calendar': NoopComp,
        '/messaging/brainstorm': NoopComp,
        '/projects': NoopComp,
        '/projects/new': NoopComp,
        '/projects/:id': NoopComp,
        '/projects/[id]/edit': NoopComp,
      },
    })

    expect(getPluginRoutes('routes')).toHaveLength(7)
    expect(getPluginRoute('/messaging')).toMatchObject({
      pluginId: 'routes',
      path: '/messaging',
      params: {},
    })
    expect(getPluginRoute('/messaging/calendar')).toMatchObject({
      pluginId: 'routes',
      path: '/messaging/calendar',
      params: {},
    })
    expect(getPluginRoute('/messaging/brainstorm')).toMatchObject({
      pluginId: 'routes',
      path: '/messaging/brainstorm',
      params: {},
    })
    expect(getPluginRoute('/projects')).toMatchObject({
      pluginId: 'routes',
      path: '/projects',
      params: {},
    })
    expect(getPluginRoute('/projects/new')).toMatchObject({
      pluginId: 'routes',
      path: '/projects/new',
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

  it('prefers exact plugin routes over dynamic sibling routes', () => {
    registerPlugin({
      id: 'routes',
      routes: {
        '/projects/:id': NoopComp,
        '/projects/new': NoopComp,
      },
    })

    expect(getPluginRoute('/projects/new')).toMatchObject({
      pluginId: 'routes',
      path: '/projects/new',
      params: {},
    })
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

describe('nav badge registry', () => {
  it('set then get returns the badge', () => {
    setNavBadge('badge-A', 'badge-A-item', { count: 3, tone: 'attention' })
    expect(getNavBadge('badge-A-item')).toEqual({ count: 3, tone: 'attention' })
  })

  it('passing null clears the badge', () => {
    setNavBadge('badge-A', 'badge-A-item', { count: 3 })
    expect(getNavBadge('badge-A-item')).toEqual({ count: 3 })
    setNavBadge('badge-A', 'badge-A-item', null)
    expect(getNavBadge('badge-A-item')).toBeUndefined()
  })

  it('two plugins setting different navItemIds are isolated and both visible', () => {
    setNavBadge('badge-A', 'badge-A-item', { count: 1 })
    setNavBadge('badge-B', 'badge-B-item', { count: 2, tone: 'info' })
    expect(getNavBadge('badge-A-item')).toEqual({ count: 1 })
    expect(getNavBadge('badge-B-item')).toEqual({ count: 2, tone: 'info' })
  })

  it('unregisterPlugin clears the unregistering plugin\'s badges', () => {
    setNavBadge('badge-A', 'badge-A-item', { count: 1 })
    setNavBadge('badge-B', 'badge-B-item', { count: 2 })
    unregisterPlugin('badge-A')
    expect(getNavBadge('badge-A-item')).toBeUndefined()
    expect(getNavBadge('badge-B-item')).toEqual({ count: 2 })
  })

  it('re-registering plugin A after unregister starts with no stale badges', () => {
    setNavBadge('badge-A', 'badge-A-item', { count: 1 })
    unregisterPlugin('badge-A')
    expect(getNavBadge('badge-A-item')).toBeUndefined()
    registerPlugin({ id: 'badge-A' })
    expect(getNavBadge('badge-A-item')).toBeUndefined()
  })

  it('subscribeNavBadges fires on badge mutation', () => {
    const listener = mock()
    const unsub = subscribeNavBadges(listener)
    setNavBadge('badge-A', 'badge-A-item', { count: 1 })
    expect(listener).toHaveBeenCalledTimes(1)
    setNavBadge('badge-A', 'badge-A-item', null)
    expect(listener).toHaveBeenCalledTimes(2)
    unsub()
    setNavBadge('badge-A', 'badge-A-item', { count: 1 })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('is idempotent — a set with an identical value does not fire subscribers or rebuild the snapshot', () => {
    setNavBadge('badge-A', 'badge-A-item', { count: 3, tone: 'attention' })
    const snapshot = getNavBadgesSnapshot()
    const listener = mock()
    const unsub = subscribeNavBadges(listener)

    // Same value → no-op: no tick, same snapshot identity.
    setNavBadge('badge-A', 'badge-A-item', { count: 3, tone: 'attention' })
    expect(listener).not.toHaveBeenCalled()
    expect(getNavBadgesSnapshot()).toBe(snapshot)

    // Changed count → fires.
    setNavBadge('badge-A', 'badge-A-item', { count: 4, tone: 'attention' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getNavBadgesSnapshot()).not.toBe(snapshot)

    // Changed tone only → fires.
    setNavBadge('badge-A', 'badge-A-item', { count: 4, tone: 'error' })
    expect(listener).toHaveBeenCalledTimes(2)
    unsub()
  })

  it('stores a copy — a mutated-and-resubmitted object still updates (no self-compare drop)', () => {
    const badge = { count: 1, tone: 'attention' as const }
    setNavBadge('badge-A', 'badge-A-item', badge)
    badge.count = 9 // mutate the same object the caller passed in
    const listener = mock()
    const unsub = subscribeNavBadges(listener)
    setNavBadge('badge-A', 'badge-A-item', badge) // resubmit the mutated object
    expect(listener).toHaveBeenCalledTimes(1) // not skipped as a self-compare no-op
    expect(getNavBadge('badge-A-item')).toEqual({ count: 9, tone: 'attention' })
    unsub()
  })

  it('subscribeNavBadges does NOT fire on plain registerPlugin nav mutations', () => {
    const listener = mock()
    const unsub = subscribeNavBadges(listener)
    registerPlugin({ id: 'badge-A', navItems: [{ id: 'badge-A-item', label: 'A', href: '/a' }] })
    expect(listener).not.toHaveBeenCalled()
    unsub()
  })

  it('getNavBadgesSnapshot returns a stable reference until mutation', () => {
    const before = getNavBadgesSnapshot()
    expect(getNavBadgesSnapshot()).toBe(before)
    setNavBadge('badge-A', 'badge-A-item', { count: 1 })
    const after = getNavBadgesSnapshot()
    expect(after).not.toBe(before)
    expect(after.get('badge-A-item')).toEqual({ count: 1 })
    expect(getNavBadgesSnapshot()).toBe(after)
  })

  it('unregisterPlugin notifies badge subscribers when the plugin had badges', () => {
    setNavBadge('badge-A', 'badge-A-item', { count: 1 })
    const listener = mock()
    const unsub = subscribeNavBadges(listener)
    unregisterPlugin('badge-A')
    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
  })
})
