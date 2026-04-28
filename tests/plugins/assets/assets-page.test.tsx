// @vitest-environment jsdom
/**
 * Smoke tests for plugins/assets/components/assets-page.tsx.
 *
 * Focus: the `filtered` useMemo behavior when the search hook returns
 * results vs. when it does not (local fallback path), and how the type
 * filter intersects with search hits. All child components are stubbed
 * out so we can read what ends up on the AssetsGrid `assets` prop.
 */

import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import type { AssetMeta } from '@/types'

// Polyfill localStorage for jsdom — the page reads page-size from it on mount.
// jsdom in this project ships with a broken localStorage stub (getItem is
// undefined) so we override unconditionally on both window and globalThis.
{
  const store = new Map<string, string>()
  const fakeLocalStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: fakeLocalStorage,
  })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: fakeLocalStorage,
    })
  }
}

// ─── Mandatory mocks per CLAUDE.md test isolation rules ───────────────────

const testDir = join(tmpdir(), `bakin-test-assets-search-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
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
}))

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

// ─── Hook stubs ───────────────────────────────────────────────────────────

type QueryStateValue = { value: string; setValue: (v: string) => void }
const queryStrings = new Map<string, QueryStateValue>()
const queryArrays = new Map<string, { value: string[]; setValue: (v: string[]) => void }>()

function getQueryString(key: string, defaultValue: string): QueryStateValue {
  let entry = queryStrings.get(key)
  if (!entry) {
    let v = defaultValue
    entry = {
      get value() { return v },
      setValue: (next: string) => { v = next },
    } as unknown as QueryStateValue
    queryStrings.set(key, entry)
  }
  return entry
}

function getQueryArray(key: string) {
  let entry = queryArrays.get(key)
  if (!entry) {
    let v: string[] = []
    entry = {
      get value() { return v },
      setValue: (next: string[]) => { v = next },
    } as unknown as { value: string[]; setValue: (v: string[]) => void }
    queryArrays.set(key, entry)
  }
  return entry
}

mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (key: string, defaultValue: string = '') => {
    const entry = getQueryString(key, defaultValue)
    return [entry.value, entry.setValue, entry.setValue] as const
  },
  useQueryArrayState: (key: string) => {
    const entry = getQueryArray(key)
    return [entry.value, entry.setValue] as const
  },
}))

mock.module('@/hooks/use-debug', () => ({
  useDebug: () => [false, mock()] as const,
}))

interface MockSearchHook {
  results: Array<{ id: string; score: number; table: string; fields: Record<string, unknown> }>
  aggregations: Record<string, Array<{ value: string; count: number }>>
  loading: boolean
  error: string | null
  meta: null
  search: ReturnType<typeof mock>
  clear: ReturnType<typeof mock>
}

const searchHookState: MockSearchHook = {
  results: [],
  aggregations: {},
  loading: false,
  error: null,
  meta: null,
  search: mock(),
  clear: mock(),
}

mock.module('@/hooks/use-search', () => ({
  useSearch: () => searchHookState,
  reorderBySearchResults: <T,>(items: T[]) => items,
}))

const useAssetsState: { assets: AssetMeta[]; total: number; loading: boolean } = {
  assets: [],
  total: 0,
  loading: true,
}

mock.module('@/hooks/use-assets', () => ({
  useAssets: () => ({
    assets: useAssetsState.assets,
    total: useAssetsState.total,
    loading: useAssetsState.loading,
    refresh: mock(),
    deleteAsset: mock(),
  }),
  useTrash: () => ({
    items: [],
    loading: false,
    restoreAsset: mock(),
    permanentDeleteAsset: mock(),
    emptyTrash: mock(),
  }),
}))

// ─── Child component stubs ────────────────────────────────────────────────
// Each is `() => null` except AssetsGrid which captures its props so we
// can assert what the page passed.

const assetsGridProps: { current: { assets?: AssetMeta[] } } = { current: {} }

mock.module('../../../plugins/assets/components/assets-grid', () => ({
  AssetsGrid: (props: { assets: AssetMeta[] }) => {
    assetsGridProps.current = props
    return (
      <div data-testid="assets-grid" data-count={props.assets.length}>
        {props.assets.map(a => (
          <div key={a.path} data-testid="asset-card">{a.filename}</div>
        ))}
      </div>
    )
  },
}))

mock.module('../../../plugins/assets/components/assets-list', () => ({
  AssetsList: () => null,
}))

mock.module('../../../plugins/assets/components/trash-grid', () => ({
  TrashGrid: () => null,
}))

mock.module('../../../plugins/assets/components/asset-detail', () => ({
  AssetDetail: () => null,
}))

mock.module('../../../plugins/assets/components/asset-filters', () => ({
  AssetFilters: () => <div data-testid="asset-filters" />,
}))

mock.module('../../../plugins/assets/components/asset-pagination', () => ({
  AssetPagination: () => null,
}))

mock.module('../../../plugins/assets/components/upload-dialog', () => ({
  UploadDialog: () => null,
}))

// Import AFTER all mocks are declared.
import { AssetsPage } from '../../../plugins/assets/components/assets-page'

// ─── Fixtures ─────────────────────────────────────────────────────────────

function makeAsset(overrides: Partial<AssetMeta> = {}): AssetMeta {
  return {
    path: 'assets/images/task-001/hero.png',
    filename: 'hero.png',
    type: 'images',
    size: 1024,
    metadata: {
      agent: 'pixel',
      taskId: 'task-001',
      created: '2026-04-01T00:00:00Z',
      description: 'A hero shot',
      tags: ['hero', 'banner'],
    },
    ...overrides,
  } as AssetMeta
}

function resetState() {
  queryStrings.clear()
  queryArrays.clear()
  searchHookState.results = []
  searchHookState.aggregations = {}
  searchHookState.search.mockClear()
  searchHookState.clear.mockClear()
  useAssetsState.assets = []
  useAssetsState.total = 0
  useAssetsState.loading = true
  assetsGridProps.current = {}
}

beforeEach(() => {
  resetState()
})

afterEach(() => {
  cleanup()
})

// ─── Tests ────────────────────────────────────────────────────────────────

describe('AssetsPage smoke', () => {
  it('renders loading state when useAssets is loading', () => {
    useAssetsState.loading = true
    render(<AssetsPage />)
    expect(screen.getByText(/Loading assets/i)).toBeDefined()
  })

  it('renders the grid view by default once loaded', () => {
    useAssetsState.loading = false
    useAssetsState.assets = [
      makeAsset({ path: 'assets/images/t1/a.png', filename: 'a.png' }),
      makeAsset({ path: 'assets/images/t1/b.png', filename: 'b.png' }),
    ]
    render(<AssetsPage />)
    const grid = screen.getByTestId('assets-grid')
    expect(grid).toBeDefined()
    expect(grid.getAttribute('data-count')).toBe('2')
  })

  it('passes search results down by ID, ordered by score', () => {
    useAssetsState.loading = false
    useAssetsState.assets = [
      makeAsset({ path: 'assets/images/t1/a.png', filename: 'a.png' }),
      makeAsset({ path: 'assets/images/t1/b.png', filename: 'b.png' }),
      makeAsset({ path: 'assets/images/t1/c.png', filename: 'c.png' }),
    ]
    // Seed search query state and search hook results
    getQueryString('q', '').setValue('hero')
    searchHookState.results = [
      { id: 'assets/images/t1/c.png', score: 0.9, table: 'bakin_assets', fields: {} },
      { id: 'assets/images/t1/a.png', score: 0.7, table: 'bakin_assets', fields: {} },
    ]

    render(<AssetsPage />)

    const filenames = (assetsGridProps.current.assets ?? []).map(a => a.filename)
    expect(filenames).toEqual(['c.png', 'a.png']) // ordered by score desc, b.png filtered out
  })

  it('falls back to local filename/description/tags/agent filter when search results are empty', () => {
    useAssetsState.loading = false
    useAssetsState.assets = [
      makeAsset({ path: 'p1', filename: 'cat.png', metadata: { agent: 'pixel', taskId: 't', created: '2026-04-01T00:00:00Z', description: '', tags: [] } }),
      makeAsset({ path: 'p2', filename: 'dog.png', metadata: { agent: 'pixel', taskId: 't', created: '2026-04-01T00:00:00Z', description: 'a cat photo', tags: [] } }),
      makeAsset({ path: 'p3', filename: 'fish.png', metadata: { agent: 'pixel', taskId: 't', created: '2026-04-01T00:00:00Z', description: '', tags: ['cat'] } }),
      makeAsset({ path: 'p4', filename: 'bird.png', metadata: { agent: 'pixel', taskId: 't', created: '2026-04-01T00:00:00Z', description: '', tags: [] } }),
    ]
    getQueryString('q', '').setValue('cat')
    searchHookState.results = [] // force fallback path

    render(<AssetsPage />)

    const filenames = (assetsGridProps.current.assets ?? []).map(a => a.filename)
    // bird.png has no match anywhere → excluded. The other three each match
    // via filename, description, or tag.
    expect(filenames).toContain('cat.png')
    expect(filenames).toContain('dog.png')
    expect(filenames).toContain('fish.png')
    expect(filenames).not.toContain('bird.png')
  })

  it('intersects multi-select type filter with search results', () => {
    useAssetsState.loading = false
    useAssetsState.assets = [
      makeAsset({ path: 'p1', filename: 'a.png', type: 'images' }),
      makeAsset({ path: 'p2', filename: 'b.md', type: 'text' }),
      makeAsset({ path: 'p3', filename: 'c.json', type: 'data' }),
    ]
    // Two-element type filter triggers the typeFilter intersection branch
    getQueryArray('type').setValue(['images', 'text'])
    getQueryString('q', '').setValue('hero')
    // Search returns ALL three IDs; the multi-type filter should prune
    // the data type before the search-result intersection runs.
    searchHookState.results = [
      { id: 'p1', score: 0.9, table: 'bakin_assets', fields: {} },
      { id: 'p2', score: 0.8, table: 'bakin_assets', fields: {} },
      { id: 'p3', score: 0.7, table: 'bakin_assets', fields: {} },
    ]

    render(<AssetsPage />)

    const filenames = (assetsGridProps.current.assets ?? []).map(a => a.filename)
    expect(filenames).toContain('a.png')
    expect(filenames).toContain('b.md')
    expect(filenames).not.toContain('c.json') // dropped by type filter
  })
})
