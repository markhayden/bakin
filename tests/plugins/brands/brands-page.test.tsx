// @vitest-environment jsdom
/**
 * Branding list page (UX cleanup spec §5): header search + New Brand chooser,
 * cover-art cards with completeness, empty-state-as-chooser, draft-first
 * ordering, path-route navigation.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { settleReact } from '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// jsdom component test — no storage access. Defensive content-dir mocks per
// the repo's test-isolation convention.
const testDir = join(tmpdir(), 'bakin-test-brands-page')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

const navigateMock = mock()
mock.module('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({}),
  useRouter: () => ({ history: { block: () => () => {} }, parseLocation: (l: unknown) => l }),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))

// URL-backed search filter — plain state stand-in for the URL param.
mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (_key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(defaultValue)
  },
  useQueryArrayState: () => [[], () => {}],
}))

// The wizard drawer has its own coverage concerns — stub it to a marker.
mock.module('../../../plugins/brands/components/brand-builder', () => ({
  BrandBuilder: ({ open }: { open: boolean }) => (open ? <div data-testid="builder-open" /> : null),
}))

// Debounce behavior is PluginHeader's own tested concern
// (tests/components/plugin-header.test.tsx) — here search syncs immediately.
mock.module('@/components/plugin-header', () => ({
  PluginHeader: ({
    title,
    actions,
    search,
  }: {
    title: string
    actions?: React.ReactNode
    search?: { value: string; onChange: (v: string) => void; placeholder?: string }
  }) => (
    <div>
      <h1>{title}</h1>
      {search && (
        <input
          placeholder={search.placeholder}
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
        />
      )}
      {actions}
    </div>
  ),
}))

import { BrandsPage } from '../../../plugins/brands/components/brands-page'

const BRANDS = {
  brands: [
    {
      id: 'acme',
      name: 'Acme',
      description: 'Developer tools for sharp teams.',
      palette: [{ name: 'Primary', hex: '#FF5A00' }],
      logos: [],
      assetGroups: [],
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
      counts: { guidelines: 4, lessons: 12, assets: 8 },
      completeness: { percent: 75, missing: ['logo', 'terminology'] },
    },
    {
      id: 'northwind',
      name: 'Northwind',
      draft: true,
      palette: [],
      logos: [],
      assetGroups: [],
      createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:00.000Z',
      counts: { guidelines: 2, lessons: 0, assets: 0 },
      completeness: { percent: 25, missing: ['logo'] },
    },
  ],
  invalid: [],
}

beforeEach(() => {
  navigateMock.mockClear()
  globalThis.fetch = mock(async () => new Response(JSON.stringify(BRANDS), { status: 200 })) as unknown as typeof fetch
})

afterEach(() => cleanup())

describe('BrandsPage', () => {
  it('renders header with search + New Brand action and the brand cards', async () => {
    await act(async () => {
      render(<BrandsPage />)
    })
    await waitFor(() => expect(screen.getByText('Acme')).toBeDefined())
    expect(screen.getByText('Branding')).toBeDefined()
    expect(document.querySelector('[data-new-brand]')).not.toBeNull()
    expect(screen.getByText('Northwind')).toBeDefined()
    expect(screen.getByText(/4 docs · 12 lessons · 8 assets/)).toBeDefined()
    await settleReact()
  })

  it('drafts sort before published brands', async () => {
    await act(async () => {
      render(<BrandsPage />)
    })
    await waitFor(() => expect(screen.getByText('Acme')).toBeDefined())
    const cards = Array.from(document.querySelectorAll('[data-brand-card]')).map((el) =>
      el.getAttribute('data-brand-card'),
    )
    expect(cards).toEqual(['northwind', 'acme'])
    await settleReact()
  })

  it('cards carry the completeness meter and clicking navigates to the path route', async () => {
    await act(async () => {
      render(<BrandsPage />)
    })
    await waitFor(() => expect(screen.getByText('Acme')).toBeDefined())
    expect(document.querySelector('[data-brand-completeness="75"]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-brand-card="acme"]')!)
    expect(navigateMock).toHaveBeenCalledWith({ to: '/brands/$brandId', params: { brandId: 'acme' } })
    await settleReact()
  })

  it('New Brand opens the three-path chooser; picking Build opens the wizard', async () => {
    await act(async () => {
      render(<BrandsPage />)
    })
    await waitFor(() => expect(screen.getByText('Acme')).toBeDefined())
    fireEvent.click(document.querySelector('[data-new-brand]')!)
    await waitFor(() => expect(document.querySelectorAll('[data-create-path]').length).toBe(3))
    fireEvent.click(document.querySelector('[data-create-path="build"]')!)
    await waitFor(() => expect(screen.getByTestId('builder-open')).toBeDefined())
    await settleReact()
  })

  it('search filters the grid', async () => {
    await act(async () => {
      render(<BrandsPage />)
    })
    await waitFor(() => expect(screen.getByText('Acme')).toBeDefined())
    const search = screen.getByPlaceholderText('Search brands...')
    fireEvent.change(search, { target: { value: 'north' } })
    await waitFor(() => expect(screen.queryByText('Acme')).toBeNull())
    expect(screen.getByText('Northwind')).toBeDefined()
    await settleReact()
  })

  it('empty library renders the inline chooser paths, not a bare button', async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ brands: [], invalid: [] }), { status: 200 })) as unknown as typeof fetch
    await act(async () => {
      render(<BrandsPage />)
    })
    await waitFor(() => expect(document.querySelector('[data-brands-empty]')).not.toBeNull())
    expect(document.querySelectorAll('[data-create-path]').length).toBe(3)
    expect(screen.getByText(/Give your agents a brand kit/)).toBeDefined()
    await settleReact()
  })

  it('shows skeletons while loading, never a blank pane', async () => {
    globalThis.fetch = mock(() => new Promise(() => {})) as unknown as typeof fetch
    await act(async () => {
      render(<BrandsPage />)
    })
    expect(document.querySelector('[data-brands-loading]')).not.toBeNull()
  })

  it('legacy /brands?brand=<id> deep links redirect to the path route', async () => {
    // happy-dom: history.replaceState doesn't sync window.location — use setURL
    const happy = (window as unknown as { happyDOM?: { setURL: (u: string) => void } }).happyDOM
    if (happy) happy.setURL('http://localhost/brands?brand=acme')
    else window.history.replaceState(null, '', '/brands?brand=acme')
    await act(async () => {
      render(<BrandsPage />)
    })
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: '/brands/$brandId', params: { brandId: 'acme' }, replace: true }),
      ),
    )
    if (happy) happy.setURL('http://localhost/')
    else window.history.replaceState(null, '', '/')
    await settleReact()
  })
})
