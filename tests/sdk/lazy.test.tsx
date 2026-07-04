// @vitest-environment jsdom

/**
 * Tests for @makinbakin/sdk lazy plugin loading — the manifest-nav channel
 * (`setManifestNav`) and the lazy load-state store (`configureLazyPlugins`,
 * demand requests, retry, Slot integration).
 *
 * Both stores are browser-global, so each test cleans up the ids it used.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

// Defensive content-dir mocks per CLAUDE.md test-isolation rules.
mock.module('../../src/core/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-sdk-lazy-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
mock.module('../../packages/core/src/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-sdk-lazy-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})

import {
  configureLazyPlugins,
  getAllNavItems,
  getManifestNav,
  getNavItemsSnapshot,
  getPluginLoadError,
  getPluginLoadState,
  getRouteOwners,
  getSlotOwners,
  registerPlugin,
  requestAllPlugins,
  requestRoutePlugins,
  requestSlotPlugins,
  retryPluginLoad,
  setLazyPluginLoader,
  setManifestNav,
  setPluginLoadState,
  unregisterPlugin,
} from '@makinbakin/sdk'
import { Slot } from '@makinbakin/sdk/slots'

const USED_IDS = ['lz-a', 'lz-b']

afterEach(() => {
  for (const id of USED_IDS) {
    unregisterPlugin(id)
    setManifestNav(id, null)
    setPluginLoadState(id, 'idle')
  }
  configureLazyPlugins({ slotOwners: new Map(), routeOwners: [] })
  setLazyPluginLoader(null)
  cleanup()
})

describe('setManifestNav — declarative nav channel', () => {
  it('seeds nav items that appear in the merged snapshot', () => {
    setManifestNav('lz-a', [{ id: 'lz-a-nav', label: 'Lazy A', href: '/lz-a', order: 5 }])
    expect(getAllNavItems().map((i) => i.id)).toContain('lz-a-nav')
    expect(getManifestNav('lz-a')).toHaveLength(1)
  })

  it('survives unregisterPlugin (hot-swap teardown)', () => {
    setManifestNav('lz-a', [{ id: 'lz-a-nav', label: 'Lazy A', href: '/lz-a' }])
    registerPlugin({ id: 'lz-a', slots: {} })
    unregisterPlugin('lz-a')
    expect(getAllNavItems().map((i) => i.id)).toContain('lz-a-nav')
  })

  it('is overridden by runtime navItems while registered (escape hatch)', () => {
    setManifestNav('lz-a', [{ id: 'lz-a-manifest', label: 'Manifest', href: '/lz-a' }])
    registerPlugin({
      id: 'lz-a',
      navItems: [{ id: 'lz-a-runtime', label: 'Runtime', href: '/lz-a' }],
    })
    const ids = getAllNavItems().map((i) => i.id)
    expect(ids).toContain('lz-a-runtime')
    expect(ids).not.toContain('lz-a-manifest')

    // Teardown restores the manifest nav.
    unregisterPlugin('lz-a')
    expect(getAllNavItems().map((i) => i.id)).toContain('lz-a-manifest')
  })

  it('clears via null and skips version churn on identical re-seed', () => {
    setManifestNav('lz-a', [{ id: 'lz-a-nav', label: 'Lazy A', href: '/lz-a' }])
    const snapshot = getNavItemsSnapshot()
    setManifestNav('lz-a', [{ id: 'lz-a-nav', label: 'Lazy A', href: '/lz-a' }])
    expect(getNavItemsSnapshot()).toBe(snapshot) // identity stable — no bump
    setManifestNav('lz-a', null)
    expect(getAllNavItems().map((i) => i.id)).not.toContain('lz-a-nav')
  })
})

describe('lazy plugin store — ownership + demand', () => {
  it('routes slot demand to the installed loader for idle owners only', () => {
    const loaded: string[] = []
    configureLazyPlugins({
      slotOwners: new Map([['page:/lz-a', ['lz-a']], ['shared-slot', ['lz-a', 'lz-b']]]),
      routeOwners: [],
    })
    setLazyPluginLoader((id) => {
      loaded.push(id)
      setPluginLoadState(id, 'loading')
    })

    requestSlotPlugins('page:/lz-a')
    expect(loaded).toEqual(['lz-a'])

    // lz-a is now loading — only lz-b is still idle.
    requestSlotPlugins('shared-slot')
    expect(loaded).toEqual(['lz-a', 'lz-b'])

    // Nothing is idle anymore; repeat demand is a no-op.
    requestSlotPlugins('shared-slot')
    expect(loaded).toEqual(['lz-a', 'lz-b'])
  })

  it('matches route owners against dynamic patterns', () => {
    configureLazyPlugins({
      slotOwners: new Map(),
      routeOwners: [
        { pattern: '/lz-a', pluginId: 'lz-a' },
        { pattern: '/lz-a/[id]', pluginId: 'lz-a' },
        { pattern: '/lz-b/:id/edit', pluginId: 'lz-b' },
      ],
    })
    expect(getRouteOwners('/lz-a')).toEqual(['lz-a'])
    expect(getRouteOwners('/lz-a/42')).toEqual(['lz-a'])
    expect(getRouteOwners('/lz-b/7/edit')).toEqual(['lz-b'])
    expect(getRouteOwners('/elsewhere')).toEqual([])

    const loaded: string[] = []
    setLazyPluginLoader((id) => {
      loaded.push(id)
      setPluginLoadState(id, 'loading')
    })
    requestRoutePlugins('/lz-a/42')
    expect(loaded).toEqual(['lz-a'])
  })

  it('tracks load state + error message, and retryPluginLoad re-demands', () => {
    configureLazyPlugins({ slotOwners: new Map([['page:/lz-a', ['lz-a']]]), routeOwners: [] })
    const loads: string[] = []
    setLazyPluginLoader((id) => {
      loads.push(id)
      setPluginLoadState(id, 'loading')
    })

    requestSlotPlugins('page:/lz-a')
    expect(getPluginLoadState('lz-a')).toBe('loading')
    setPluginLoadState('lz-a', 'error', 'import failed')
    expect(getPluginLoadError('lz-a')).toBe('import failed')

    retryPluginLoad('lz-a')
    expect(loads).toEqual(['lz-a', 'lz-a'])
    expect(getPluginLoadError('lz-a')).toBeUndefined()

    // retry on a non-errored plugin is a no-op
    setPluginLoadState('lz-a', 'loaded')
    retryPluginLoad('lz-a')
    expect(loads).toEqual(['lz-a', 'lz-a'])
  })

  it('demand without a loader is a safe no-op', () => {
    configureLazyPlugins({ slotOwners: new Map([['page:/lz-a', ['lz-a']]]), routeOwners: [] })
    expect(() => requestSlotPlugins('page:/lz-a')).not.toThrow()
    expect(getPluginLoadState('lz-a')).toBe('idle')
    expect(getSlotOwners('page:/lz-a')).toEqual(['lz-a'])
  })

  it('requestAllPlugins demands every idle plugin in the ownership index', () => {
    const loaded: string[] = []
    configureLazyPlugins({
      slotOwners: new Map([['page:/lz-a', ['lz-a']], ['shared-slot', ['lz-a', 'lz-b']]]),
      routeOwners: [{ pattern: 'page:/lz-c/[id]', pluginId: 'lz-c' }],
    })
    setLazyPluginLoader((id) => {
      loaded.push(id)
      setPluginLoadState(id, 'loading')
    })
    setPluginLoadState('lz-b', 'loaded') // already loaded — must be skipped

    requestAllPlugins()
    expect(loaded.sort()).toEqual(['lz-a', 'lz-c'])

    // Everything settled; repeat demand is a no-op.
    requestAllPlugins()
    expect(loaded.sort()).toEqual(['lz-a', 'lz-c'])
  })
})

describe('Slot — lazy integration', () => {
  it('rendering a slot demands its idle owners', async () => {
    configureLazyPlugins({ slotOwners: new Map([['page:/lz-a', ['lz-a']]]), routeOwners: [] })
    const loaded: string[] = []
    setLazyPluginLoader((id) => {
      loaded.push(id)
      setPluginLoadState(id, 'loading')
    })

    render(<Slot name="page:/lz-a" />)
    await waitFor(() => expect(loaded).toEqual(['lz-a']))
  })

  it('shows an error fallback with retry when an owner fails to load', async () => {
    configureLazyPlugins({ slotOwners: new Map([['page:/lz-a', ['lz-a']]]), routeOwners: [] })
    const loads: string[] = []
    setLazyPluginLoader((id) => {
      loads.push(id)
      setPluginLoadState(id, 'loading')
    })

    render(<Slot name="page:/lz-a" />)
    await waitFor(() => expect(loads).toEqual(['lz-a']))

    act(() => { setPluginLoadState('lz-a', 'error', 'boom') })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('"lz-a" failed to load'))
    expect(screen.getByRole('alert').textContent).toContain('boom')

    // Retry → loader fires again → content registers → fallback gone.
    act(() => { screen.getByRole('button', { name: /retry/i }).click() })
    expect(loads).toEqual(['lz-a', 'lz-a'])
    act(() => {
      registerPlugin({ id: 'lz-a', slots: { 'page:/lz-a': () => <span data-testid="lz-content">loaded</span> } })
      setPluginLoadState('lz-a', 'loaded')
    })
    await waitFor(() => expect(screen.getByTestId('lz-content')).toBeDefined())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('isolates a crashing slot entry behind a per-entry boundary', async () => {
    const consoleError = mock(() => {})
    const originalError = console.error
    console.error = consoleError
    try {
      function Crashing(): never {
        throw new Error('plugin render crash')
      }
      registerPlugin({ id: 'lz-a', slots: { 'shared-slot': Crashing } })
      registerPlugin({ id: 'lz-b', slots: { 'shared-slot': () => <span data-testid="lz-b-ok">ok</span> } })

      render(<Slot name="shared-slot" />)
      await waitFor(() => expect(screen.getByTestId('lz-b-ok')).toBeDefined())
      expect(screen.getByRole('alert').textContent).toContain('"lz-a" failed to render')
    } finally {
      console.error = originalError
    }
  })
})
