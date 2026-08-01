// @vitest-environment jsdom

/**
 * MemoryShell — honest engine-down state (spec D11 / search-trust-and-speed
 * WS6/T16).
 *
 * Uses the REAL `useSearch` hook with `fetch` stubbed so the plugin search
 * route answers 503 `{ error: 'search_unavailable' }` — exactly the wire
 * contract of an engine-down `/api/plugins/memory/search`. The shell must
 * render the SDK `SearchUnavailable` panel (with a working Retry), never the
 * misleading "No results" empty state.
 *
 * Child components with their own fetch/dep webs are stubbed; the results
 * list is the real MemorySearchResults so the loading skeleton assertion
 * exercises production markup.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ─── Test isolation mocks (mandatory per CLAUDE.md) ─────────────────────────

const testDir = join(tmpdir(), `bakin-test-memory-shell-down-${process.pid}-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
  watchPath: mock(),
}))

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── URL state — primed per test via module-level refs ─────────────────────

const queryStateRefs: Record<string, string> = {}

mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (key: string, defaultValue: string) => {
    if (!(key in queryStateRefs)) queryStateRefs[key] = defaultValue
    const setter = (v: string) => { queryStateRefs[key] = v }
    return [queryStateRefs[key], setter, setter] as const
  },
  useQueryArrayState: (_key: string) => {
    return [[], () => {}] as const
  },
}))

// ─── Stubbed dep web ────────────────────────────────────────────────────────

mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgentList: () => [],
  useAgentIds: () => [],
  useAgent: () => undefined,
  useAgentDisplayName: () => undefined,
}))



mock.module('@bakin/memory/components/tier-overview-cards', () => ({
  TierOverviewCards: () => null,
}))

mock.module('@bakin/memory/components/memory-detail-drawer', () => ({
  MemoryDetailDrawer: () => null,
}))

mock.module('@bakin/memory/components/memory-cleanup', () => ({
  MemoryCleanup: () => null,
}))

mock.module('@bakin/memory/components/use-record-deep-link', () => ({
  useRecordDeepLink: () => ({ row: null, error: null, open: mock(), close: mock() }),
}))

// Import AFTER mocks. useSearch stays REAL — engine-down arrives via fetch.
import { MemoryShell } from '../../../plugins/memory/components/memory-shell'

// ─── fetch stub ─────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Search route → 503 search_unavailable; everything else → benign empty 200. */
function engineDownFetch() {
  return mock(async (url: string | URL) => {
    const u = String(url)
    if (u.includes('/search')) return json({ error: 'search_unavailable' }, 503)
    return json({ results: [] })
  })
}

beforeEach(() => {
  cleanup()
  for (const k of Object.keys(queryStateRefs)) delete queryStateRefs[k]
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('MemoryShell — engine down', () => {
  it('shows a loading state, then the SearchUnavailable panel on 503 search_unavailable', async () => {
    vi.stubGlobal('fetch', engineDownFetch())
    queryStateRefs.q = 'beef stew'

    render(<MemoryShell />)

    // While the debounced request is pending the shell shows the results
    // loading state — never a premature empty state.
    await waitFor(() => {
      expect(screen.getByTestId('memory-search-results-loading')).toBeDefined()
    })

    // 503 { error: 'search_unavailable' } → the honest panel, with Retry.
    await waitFor(() => {
      expect(screen.getByTestId('search-unavailable')).toBeDefined()
    }, { timeout: 3000 })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
    // The misleading "No results" empty state must NOT render.
    expect(screen.queryByText('No results')).toBeNull()
  })

  it('Retry re-runs the query and recovers once the engine answers', async () => {
    const fetchMock = engineDownFetch()
    vi.stubGlobal('fetch', fetchMock)
    queryStateRefs.q = 'beef'

    render(<MemoryShell />)

    await waitFor(() => {
      expect(screen.getByTestId('search-unavailable')).toBeDefined()
    }, { timeout: 3000 })

    // Engine comes back: same URL now answers 200 with a hit.
    fetchMock.mockImplementation(async () => json({
      results: [
        {
          id: 'r1',
          table: 'bakin_memory',
          score: 0.9,
          fields: { tier: 'durable', agent: 'chef', title: 'Beef stew notes', snippet: 'slow braise' },
        },
      ],
      aggregations: {},
      meta: { query: 'beef', total: 1, took_ms: 3, source: 'search' },
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(screen.queryAllByTestId('search-unavailable').length).toBe(0)
      expect(screen.getByText('Beef stew notes')).toBeDefined()
    }, { timeout: 3000 })
  })
})
