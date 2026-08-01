// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { settleReact } from '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure jsdom component test — no storage access. Defensive content-dir mocks per
// the repo's test-isolation convention.
const testDir = join(tmpdir(), 'bakin-test-asset-picker')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { AssetLibraryPicker } from '@makinbakin/sdk/patterns'

const LIBRARY = {
  assets: [
    { assetId: 'logo-1', description: 'Primary logo', type: 'images', hasThumb: true },
    { assetId: 'shot-1', description: 'Billing screenshot', type: 'images', hasThumb: true },
    { assetId: 'doc-1', description: 'Spec PDF', type: 'docs', hasThumb: false },
  ],
}

let fetchMock: ReturnType<typeof mock>
beforeEach(() => {
  fetchMock = mock(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/plugins/assets/versioned')) {
      return new Response(JSON.stringify(LIBRARY), { status: 200 })
    }
    if (url.includes('/api/plugins/assets/upload')) {
      return new Response(JSON.stringify({ assetId: 'fresh-1' }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => cleanup())

describe('AssetLibraryPicker', () => {
  it('loads the library and picks an asset', async () => {
    const onPick = mock()
    const onOpenChange = mock()
    render(<AssetLibraryPicker open onOpenChange={onOpenChange} onPick={onPick} />)

    await waitFor(() => expect(screen.getByText('Primary logo')).toBeDefined())
    fireEvent.click(document.querySelector('[data-asset-picker-item="logo-1"]')!)
    expect(onPick).toHaveBeenCalledWith('logo-1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    await settleReact()
  })

  it('filters by search query over description and id', async () => {
    render(<AssetLibraryPicker open onOpenChange={() => {}} onPick={() => {}} />)
    await waitFor(() => expect(screen.getByText('Primary logo')).toBeDefined())

    fireEvent.change(document.querySelector('[data-asset-picker-search]')!, { target: { value: 'billing' } })
    expect(screen.queryByText('Primary logo')).toBeNull()
    expect(screen.getByText('Billing screenshot')).toBeDefined()
    await settleReact()
  })

  it('applies the caller filter', async () => {
    render(<AssetLibraryPicker open onOpenChange={() => {}} onPick={() => {}} filter={(a) => a.type === 'images'} />)
    await waitFor(() => expect(screen.getByText('Primary logo')).toBeDefined())
    expect(screen.queryByText('Spec PDF')).toBeNull()
    await settleReact()
  })

  it('upload picks the fresh asset', async () => {
    const onPick = mock()
    render(<AssetLibraryPicker open onOpenChange={() => {}} onPick={onPick} />)
    await waitFor(() => expect(screen.getByText('Primary logo')).toBeDefined())

    const fileInput = document.querySelector('input[type="file"]')!
    const file = new File(['x'], 'logo.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('fresh-1'))
    await settleReact()
  })

  it('renders an honest error state when the library is unreachable', async () => {
    fetchMock = mock(async () => new Response('down', { status: 503 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    render(<AssetLibraryPicker open onOpenChange={() => {}} onPick={() => {}} />)
    await waitFor(() => expect(screen.getByText(/Couldn't load your assets/)).toBeDefined())
    await settleReact()
  })

  it('renders an empty state when the library has nothing', async () => {
    fetchMock = mock(async () => new Response(JSON.stringify({ assets: [] }), { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    render(<AssetLibraryPicker open onOpenChange={() => {}} onPick={() => {}} />)
    await waitFor(() => expect(screen.getByText('No assets yet')).toBeDefined())
    await settleReact()
  })
})
