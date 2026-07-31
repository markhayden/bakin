// @vitest-environment jsdom
/**
 * ⌘K global search overlay — open via hotkey, grouped rendering through
 * the hit-renderer registry, default renderer for unknown types, Enter
 * deep-links, honest engine-down state.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import '../rtl-settle'
import { settleReact } from '../rtl-settle'

const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-global-overlay',
  getBakinPaths: () => ({}),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

// Recordable navigate (overrides the global inert shim for this file).
const navigateCalls: unknown[] = []
mock.module('@tanstack/react-router', () => ({
  ...require('../shims/tanstack-router'),
  useNavigate: () => (opts: unknown) => { navigateCalls.push(opts) },
}))

import { GlobalSearchOverlay } from '../../packages/host/src/components/search/global-search-overlay'
import { registerPlugin, unregisterPlugin } from '../../packages/sdk/src/register'
import { configureLazyPlugins, setLazyPluginLoader, setPluginLoadState } from '../../packages/sdk/src/lazy'

function mockSearchFetch(handler: (url: string) => { status: number; body: unknown }) {
  ;(globalThis as Record<string, unknown>).fetch = mock((url: string) =>
    Promise.resolve({
      ok: handler(String(url)).status < 400,
      status: handler(String(url)).status,
      json: () => Promise.resolve(handler(String(url)).body),
    } as Response),
  )
}

const HIT = (id: string, table: string, fields: Record<string, unknown> = {}) =>
  ({ id, table, score: 0.9, fields, indexScores: { full_text: 0.7 } })

beforeEach(() => {
  navigateCalls.length = 0
  delete (globalThis as Record<string, unknown>).__bakinClientRegistry
  // cmdk calls scrollIntoView on selection; happy-dom lacks it.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
})

afterEach(() => {
  unregisterPlugin('assets')
})

async function openOverlay() {
  await act(async () => { fireEvent.keyDown(window, { key: 'k', metaKey: true }) })
}

describe('GlobalSearchOverlay', () => {
  it('opens on ⌘K, searches, and groups hits by type with registered renderers', async () => {
    registerPlugin({
      id: 'assets',
      search: {
        hitRenderers: {
          assets: (hit) => ({ title: `Asset ${hit.id}`, subtitle: 'caption', href: `/assets/${hit.id}` }),
        },
      },
    })
    mockSearchFetch(() => ({
      status: 200,
      body: {
        results: [HIT('a1', 'bakin_assets'), HIT('t1', 'bakin_tasks', { title: 'Fix the thing' })],
        meta: { query: 'x', total: 2, took_ms: 1, source: 'search' },
      },
    }))

    await act(async () => {
      render(<GlobalSearchOverlay />)
    })
    await openOverlay()
    const input = await screen.findByPlaceholderText(/Search assets/)
    await act(async () => { fireEvent.input(input, { target: { value: 'dashboard' } }) })

    await waitFor(() => expect(screen.getByTestId('global-search-hit-a1')).toBeTruthy(), { timeout: 3000 })
    // registered renderer shaped the assets hit
    expect(screen.getByTestId('global-search-hit-a1').textContent).toContain('Asset a1')
    // unknown type (tasks — no renderer registered here) got the default renderer
    expect(screen.getByTestId('global-search-hit-t1').textContent).toContain('Fix the thing')
    // groups + chips present
    expect(screen.getByTestId('global-search-group-assets')).toBeTruthy()
    expect(screen.getByTestId('global-search-chip-assets')).toBeTruthy()
  })

  it('Enter on a hit with an href navigates and closes', async () => {
    registerPlugin({
      id: 'assets',
      search: { hitRenderers: { assets: (hit) => ({ title: hit.id, href: `/assets/${hit.id}` }) } },
    })
    mockSearchFetch(() => ({
      status: 200,
      body: { results: [HIT('a1', 'bakin_assets')], meta: { query: 'x', total: 1, took_ms: 1, source: 'search' } },
    }))

    await act(async () => {
      render(<GlobalSearchOverlay />)
    })
    await openOverlay()
    const input = await screen.findByPlaceholderText(/Search assets/)
    await act(async () => { fireEvent.input(input, { target: { value: 'red' } }) })
    await waitFor(() => expect(screen.getByTestId('global-search-hit-a1')).toBeTruthy(), { timeout: 3000 })

    await act(async () => { fireEvent.click(screen.getByTestId('global-search-hit-a1')) })
    await waitFor(() => expect(navigateCalls.length).toBe(1))
    expect(navigateCalls[0]).toEqual({ to: '/assets/a1' })
    // closed: the input is gone
    expect(screen.queryByPlaceholderText(/Search assets/)).toBeNull()
  })

  it('null-href hits render inert and do not navigate', async () => {
    // No renderer registered for `schedule` → defaultDescriptor → href: null.
    mockSearchFetch(() => ({
      status: 200,
      body: { results: [HIT('job-1', 'bakin_schedule', { title: 'Nightly sweep' })], meta: { query: 'x', total: 1, took_ms: 1, source: 'search' } },
    }))

    await act(async () => {
      render(<GlobalSearchOverlay />)
    })
    await openOverlay()
    const input = await screen.findByPlaceholderText(/Search assets/)
    await act(async () => { fireEvent.input(input, { target: { value: 'sweep' } }) })
    await waitFor(() => expect(screen.getByTestId('global-search-hit-job-1')).toBeTruthy(), { timeout: 3000 })

    const hit = screen.getByTestId('global-search-hit-job-1')
    expect(hit.getAttribute('data-inert')).toBe('true')
    await act(async () => { fireEvent.click(hit) })
    expect(navigateCalls.length).toBe(0)
    // overlay stays open — a dead click must not close it
    expect(screen.queryByPlaceholderText(/Search assets/)).not.toBeNull()
  })

  it('renders the honest unavailable state on the 503 contract', async () => {
    mockSearchFetch(() => ({ status: 503, body: { error: 'search_unavailable' } }))
    await act(async () => {
      render(<GlobalSearchOverlay />)
    })
    await openOverlay()
    const input = await screen.findByPlaceholderText(/Search assets/)
    await act(async () => { fireEvent.input(input, { target: { value: 'down' } }) })
    await waitFor(() => expect(screen.getByTestId('search-unavailable')).toBeTruthy(), { timeout: 3000 })
  })

  it('opening the overlay demands every idle lazy plugin client', async () => {
    // Lazy plugins register hit renderers only when their client loads —
    // search is cross-plugin, so opening the overlay must load them all.
    const loaded: string[] = []
    configureLazyPlugins({
      slotOwners: new Map([['page:/lzso-a', ['lzso-a']]]),
      routeOwners: [{ pattern: 'page:/lzso-b/[id]', pluginId: 'lzso-b' }],
    })
    setLazyPluginLoader((id) => {
      loaded.push(id)
      setPluginLoadState(id, 'loading')
    })
    try {
      await act(async () => {
        render(<GlobalSearchOverlay />)
      })
      await openOverlay()
      await screen.findByPlaceholderText(/Search assets/)
      expect(loaded.sort()).toEqual(['lzso-a', 'lzso-b'])
    } finally {
      setLazyPluginLoader(null)
      configureLazyPlugins({ slotOwners: new Map(), routeOwners: [] })
    }
  })

  it('shows the honest partial-results chip when a source missed its budget', async () => {
    mockSearchFetch(() => ({
      status: 200,
      body: {
        results: [HIT('a1', 'bakin_assets')],
        meta: {
          query: 'x', total: 1, took_ms: 2001, source: 'search', partial: true,
          tables: [
            { table: 'bakin_assets', hits: 1, took_ms: 40 },
            { table: 'bakin_memory', hits: 0, took_ms: 2001, budget: 'omitted' },
          ],
        },
      },
    }))
    await act(async () => {
      render(<GlobalSearchOverlay />)
    })
    await openOverlay()
    const input = await screen.findByPlaceholderText(/Search assets/)
    await act(async () => { fireEvent.input(input, { target: { value: 'rose' } }) })
    await waitFor(() => expect(screen.getByTestId('search-partial-chip')).toBeTruthy(), { timeout: 3000 })
    // tooltip names the slow source, stripped of the table prefix
    expect(screen.getByTestId('search-partial-chip').getAttribute('title')).toContain('memory: no answer in time')
  })

  it('renders no partial chip when every source answered in budget', async () => {
    mockSearchFetch(() => ({
      status: 200,
      body: { results: [HIT('a1', 'bakin_assets')], meta: { query: 'x', total: 1, took_ms: 30, source: 'search', tables: [{ table: 'bakin_assets', hits: 1, took_ms: 30 }] } },
    }))
    await act(async () => {
      render(<GlobalSearchOverlay />)
    })
    await openOverlay()
    const input = await screen.findByPlaceholderText(/Search assets/)
    await act(async () => { fireEvent.input(input, { target: { value: 'rose' } }) })
    await waitFor(() => expect(screen.getByTestId('global-search-hit-a1')).toBeTruthy(), { timeout: 3000 })
    expect(screen.queryAllByTestId('search-partial-chip').length).toBe(0)
  })

  it('renders score overlays only when the debug toggle is on', async () => {
    mockSearchFetch(() => ({
      status: 200,
      body: { results: [HIT('a1', 'bakin_assets')], meta: { query: 'x', total: 1, took_ms: 1, source: 'search' } },
    }))

    // require() (not a top-level import) so the store loads through the same
    // already-initialized module graph as the component under test.
    const { useContentStore } = require('../../src/hooks/use-content-store')
    act(() => { useContentStore.setState({ debug: false }) })
    await act(async () => {
      render(<GlobalSearchOverlay />)
    })
    await openOverlay()
    const input = await screen.findByPlaceholderText(/Search assets/)
    await act(async () => { fireEvent.input(input, { target: { value: 'rose' } }) })
    await waitFor(() => expect(screen.getByTestId('global-search-hit-a1')).toBeTruthy(), { timeout: 3000 })
    expect(screen.queryAllByTestId('score-overlay').length).toBe(0)

    // flip debug on — badges appear without a re-search
    act(() => { useContentStore.setState({ debug: true }) })
    await waitFor(() => expect(screen.queryAllByTestId('score-overlay').length).toBeGreaterThan(0))
    act(() => { useContentStore.setState({ debug: false }) })
    await settleReact()
  })

  it('does not hijack ⌘K while typing in an input', async () => {
    await act(async () => {
      render(
        <div>
          <input data-testid="outside-input" />
          <GlobalSearchOverlay />
        </div>,
      )
    })
    const outside = screen.getByTestId('outside-input')
    outside.focus()
    await act(async () => { fireEvent.keyDown(outside, { key: 'k', metaKey: true }) })
    expect(screen.queryByPlaceholderText(/Search assets/)).toBeNull()
  })
})
