// @vitest-environment jsdom
/**
 * Staged save model (UX cleanup spec §7a): ONE draft manifest spans the detail
 * tabs; the SaveBar commits the whole manifest in a single PUT, Discard
 * restores server state, and invalid palette rows hold the save honestly.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { settleReact } from '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// jsdom component test — no storage access. Defensive content-dir mocks per
// the repo's test-isolation convention.
const testDir = join(tmpdir(), 'bakin-test-brand-detail-save')
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
// Markdown rendering is its own tested concern.
mock.module('@/components/markdown-content', () => ({
  MarkdownContent: ({ content }: { content: string }) => <pre>{content}</pre>,
}))
mock.module('@/components/markdown-editor', () => ({
  MarkdownEditor: ({ content }: { content: string }) => <textarea defaultValue={content} />,
}))

import { BrandDetail } from '../../../plugins/brands/components/brand-detail'

const BRAND = {
  id: 'acme',
  name: 'Acme',
  description: 'Developer tools.',
  palette: [{ name: 'Primary', hex: '#FF5A00', usage: 'buttons' }],
  rules: ['Never use emojis'],
  terminology: [{ term: 'workspace', rule: 'never dashboard' }],
  logos: [],
  assetGroups: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
}

const DETAIL = { brand: BRAND, guidelines: [], lessons: [], fingerprint: 'sha256:x' }

let putCalls: Array<Record<string, unknown>>
beforeEach(() => {
  putCalls = []
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'PUT' && url.endsWith('/api/plugins/brands/acme')) {
      putCalls.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return new Response(JSON.stringify({ brand: BRAND }), { status: 200 })
    }
    if (url.endsWith('/api/plugins/brands/acme')) {
      return new Response(JSON.stringify(DETAIL), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
})

afterEach(() => cleanup())

async function renderIdentity() {
  render(<BrandDetail brandId="acme" onBack={() => {}} />)
  await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))
  fireEvent.click(screen.getByRole('tab', { name: 'Identity' }))
  await waitFor(() => expect(screen.getByLabelText('Brand name')).toBeDefined())
}

describe('BrandDetail staged save model', () => {
  it('starts clean — no SaveBar', async () => {
    await renderIdentity()
    expect(document.querySelector('[data-savebar]')).toBeNull()
    await settleReact()
  })

  it('editing any field stages a draft and raises the SaveBar; Save PUTs the FULL manifest once', async () => {
    await renderIdentity()
    fireEvent.change(screen.getByLabelText('Brand name'), { target: { value: 'Acme Inc' } })
    fireEvent.change(screen.getByLabelText('Brand description'), { target: { value: 'Sharper tools.' } })
    await waitFor(() => expect(document.querySelector('[data-savebar]')).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Save brand' }))
    await waitFor(() => expect(putCalls.length).toBe(1))
    // one PUT carries EVERY manifest field, not a per-section patch
    expect(putCalls[0].name).toBe('Acme Inc')
    expect(putCalls[0].description).toBe('Sharper tools.')
    expect(putCalls[0].palette).toEqual(BRAND.palette)
    expect(putCalls[0].rules).toEqual(BRAND.rules)
    expect(putCalls[0].id).toBeUndefined() // identity stripped
    // publication state is server-owned — a staged snapshot must never carry it
    expect('draft' in putCalls[0]).toBe(false)
    expect('draftTaskId' in putCalls[0]).toBe(false)
    await settleReact()
  })

  it('Discard restores server state without a PUT', async () => {
    await renderIdentity()
    fireEvent.change(screen.getByLabelText('Brand name'), { target: { value: 'Renamed' } })
    await waitFor(() => expect(document.querySelector('[data-savebar]')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(document.querySelector('[data-savebar]')).toBeNull())
    expect((screen.getByLabelText('Brand name') as HTMLInputElement).value).toBe('Acme')
    expect(putCalls.length).toBe(0)
    await settleReact()
  })

  it('hex field and swatch are one value; invalid hex shows the teaching error and HOLDS save', async () => {
    await renderIdentity()
    const hexInput = screen.getByDisplayValue('#FF5A00')
    fireEvent.change(hexInput, { target: { value: 'blueish' } })
    await waitFor(() => expect(screen.getByText('Hex colors look like #FF5A00')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Save brand' }))
    await waitFor(() => expect(screen.getByText(/Fix the highlighted colors/)).toBeDefined())
    expect(putCalls.length).toBe(0) // held — no PUT with invalid rows
    await settleReact()
  })

  it('a pristine added row is dropped on save, not blocked', async () => {
    await renderIdentity()
    fireEvent.click(document.querySelector('[data-add-color]')!)
    await waitFor(() => expect(document.querySelector('[data-savebar]')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Save brand' }))
    await waitFor(() => expect(putCalls.length).toBe(1))
    expect((putCalls[0].palette as unknown[]).length).toBe(1) // blank row dropped
    await settleReact()
  })

  it('staged edits survive tab switches (one draft spans tabs)', async () => {
    await renderIdentity()
    fireEvent.change(screen.getByLabelText('Brand name'), { target: { value: 'Acme Inc' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Identity' }))
    await waitFor(() => expect((screen.getByLabelText('Brand name') as HTMLInputElement).value).toBe('Acme Inc'))
    expect(document.querySelector('[data-savebar]')).not.toBeNull()
    await settleReact()
  })

  it('freshness gate: a brand changed underneath blocks the first save (no PUT), saving again overwrites', async () => {
    // GET returns a NEWER updatedAt than the one the draft was staged from.
    let getCount = 0
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT' && url.endsWith('/api/plugins/brands/acme')) {
        putCalls.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return new Response(JSON.stringify({ brand: BRAND }), { status: 200 })
      }
      if (url.endsWith('/api/plugins/brands/acme')) {
        getCount++
        // first GET seeds the page; later GETs (the freshness probe) report a newer version
        const brand = getCount === 1 ? BRAND : { ...BRAND, updatedAt: '2026-07-12T09:00:00.000Z' }
        return new Response(JSON.stringify({ ...DETAIL, brand }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    await renderIdentity()
    fireEvent.change(screen.getByLabelText('Brand name'), { target: { value: 'Acme Inc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save brand' }))
    await waitFor(() => expect(screen.getByText(/changed while you were editing/)).toBeDefined())
    expect(putCalls.length).toBe(0) // held — never a silent overwrite

    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    await waitFor(() => expect(putCalls.length).toBe(1)) // deliberate overwrite
    await settleReact()
  })

  it('edits staged while a save is in flight survive the post-save clear', async () => {
    let resolvePut: (r: Response) => void = () => {}
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT' && url.endsWith('/api/plugins/brands/acme')) {
        putCalls.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return new Promise<Response>((r) => {
          resolvePut = r
        })
      }
      if (url.endsWith('/api/plugins/brands/acme')) {
        return new Response(JSON.stringify(DETAIL), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    await renderIdentity()
    fireEvent.change(screen.getByLabelText('Brand name'), { target: { value: 'Acme Inc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save brand' }))
    await waitFor(() => expect(putCalls.length).toBe(1))
    // keep typing while the PUT is in flight
    fireEvent.change(screen.getByLabelText('Brand description'), { target: { value: 'Typed mid-save.' } })
    resolvePut(new Response(JSON.stringify({ brand: BRAND }), { status: 200 }))
    // the mid-flight edit is still staged: bar stays up, text stays put
    await waitFor(() => expect(document.querySelector('[data-savebar]')?.getAttribute('data-savebar-state')).toBe('dirty'))
    expect((screen.getByLabelText('Brand description') as HTMLTextAreaElement).value).toBe('Typed mid-save.')
    await settleReact()
  })
})
