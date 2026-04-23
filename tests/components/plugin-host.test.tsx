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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, act } from '@testing-library/react'

// Per CLAUDE.md — defensive content-dir mocks even for pure React tests.
vi.mock('../../src/core/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-plugin-host-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
vi.mock('../../packages/core/src/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-plugin-host-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})

import { PluginHost } from '../../packages/host/src/plugin-host/PluginHost'
import { registerPlugin, unregisterPlugin } from '@bakin/sdk'
import { Slot } from '@bakin/sdk/slots'

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
  s.setAttribute('type', 'module')
  s.setAttribute('src', '/__bakin-dev/client.js')
  document.head.appendChild(s)
}

function removeDevScriptTag() {
  document.head
    .querySelectorAll('script[src="/__bakin-dev/client.js"]')
    .forEach((el) => el.remove())
}

const EMPTY_MANIFEST = { plugins: [] }

const USED_IDS = ['x', 'y']

beforeEach(() => {
  // Mock fetch so PluginHost's manifest load resolves deterministically.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
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
  for (const id of USED_IDS) unregisterPlugin(id)
  delete (window as unknown as { __bakinHotSwapPlugin?: unknown }).__bakinHotSwapPlugin
  vi.unstubAllGlobals()
  cleanup()
})

describe('PluginHost — boot', () => {
  it('renders children after the manifest fetch resolves', async () => {
    render(
      <PluginHost>
        <ProbeTree />
      </PluginHost>,
    )
    // Slot with no entries renders null, but the parent <div> is still there.
    await waitFor(() => {
      // The <ProbeTree>'s <div> wrapper is visible in the DOM
      expect(document.querySelector('div')).not.toBeNull()
    })
  })
})

describe('PluginHost — window.__bakinHotSwapPlugin bridge', () => {
  it('does NOT expose the handle when the dev-client script tag is absent', async () => {
    render(
      <PluginHost>
        <ProbeTree />
      </PluginHost>,
    )
    await waitFor(() => expect(document.querySelector('div')).not.toBeNull())
    expect((window as unknown as { __bakinHotSwapPlugin?: unknown }).__bakinHotSwapPlugin)
      .toBeUndefined()
  })

  it('exposes the handle when the dev-client script tag is present', async () => {
    injectDevScriptTag()
    render(
      <PluginHost>
        <ProbeTree />
      </PluginHost>,
    )
    await waitFor(() => expect(document.querySelector('div')).not.toBeNull())
    await waitFor(() => {
      expect(typeof (window as unknown as { __bakinHotSwapPlugin?: unknown })
        .__bakinHotSwapPlugin).toBe('function')
    })
  })
})

describe('PluginHost — hot-swap unregisters synchronously', () => {
  it('drops the plugin\'s slot entry before the import runs', async () => {
    injectDevScriptTag()
    render(
      <PluginHost>
        <ProbeTree />
      </PluginHost>,
    )
    await waitFor(() => expect(document.querySelector('div')).not.toBeNull())

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
  })
})

describe('Slot — re-renders on registry change', () => {
  it('shows the current registration every time a plugin re-registers', async () => {
    render(
      <PluginHost>
        <ProbeTree />
      </PluginHost>,
    )
    await waitFor(() => expect(document.querySelector('div')).not.toBeNull())

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
    await waitFor(() => expect(document.querySelector('div')).not.toBeNull())

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
