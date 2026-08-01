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
const routerPushMock = mock()
const routerReplaceMock = mock()
mock.module('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({}),
  useRouter: () => ({ history: { block: () => () => {} }, parseLocation: (l: unknown) => l }),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))

// URL-backed search filter — plain state stand-in for the URL param.
mock.module('@makinbakin/sdk/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: routerReplaceMock,
    back: mock(),
    forward: mock(),
    refresh: mock(),
    prefetch: mock(),
  }),
  useQueryState: (_key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(defaultValue)
  },
  useQueryArrayState: () => [[], () => {}],
}))

import { BrandsPage } from '../../../plugins/brands/components/brands-page'

const BRANDS = {
  brands: [
    {
      id: 'acme',
      name: 'Acme',
      description: 'Developer tools for sharp teams.',
      palette: [{ name: 'Primary', hex: '#FF5A00' }],
      logos: [{ assetId: 'acme-logo', variant: 'primary' }],
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
  routerPushMock.mockClear()
  routerReplaceMock.mockClear()
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
    expect(document.querySelector('[data-archetype="page"]')).not.toBeNull()
    const header = document.querySelector('[data-slot="page-header"]')
    const controls = header?.querySelector('[data-slot="page-header-controls"]')
    const search = controls?.querySelector(':scope > [data-slot="search-input-reserve"]')
    expect(header).not.toBeNull()
    expect(search).not.toBeNull()
    expect(search?.querySelector('input[aria-label="Brand search"]')).not.toBeNull()
    expect(header?.querySelector('[data-slot="page-header-actions"] [data-new-brand]')).not.toBeNull()
    expect(document.querySelector('[data-new-brand]')).not.toBeNull()
    expect(document.querySelector('[data-brand-card="acme"] [data-brand-logo]')?.getAttribute('src')).toBe('/api/assets/acme-logo')
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
    expect(routerPushMock).toHaveBeenCalledWith('/brands/acme')
    await settleReact()
  })

  it('pins unequal-height card content to the top of its grid row', async () => {
    render(<BrandsPage />)
    await waitFor(() => expect(screen.getByText('Acme')).toBeDefined())
    const card = document.querySelector('[data-brand-card="northwind"]')
    expect(card?.classList.contains('flex')).toBe(true)
    expect(card?.classList.contains('flex-col')).toBe(true)
    expect(card?.querySelector('[data-brand-card-body]')?.classList.contains('flex-1')).toBe(true)
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
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Build my brand' })).toBeDefined())
    expect(screen.getByRole('list', { name: 'Brand creation progress' })).toBeDefined()
    await settleReact()
  })

  it('search filters the grid', async () => {
    await act(async () => {
      render(<BrandsPage />)
    })
    await waitFor(() => expect(screen.getByText('Acme')).toBeDefined())
    const search = screen.getByRole('searchbox', { name: 'Brand search' })
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
    expect(document.querySelector('[data-brands-loading]')?.closest('[data-kind="loading"]')).not.toBeNull()
  })

  it('uses a recoverable result-region error with retry instead of loose error text', async () => {
    globalThis.fetch = mock(async () => new Response('unavailable', { status: 503 })) as unknown as typeof fetch
    render(<BrandsPage />)
    await waitFor(() => expect(document.querySelector('[data-kind="error"]')).not.toBeNull())
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
    expect(document.querySelector('[data-kind="error"]')?.closest('[data-slot="page-body"]')).not.toBeNull()
    await settleReact()
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
      expect(routerReplaceMock).toHaveBeenCalledWith('/brands/acme'),
    )
    if (happy) happy.setURL('http://localhost/')
    else window.history.replaceState(null, '', '/')
    await settleReact()
  })
})
