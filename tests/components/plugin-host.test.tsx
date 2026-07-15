// @vitest-environment jsdom

/**
 * Integration test for PluginHost's v2 hot-swap wiring.
 *
 * Exercises the invariants that make hot-swap actually update the
 * browser without a page reload:
 *
 *   1. PluginHost boots — fetches manifest, dynamic-imports each plugin,
 *      flips ready, renders children.
 *   2. `window.__bakinHotSwapPlugin` is exposed iff the dev-client
 *      script tag is in the document.
 *   3. Calling the hot-swap handle runs unregisterPlugin synchronously
 *      before the dynamic import, so a deliberately-failing URL still
 *      proves teardown happened.
 *   4. Consumers of the registry (tested via <Slot>) re-render when
 *      registrations change. This is what makes hot-swap visible in
 *      the DOM — PluginHost's own useSyncExternalStore subscription
 *      doesn't propagate to children whose props didn't change, so
 *      each registry consumer (Slot, AppSidebar) owns its own.
 *
 * The actual dynamic import() of a plugin bundle can't be cleanly
 * mocked in jsdom (no module loader for arbitrary URLs), so #3 asserts
 * the synchronous side effect (registry drop) and relies on the SDK-
 * level unregisterPlugin tests (tests/sdk/register.test.ts) to cover
 * the rest of the mechanism.
 */
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { render, screen, waitFor, act } from '@testing-library/react'
import '../rtl-settle'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { StrictMode } from 'react'

