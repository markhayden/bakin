// @vitest-environment jsdom
/**
 * VersionedAssetGrid — pending-search empty state.
 *
 * A cold deep link (/assets?q=beef) used to flash "No assets match your
 * filters." while the first search request was still in flight: the grid
 * keeps the LAST SETTLED list on screen during a pending search, but on
 * first load nothing has ever settled, so the no-match branch rendered
 * prematurely. The no-match state must be gated on `pending` — while a
 * search is in flight with nothing settled, the grid says "Searching…".
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-assets-grid-${process.pid}-${Date.now()}`)

// Mandatory isolation mocks (CLAUDE.md) — transitive imports must never
// resolve the real content dir or OpenClaw home.
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

// ---------------------------------------------------------------------------
// SDK mocks — primed per-test via module-level refs.
// ---------------------------------------------------------------------------

const queryStateRefs: Record<string, string> = {}

interface SearchHookState {
  results: Array<{ id: string; table: string; score: number; fields: Record<string, unknown>; indexScores?: Record<string, number> }>
  loading: boolean
  status: 'ok' | 'unavailable'
  meta: { query: string } | null
}
const searchState: SearchHookState = { results: [], loading: false, status: 'ok', meta: null }

mock.module('@makinbakin/sdk/hooks', () => ({
  useQueryState: (key: string, defaultValue: string) => {
    if (!(key in queryStateRefs)) queryStateRefs[key] = defaultValue
    const setter = (v: string) => { queryStateRefs[key] = v }
    return [queryStateRefs[key], setter, setter] as const
  },
  useQueryArrayState: (_key: string) => [[], () => {}] as const,
  useSearch: () => ({
    results: searchState.results,
    aggregations: {},
    loading: searchState.loading,
    status: searchState.status,
    error: null,
    meta: searchState.meta,
    search: mock(),
    clear: mock(),
    retry: mock(),
  }),
  useDebug: () => [false, () => {}] as const,
  useRouter: () => ({ push: mock(), replace: mock() }),
  usePathname: () => '/assets',
  useSearchParams: () => new URLSearchParams(),
  usePluginEvent: () => {},
}))

mock.module('@tanstack/react-router', () => ({
  useNavigate: () => mock(),
}))

const passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>
mock.module('@makinbakin/sdk/ui', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Badge: passthrough,
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Label: passthrough,
  Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: passthrough,
  DialogHeader: passthrough,
  DialogTitle: passthrough,
  DialogDescription: passthrough,
  DialogFooter: passthrough,
  DropdownMenu: passthrough,
  DropdownMenuTrigger: passthrough,
  DropdownMenuContent: passthrough,
  DropdownMenuItem: passthrough,
}))

mock.module('@makinbakin/sdk/components', () => ({
  PluginHeader: ({ title }: { title?: ReactNode }) => <h1>{title}</h1>,
  FacetFilter: () => <div data-testid="facet-filter" />,
  SearchUnavailable: () => <div data-testid="search-unavailable" />,
  ScoreOverlay: () => null,
  AgentAvatar: () => <span />,
  BakinDrawer: passthrough,
  ConfirmDialog: () => null,
}))

mock.module('@makinbakin/sdk/utils', () => ({
  formatSize: (n: number) => `${n}B`,
  formatAge: () => 'now',
}))

import { VersionedAssetGrid } from '../../../plugins/assets/components/versioned/VersionedAssetGrid'

// fetch stub: the grid loads the full unfiltered asset list on mount.
const asset = (assetId: string, description: string, type: string) => ({
  assetId, type, agent: 'jessica', taskId: null,
  created: new Date().toISOString(), updated: new Date().toISOString(),
  currentVersion: 1, versionCount: 1, description, tags: [],
  mimeType: 'image/png', width: null, height: null, size: 10,
  hasThumb: false, enrichment: 'none',
})
const ASSETS = [asset('a1', 'Brisket photo', 'images'), asset('a2', 'Sales doc', 'text')]
const realFetch = globalThis.fetch
beforeEach(() => {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/trash')) return Response.json({ items: [] })
    return Response.json({ assets: ASSETS })
  }) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
  for (const key of Object.keys(queryStateRefs)) delete queryStateRefs[key]
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('VersionedAssetGrid — pending search vs no-match', () => {
  it('shows "Searching assets…" (never "no match") on a cold deep link while the search is in flight', async () => {
    queryStateRefs.q = 'beef'
    // Cold start: request in flight, nothing has ever settled.
    searchState.results = []
    searchState.loading = true
    searchState.meta = null

    render(<VersionedAssetGrid />)
    await waitFor(() => expect(screen.queryByText('Loading assets…')).toBeNull())

    expect(screen.getByTestId('assets-searching')).toBeDefined()
    expect(screen.queryByTestId('assets-no-match')).toBeNull()
  })

  it('shows the real no-match state once the search settles empty', async () => {
    queryStateRefs.q = 'beef'
    searchState.results = []
    searchState.loading = false
    searchState.meta = { query: 'beef' } // settled for the current input

    render(<VersionedAssetGrid />)
    await waitFor(() => expect(screen.queryByText('Loading assets…')).toBeNull())

    expect(screen.getByTestId('assets-no-match')).toBeDefined()
    expect(screen.queryByTestId('assets-searching')).toBeNull()
  })

  it('renders results once the search settles with matches', async () => {
    queryStateRefs.q = 'beef'
    searchState.results = [{ id: 'a1', table: 'assets', score: 1, fields: {} }]
    searchState.loading = false
    searchState.meta = { query: 'beef' }

    render(<VersionedAssetGrid />)
    await waitFor(() => expect(screen.queryByText('Loading assets…')).toBeNull())

    await waitFor(() => expect(screen.queryByTestId('assets-searching')).toBeNull())
    expect(screen.queryByTestId('assets-no-match')).toBeNull()
    // Only the matching asset renders (a2 has no search score).
    await waitFor(() => expect(screen.getByTestId('assets-grid')).toBeDefined())
    expect(screen.getByText('Brisket photo')).toBeDefined()
    expect(screen.queryByText('Sales doc')).toBeNull()
  })
})
