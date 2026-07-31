// @vitest-environment jsdom
/**
 * Assets tab rework (UX cleanup spec §7f): every add goes through the shared
 * AssetPicker (no raw id select), section empty states explain themselves, and
 * manifest ref changes stage into the SaveBar draft instead of PUTting.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../rtl-settle'
import { settleReact } from '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// jsdom component test — no storage access. Defensive content-dir mocks per
// the repo's test-isolation convention.
const testDir = join(tmpdir(), 'bakin-test-brand-assets-tab')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

mock.module('@tanstack/react-router', () => ({
  useNavigate: () => mock(),
  useParams: () => ({ brandId: 'acme' }),
  useRouter: () => ({ history: { block: () => () => {} }, parseLocation: (l: unknown) => l }),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))
mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (_key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(defaultValue)
  },
}))

import { BrandDetail } from '../../../plugins/brands/components/brand-detail'

const BRAND = {
  id: 'acme',
  name: 'Acme',
  palette: [],
  logos: [{ assetId: 'logo-1', variant: 'primary' }],
  assetGroups: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
}
const DETAIL = { brand: BRAND, guidelines: [], lessons: [], fingerprint: 'sha256:x' }
const LIBRARY = { assets: [{ assetId: 'shot-1', description: 'Billing screenshot', type: 'images', hasThumb: true }] }

let putCount: number
beforeEach(() => {
  putCount = 0
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'PUT') {
      putCount++
      return new Response('{}', { status: 200 })
    }
    if (url.includes('/api/plugins/assets/versioned')) return new Response(JSON.stringify(LIBRARY), { status: 200 })
    if (url.endsWith('/api/plugins/brands/acme')) return new Response(JSON.stringify(DETAIL), { status: 200 })
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
})

afterEach(() => cleanup())

async function renderAssets() {
  render(<BrandDetail brandId="acme" onBack={() => {}} />)
  await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))
  fireEvent.click(screen.getByRole('tab', { name: 'Assets' }))
  await waitFor(() => expect(document.querySelector('[data-add-logo]')).not.toBeNull())
}

describe('assets tab', () => {
  it('three sections with why-it-matters descriptions and empty states', async () => {
    await renderAssets()
    expect(screen.getByText(/The face of the brand/)).toBeDefined()
    expect(screen.getByText(/Bundles of reference material/)).toBeDefined()
    expect(screen.getByText(/image tools consume these directly/i)).toBeDefined()
    expect(screen.getByText(/No groups yet/)).toBeDefined()
    expect(screen.getByText(/None yet — without references/)).toBeDefined()
    await settleReact()
  })

  it('Add reference opens the AssetPicker; picking STAGES the ref (SaveBar up, no PUT)', async () => {
    await renderAssets()
    fireEvent.click(document.querySelector('[data-add-image-ref]')!)
    await waitFor(() => expect(document.querySelector('[data-asset-picker]')).not.toBeNull())
    await waitFor(() => expect(screen.getByText('Billing screenshot')).toBeDefined())

    fireEvent.click(document.querySelector('[data-asset-picker-item="shot-1"]')!)
    await waitFor(() => expect(document.querySelector('[data-savebar]')).not.toBeNull())
    expect(putCount).toBe(0)
    await settleReact()
  })

  it('logo variant is a labeled select and changing it stages', async () => {
    await renderAssets()
    // Kit Select (refit T6.5): trigger + listbox option, not a native <select>.
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Logo variant' }))
    await user.click(await screen.findByRole('option', { name: 'dark' }))
    await waitFor(() => expect(document.querySelector('[data-savebar]')).not.toBeNull())
    expect(putCount).toBe(0)
    await settleReact()
  })

  it('removing a reference confirms first, then STAGES (honest keep-in-library copy)', async () => {
    await renderAssets()
    fireEvent.click(screen.getByLabelText('Remove'))
    await screen.findByText('Remove this reference?')
    expect(screen.getByText(/stays in your asset library/)).toBeDefined()
    expect(document.querySelector('[data-savebar]')).toBeNull() // not yet

    fireEvent.click(screen.getByTestId('asset-remove-confirm'))
    await waitFor(() => expect(document.querySelector('[data-savebar]')).not.toBeNull())
    expect(putCount).toBe(0) // staged, not written
    await settleReact()
  })

  it('no raw asset-id select exists anywhere on the tab', async () => {
    await renderAssets()
    // Zero native selects (refit T6.5): the logo-variant picker is the kit
    // Select (combobox trigger), and asset ids only ever ride the AssetPicker.
    expect(document.querySelectorAll('select').length).toBe(0)
    expect(screen.getByRole('combobox', { name: 'Logo variant' })).toBeDefined()
    await settleReact()
  })
})