// Per CLAUDE.md — defensive content-dir mocks even for pure React tests.
mock.module('../../src/core/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-plugin-host-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
mock.module('../../packages/core/src/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-plugin-host-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})

import {
  PluginHost,
  PLUGIN_BOOT_TIMEOUTS,
  DEFAULT_IMPORT_TIMEOUT_MS,
  DEFAULT_MANIFEST_TIMEOUT_MS,
  __resetPluginBootForTests,
} from '../../packages/host/src/plugin-host/PluginHost'
import { registerPlugin } from '@makinbakin/sdk'
import {
  configureLazyPlugins,
  getAllNavItems,
  getPluginLoadState,
  setManifestNav,
  setPluginLoadState,
  unregisterPlugin,
} from '@makinbakin/sdk/internal'
import { Slot } from '@makinbakin/sdk/slots'

function SlotPage() {
  return <span data-testid="slot-content">rendered-from-x</span>
}

function AltSlotPage() {
  return <span data-testid="slot-content">rendered-from-x-v2</span>
}

function ProbeTree() {
  // A Slot consumer — this is the real pattern that propagates
  // registry changes through to the DOM. Slot's own subscription is
  // what makes it re-render when a plugin hot-swaps.
  return (
    <div>
      <Slot name="page:/probe" />
    </div>
  )
}

function injectDevScriptTag() {
  const s = document.createElement('script')
  s.setAttribute('type', 'application/json')
  s.setAttribute('src', '/__bakin-dev/client.js')
  document.head.appendChild(s)
}

function removeDevScriptTag() {
  document.head
    .querySelectorAll('script[src="/__bakin-dev/client.js"]')
    .forEach((el) => el.remove())
}

const EMPTY_MANIFEST = { plugins: [] }

const USED_IDS = ['x', 'y', 'hung']

beforeEach(() => {
  // Module-scoped manifest cache + boot promise must not leak across tests
  // (refreshManifest deliberately falls back to the last-known manifest).
  __resetPluginBootForTests()
  // Mock fetch so PluginHost's manifest load resolves deterministically.
  vi.stubGlobal('fetch', mock(async (url: string) => {
    if (url === '/api/plugins/manifest') {
      return new Response(JSON.stringify(EMPTY_MANIFEST), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('not found', { status: 404 })
  }))
})

afterEach(() => {
  removeDevScriptTag()
  for (const id of USED_IDS) {
    unregisterPlugin(id)
    setManifestNav(id, null)
    setPluginLoadState(id, 'idle')
  }
  configureLazyPlugins({ slotOwners: new Map(), routeOwners: [] })
  delete (window as unknown as { __bakinHotSwapPlugin?: unknown }).__bakinHotSwapPlugin
  delete (window as unknown as { __bakinStartupSpans?: unknown }).__bakinStartupSpans
  delete (globalThis as Record<string, unknown>).__bakinHotSwapRegister
  delete (globalThis as Record<string, unknown>).__bakinHotSwapImportCount
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('PluginHost — boot', () => {
  it('shows a loader while the manifest request is pending', () => {
    vi.stubGlobal('fetch', mock(() => new Promise(() => {})))

    render(
      <PluginHost>
        <ProbeTree />
      </PluginHost>,
    )

    expect(screen.getByText('Loading plugins')).toBeDefined()
  })

  it('renders children after the manifest fetch resolves', async () => {
    render(
      <PluginHost>
        <ProbeTree />
      </PluginHost>,
    )
    await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull())
  })

  it('bounds a hung manifest fetch and surfaces an error panel with retry', async () => {
    // A server restart under an open tab can leave the manifest fetch
    // hanging forever — previously an infinite "Loading plugins" spinner.
    PLUGIN_BOOT_TIMEOUTS.manifestMs = 50
    try {
      let attempts = 0
      vi.stubGlobal('fetch', mock((_url: string, init?: RequestInit) => {
        attempts++
        if (attempts === 1) {
          // Hang until aborted by the boot timeout signal.
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          })
        }
        return Promise.resolve(new Response(JSON.stringify(EMPTY_MANIFEST), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
      }))

      render(
        <PluginHost>
          <ProbeTree />
        </PluginHost>,
      )

      const panel = await screen.findByTestId('plugin-boot-error')
      expect(panel.textContent).toMatch(/plugins/i)

      // Retry re-runs the boot against the now-healthy server.
      await act(async () => {
        screen.getByRole('button', { name: /retry/i }).click()
      })
      await waitFor(() => expect(screen.queryByTestId('plugin-boot-error')).toBeNull())
      await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull())
    } finally {
      PLUGIN_BOOT_TIMEOUTS.manifestMs = DEFAULT_MANIFEST_TIMEOUT_MS
    }
  })

  it('surfaces the error panel when the manifest fetch rejects outright', async () => {
    vi.stubGlobal('fetch', mock(() => Promise.reject(new TypeError('socket died'))))
    render(
      <PluginHost>
        <ProbeTree />
      </PluginHost>,
    )
    await screen.findByTestId('plugin-boot-error')
    // The broken app is NOT rendered behind the panel.
    expect(screen.queryByTestId('slot-content')).toBeNull()
  })

  it('renders the app plus a failure banner when an eager plugin bundle fails', async () => {
    vi.stubGlobal('fetch', mock(async (url: string) => {
      if (url === '/api/plugins/manifest') {
        return new Response(JSON.stringify({
          plugins: [{
            id: 'x',
            name: 'X',
            status: 'active',
            // Legacy shape (no contributes metadata) → eager import; the
            // URL rejects, which must NOT block boot.
            clientEntry: pathToFileURL(join(tmpdir(), 'bakin-nonexistent-bundle.mjs')).href,
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('not found', { status: 404 })
    }))

    render(
      <PluginHost>
        <ProbeTree />
      </PluginHost>,
    )

    await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull())
    const banner = await screen.findByTestId('plugin-boot-failures')
    expect(banner.textContent).toContain('x')
    // App still usable; banner is dismissible.
    await act(async () => {
      screen.getByRole('button', { name: /dismiss/i }).click()
    })
    expect(screen.queryByTestId('plugin-boot-failures')).toBeNull()
  })

  it('shares in-flight boot work during React StrictMode remounts', async () => {
    const fetchMock = mock(async (url: string) => {
      if (url === '/api/plugins/manifest') {
        return new Response(JSON.stringify(EMPTY_MANIFEST), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <StrictMode>
        <PluginHost>
          <ProbeTree />
        </PluginHost>
      </StrictMode>,
    )
    await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull())

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('emits browser plugin boot diagnostics when explicitly enabled', async () => {
    window.localStorage.setItem('bakin:plugin-diagnostics', '1')
    const moduleDir = mkdtempSync(join(tmpdir(), 'bakin-plugin-host-boot-diag-'))
    const modulePath = join(moduleDir, 'client.mjs')
    writeFileSync(modulePath, 'export default {};\n')
    const clientEntry = pathToFileURL(modulePath).href
    vi.stubGlobal('fetch', mock(async (url: string) => {
      if (url === '/api/plugins/manifest') {
        return new Response(JSON.stringify({
          plugins: [{
            id: 'x',
            name: 'X',
            version: '1.0.0',
            clientEntry,
            clientVersion: 'diag',
            status: 'active',
          }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    }))
    const consoleDebug = spyOn(console, 'debug').mockImplementation(() => {})
    const originalGetEntriesByType = window.performance.getEntriesByType
    // Anchor mock entries to live performance.now(): the resource-summary
    // filter compares entry times against real boot timestamps, and bun runs
    // the whole suite in one process — absolute times (startTime: 0,
    // responseEnd: 100_000) fall outside the boot window once the process has
    // been up >100s, silently dropping the resourceSummary span.
    const bootBase = performance.now()
    Object.defineProperty(window.performance, 'getEntriesByType', {
      configurable: true,
      value: mock((type: string) => type === 'resource'
        ? [
            {
              name: 'http://localhost/api/plugins/x/assets/client.js?v=diag',
              initiatorType: 'script',
              startTime: bootBase,
              responseEnd: bootBase + 100_000,
              duration: 123.45,
              transferSize: 2048,
              encodedBodySize: 1024,
              decodedBodySize: 4096,
            },
            {
              name: 'http://localhost/node_modules/.vite/deps/react.js',
              initiatorType: 'script',
              startTime: bootBase,
              responseEnd: bootBase + 100_000,
              duration: 20,
              transferSize: 512,
              encodedBodySize: 256,
              decodedBodySize: 1024,
            },
          ]
        : []),
    })

    try {
      render(
        <PluginHost>
          <ProbeTree />
        </PluginHost>,
      )
      // This is the one boot test that does a real dynamic import() of a file://
      // module, so boot can cross waitFor's default 1000ms under full-suite load
      // (the other boot tests use empty manifests). Give it headroom.
      await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull(), { timeout: 5000 })

      expect(consoleDebug).toHaveBeenCalledWith('[bakin] startup span', expect.objectContaining({
        category: 'startup',
        phase: 'browser-plugin-host',
        span: 'pluginHost.manifestFetch',
        status: 'ok',
        count: 1,
      }))
      expect(consoleDebug).toHaveBeenCalledWith('[bakin] startup span', expect.objectContaining({
        category: 'startup',
        phase: 'browser-plugin-host',
        span: 'pluginHost.clientImport',
        status: 'ok',
        pluginId: 'x',
      }))
      expect(consoleDebug).toHaveBeenCalledWith('[bakin] startup span', expect.objectContaining({
        category: 'startup',
        phase: 'browser-plugin-host',
        span: 'pluginHost.boot',
        status: 'ok',
        count: 1,
      }))
      expect(consoleDebug).toHaveBeenCalledWith('[bakin] startup span', expect.objectContaining({
        category: 'startup',
        phase: 'browser-plugin-host',
        span: 'pluginHost.resourceSummary',
        status: 'ok',
        count: 2,
        totalTransferBytes: 2560,
        slowest: expect.arrayContaining([
          expect.objectContaining({
            resource: 'plugin:x:client.js',
            initiatorType: 'script',
            durationMs: 123.45,
            transferBytes: 2048,
          }),
        ]),
      }))
      const spans = (window as unknown as { __bakinStartupSpans?: Array<Record<string, unknown>> })
        .__bakinStartupSpans ?? []
      expect(spans).toContainEqual(expect.objectContaining({
        category: 'startup',
        phase: 'browser-plugin-host',
        span: 'pluginHost.resourceSummary',
      }))
    } finally {
      Object.defineProperty(window.performance, 'getEntriesByType', {
        configurable: true,
        value: originalGetEntriesByType,
      })
      consoleDebug.mockRestore()
      rmSync(moduleDir, { recursive: true, force: true })
    }
  })
})

describe('PluginHost — window.__bakinHotSwapPlugin bridge', () => {
  it('does NOT expose the handle when the dev-client script tag is absent', async () => {
    render(
      <PluginHost>
        <ProbeTree />
      </PluginHost>,
    )
    await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull())
    expect((window as unknown as { __bakinHotSwapPlugin?: unknown }).__bakinHotSwapPlugin)
      .toBeUndefined()
  })

  it('exposes the handle when the dev-client script tag is present', async () => {
    const consoleDebug = spyOn(console, 'debug').mockImplementation(() => {})
    injectDevScriptTag()
    try {
      render(
        <PluginHost>
          <ProbeTree />
        </PluginHost>,
      )
      await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull())
      await waitFor(() => {
        expect(typeof (window as unknown as { __bakinHotSwapPlugin?: unknown })
          .__bakinHotSwapPlugin).toBe('function')
      })
    } finally {
      consoleDebug.mockRestore()
    }
  })
})

describe('PluginHost — hot-swap unregisters synchronously', () => {
  it('drops the plugin\'s slot entry before the import runs', async () => {
    const consoleDebug = spyOn(console, 'debug').mockImplementation(() => {})
    injectDevScriptTag()
    try {
      render(
        <PluginHost>
          <ProbeTree />
        </PluginHost>,
      )
      await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull())

      act(() => {
        registerPlugin({
          id: 'x',
          slots: { 'page:/probe': SlotPage },
        })
      })
      await waitFor(() => expect(screen.queryByTestId('slot-content')?.textContent)
        .toBe('rendered-from-x'))

      const handle = (window as unknown as {
        __bakinHotSwapPlugin?: (...a: unknown[]) => Promise<void>
      }).__bakinHotSwapPlugin
      expect(typeof handle).toBe('function')

      // Kick off the swap with a deliberately bad URL. The unregister step
      // runs synchronously; the import rejects, which we swallow. The
      // assertion is on the SIDE EFFECT — x's slot entry is gone, so the
      // Slot renders null.
      const p = handle!('x', '/bogus/unused.js', 'v2')
      if (p && typeof p.catch === 'function') p.catch(() => {})

      await waitFor(() => expect(screen.queryByTestId('slot-content')).toBeNull())
    } finally {
      consoleDebug.mockRestore()
    }
  })

  it('dedupes repeated hot-swaps for the same evaluated client URL', async () => {
    const consoleDebug = spyOn(console, 'debug').mockImplementation(() => {})
    injectDevScriptTag()
    const moduleDir = mkdtempSync(join(tmpdir(), 'bakin-plugin-host-hotswap-'))
    try {
      render(
        <PluginHost>
          <ProbeTree />
        </PluginHost>,
      )
      await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull())

      const modulePath = join(moduleDir, 'client.mjs')
      writeFileSync(modulePath, [
        'globalThis.__bakinHotSwapImportCount = (globalThis.__bakinHotSwapImportCount ?? 0) + 1',
        'globalThis.__bakinHotSwapRegister()',
        '',
      ].join('\n'))
      ;(globalThis as Record<string, unknown>).__bakinHotSwapRegister = () => {
        registerPlugin({
          id: 'x',
          slots: { 'page:/probe': SlotPage },
        })
      }

      const handle = (window as unknown as {
        __bakinHotSwapPlugin?: (...a: unknown[]) => Promise<void>
      }).__bakinHotSwapPlugin
      expect(typeof handle).toBe('function')

      const clientEntry = pathToFileURL(modulePath).href
      await act(async () => {
        await handle!('x', clientEntry, 'same-version')
      })
      await waitFor(() => expect(screen.queryByTestId('slot-content')?.textContent)
        .toBe('rendered-from-x'))

      await act(async () => {
        await handle!('x', clientEntry, 'same-version')
      })

      expect((globalThis as Record<string, unknown>).__bakinHotSwapImportCount).toBe(1)
      await waitFor(() => expect(screen.queryByTestId('slot-content')?.textContent)
        .toBe('rendered-from-x'))
    } finally {
      consoleDebug.mockRestore()
      rmSync(moduleDir, { recursive: true, force: true })
    }
  })

  it('bounds a hung hot-swap import instead of leaving plugin routes loading forever', async () => {
    injectDevScriptTag()
    const moduleDir = mkdtempSync(join(tmpdir(), 'bakin-plugin-host-hung-swap-'))
    PLUGIN_BOOT_TIMEOUTS.importMs = 50
    try {
      render(
        <PluginHost>
          <ProbeTree />
        </PluginHost>,
      )
      await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull())

      act(() => {
        registerPlugin({ id: 'hung', slots: { 'page:/probe': SlotPage } })
      })

      const modulePath = join(moduleDir, 'client.mjs')
      writeFileSync(modulePath, 'await new Promise(() => {})\n')
      const handle = (window as unknown as {
        __bakinHotSwapPlugin?: (...a: unknown[]) => Promise<void>
      }).__bakinHotSwapPlugin
      expect(typeof handle).toBe('function')

      let swapPromise: Promise<void> | undefined
      act(() => {
        swapPromise = handle!('hung', pathToFileURL(modulePath).href, 'hung-version')
      })
      await act(async () => {
        const outcome = await Promise.race([
          swapPromise!.then(
            () => 'resolved' as const,
            () => 'rejected' as const,
          ),
          new Promise<'still-pending'>((resolve) => setTimeout(() => resolve('still-pending'), 200)),
        ])
        expect(outcome).toBe('rejected')
      })

      expect(getPluginLoadState('hung')).toBe('error')
    } finally {
      PLUGIN_BOOT_TIMEOUTS.importMs = DEFAULT_IMPORT_TIMEOUT_MS
      rmSync(moduleDir, { recursive: true, force: true })
    }
  })
})

describe('Slot — re-renders on registry change', () => {
  it('shows the current registration every time a plugin re-registers', async () => {
    render(
      <PluginHost>
        <ProbeTree />
      </PluginHost>,
    )
    await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull())

    // Initial: no registration → Slot renders null
    expect(screen.queryByTestId('slot-content')).toBeNull()

    // Register v1 → Slot renders SlotPage
    act(() => {
      registerPlugin({ id: 'x', slots: { 'page:/probe': SlotPage } })
    })
    await waitFor(() => expect(screen.queryByTestId('slot-content')?.textContent)
      .toBe('rendered-from-x'))

    // Unregister + re-register with a different component (simulates what
    // a hot-swap's new module would do)
    act(() => {
      unregisterPlugin('x')
      registerPlugin({ id: 'x', slots: { 'page:/probe': AltSlotPage } })
    })
    await waitFor(() => expect(screen.queryByTestId('slot-content')?.textContent)
      .toBe('rendered-from-x-v2'))

    // Unregister entirely → Slot falls back to null
    act(() => { unregisterPlugin('x') })
    await waitFor(() => expect(screen.queryByTestId('slot-content')).toBeNull())
  })

  it('preserves other plugins\' slot entries when one unregisters', async () => {
    render(
      <PluginHost>
        <ProbeTree />
      </PluginHost>,
    )
    await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull())

    act(() => {
      registerPlugin({ id: 'x', slots: { 'page:/probe': SlotPage } })
      registerPlugin({ id: 'y', slots: { 'page:/probe': AltSlotPage } })
    })
    // Both render; assert at least one of the expected texts appears.
    await waitFor(() => {
      const nodes = screen.queryAllByTestId('slot-content')
      expect(nodes.length).toBe(2)
    })

    act(() => { unregisterPlugin('x') })
    await waitFor(() => {
      const nodes = screen.queryAllByTestId('slot-content')
      expect(nodes.length).toBe(1)
      expect(nodes[0].textContent).toBe('rendered-from-x-v2')
    })
  })
})

describe('PluginHost — lazy boot from declarative manifests', () => {
  function writeRegisteringModule(dir: string, pluginId: string, slotName: string): string {
    const modulePath = join(dir, `${pluginId}-client.mjs`)
    writeFileSync(modulePath, [
      `globalThis.__bakinHotSwapImportCount = (globalThis.__bakinHotSwapImportCount ?? 0) + 1`,
      `globalThis.__bakinHotSwapRegister('${pluginId}', '${slotName}')`,
      '',
    ].join('\n'))
    return pathToFileURL(modulePath).href
  }

  function stubManifestFetch(plugins: unknown[]) {
    vi.stubGlobal('fetch', mock(async (url: string) => {
      if (url === '/api/plugins/manifest') {
        return new Response(JSON.stringify({ plugins }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    }))
  }

  it('seeds sidebar nav from contributes.nav without importing the client', async () => {
    const moduleDir = mkdtempSync(join(tmpdir(), 'bakin-plugin-host-lazy-'))
    try {
      ;(globalThis as Record<string, unknown>).__bakinHotSwapRegister = (id: string, slotName: string) => {
        registerPlugin({ id, slots: { [slotName]: SlotPage } })
      }
      const clientEntry = writeRegisteringModule(moduleDir, 'x', 'page:/probe')
      stubManifestFetch([{
        id: 'x',
        name: 'X',
        version: '1.0.0',
        clientEntry,
        clientVersion: 'lazy-1',
        status: 'active',
        contributes: {
          nav: [{ id: 'x-nav', label: 'X', href: '/x', order: 7 }],
          slots: ['page:/probe'],
        },
      }])

      render(
        <PluginHost>
          <div data-testid="shell" />
        </PluginHost>,
      )
      await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull())

      // Nav is live from the manifest; the client module never imported.
      expect(getAllNavItems().map((i) => i.id)).toContain('x-nav')
      expect((globalThis as Record<string, unknown>).__bakinHotSwapImportCount).toBeUndefined()
      expect(getPluginLoadState('x')).toBe('idle')
    } finally {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  })

  it('imports a lazy client on first render of a declared slot', async () => {
    const moduleDir = mkdtempSync(join(tmpdir(), 'bakin-plugin-host-lazy-'))
    try {
      ;(globalThis as Record<string, unknown>).__bakinHotSwapRegister = (id: string, slotName: string) => {
        registerPlugin({ id, slots: { [slotName]: SlotPage } })
      }
      const clientEntry = writeRegisteringModule(moduleDir, 'x', 'page:/probe')
      stubManifestFetch([{
        id: 'x',
        name: 'X',
        version: '1.0.0',
        clientEntry,
        clientVersion: 'lazy-2',
        status: 'active',
        contributes: { slots: ['page:/probe'] },
      }])

      render(
        <PluginHost>
          <ProbeTree />
        </PluginHost>,
      )
      // The probe tree renders <Slot name="page:/probe" /> immediately —
      // that render is the demand that imports the client.
      await waitFor(() => expect(screen.queryByTestId('slot-content')?.textContent)
        .toBe('rendered-from-x'), { timeout: 5000 })
      expect((globalThis as Record<string, unknown>).__bakinHotSwapImportCount).toBe(1)
      expect(getPluginLoadState('x')).toBe('loaded')
    } finally {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  })

  it('imports eager-flagged and legacy (no metadata) clients at boot', async () => {
    const moduleDir = mkdtempSync(join(tmpdir(), 'bakin-plugin-host-eager-'))
    try {
      ;(globalThis as Record<string, unknown>).__bakinHotSwapRegister = (id: string, slotName: string) => {
        registerPlugin({ id, slots: { [slotName]: SlotPage } })
      }
      stubManifestFetch([
        {
          id: 'x',
          name: 'X (eager flag)',
          version: '1.0.0',
          clientEntry: writeRegisteringModule(moduleDir, 'x', 'page:/x-eager'),
          clientVersion: 'eager-1',
          status: 'active',
          contributes: { slots: ['page:/x-eager'], eager: true },
        },
        {
          id: 'y',
          name: 'Y (legacy shape)',
          version: '1.0.0',
          clientEntry: writeRegisteringModule(moduleDir, 'y', 'page:/y-legacy'),
          clientVersion: 'legacy-1',
          status: 'active',
        },
      ])

      render(
        <PluginHost>
          <div />
        </PluginHost>,
      )
      await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull(), { timeout: 5000 })

      await waitFor(() => {
        expect(getPluginLoadState('x')).toBe('loaded')
        expect(getPluginLoadState('y')).toBe('loaded')
      })
      expect((globalThis as Record<string, unknown>).__bakinHotSwapImportCount).toBe(2)
    } finally {
      rmSync(moduleDir, { recursive: true, force: true })
    }
  })

  it('hot-swapping a never-loaded lazy plugin refreshes metadata without importing', async () => {
    const consoleDebug = spyOn(console, 'debug').mockImplementation(() => {})
    injectDevScriptTag()
    const moduleDir = mkdtempSync(join(tmpdir(), 'bakin-plugin-host-lazyswap-'))
    try {
      ;(globalThis as Record<string, unknown>).__bakinHotSwapRegister = (id: string, slotName: string) => {
        registerPlugin({ id, slots: { [slotName]: SlotPage } })
      }
      const clientEntry = writeRegisteringModule(moduleDir, 'x', 'page:/probe')
      stubManifestFetch([{
        id: 'x',
        name: 'X',
        version: '1.0.0',
        clientEntry,
        clientVersion: 'swap-2',
        status: 'active',
        contributes: {
          nav: [{ id: 'x-nav', label: 'X v2', href: '/x' }],
          slots: ['page:/probe'],
        },
      }])

      render(
        <PluginHost>
          <div />
        </PluginHost>,
      )
      await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull())

      const handle = (window as unknown as {
        __bakinHotSwapPlugin?: (...a: unknown[]) => Promise<void>
      }).__bakinHotSwapPlugin
      expect(typeof handle).toBe('function')

      await act(async () => {
        await handle!('x', clientEntry, 'swap-2')
      })

      // Metadata refreshed (nav re-seeded from the new manifest) but the
      // client bundle was never imported — it stays lazy.
      expect(getAllNavItems().map((i) => i.label)).toContain('X v2')
      expect((globalThis as Record<string, unknown>).__bakinHotSwapImportCount).toBeUndefined()
      expect(getPluginLoadState('x')).toBe('idle')
    } finally {
      consoleDebug.mockRestore()
      rmSync(moduleDir, { recursive: true, force: true })
    }
  })
})

describe('PluginHost — nav-badge-providers slot', () => {
  it('renders components contributed via the well-known nav-badge-providers slot', async () => {
    function BadgeRecorder() {
      return <span data-testid="badge-recorder">badge-runner-mounted</span>
    }
    render(
      <PluginHost>
        <div />
      </PluginHost>,
    )
    await waitFor(() => expect(screen.queryByText('Loading plugins')).toBeNull())

    act(() => {
      registerPlugin({ id: 'x', slots: { 'nav-badge-providers': BadgeRecorder } })
    })
    await waitFor(() => expect(screen.getByTestId('badge-recorder')).toBeDefined())

    act(() => { unregisterPlugin('x') })
    await waitFor(() => expect(screen.queryByTestId('badge-recorder')).toBeNull())
  })
})
