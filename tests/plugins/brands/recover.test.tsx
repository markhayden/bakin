/**
 * `/brands/<id>?recover=1` (self-healing PR1 slice 1.4a): dangling asset
 * references are listed with where they are used; Detach confirms, posts the
 * ids, reloads, and reruns the integrity check.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '../../rtl-settle'

import { BrandRecoverPage } from '../../../plugins/brands/components/brand-recover'

let dangling: Array<{ assetId: string; where: string }>
let requests: Array<{ url: string; method: string; body: unknown }>
const realFetch = globalThis.fetch
beforeEach(() => {
  requests = []
  dangling = [{ assetId: 'gone-logo', where: 'logo (dark)' }, { assetId: 'gone-hero', where: 'group hero' }]
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as { assetIds?: string[] } : undefined
    requests.push({ url, method, body })
    if (url === '/api/plugins/brands/acme/integrity') return Response.json({ findings: dangling.length ? [{ brandId: 'acme', dangling, draft: false, staleDraft: false }] : [], invalid: [] })
    if (url === '/api/plugins/brands/acme/recover/detach') {
      dangling = dangling.filter((ref) => !body?.assetIds?.includes(ref.assetId))
      return Response.json({ detached: body?.assetIds ?? [], brand: {} })
    }
    return Response.json({})
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('BrandRecoverPage', () => {
  it('lists each dangling reference with where it is used, and offers Detach per row plus Detach all', async () => {
    await act(async () => { render(<BrandRecoverPage brandId="acme" brandName="Acme" onExit={() => {}} />) })
    await waitFor(() => expect(screen.getByRole('list', { name: 'Dangling references' })).toBeTruthy())
    expect(screen.getByRole('heading', { level: 1, name: 'Recover Acme' })).toBeTruthy()
    expect(screen.getByText('gone-logo')).toBeTruthy()
    expect(screen.getByText(/Referenced as logo \(dark\)/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Detach' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Detach all' })).toBeTruthy()
  })
  it('Detach confirms, posts exactly those ids, reloads the facts and reruns the integrity check; an empty result is a success banner', async () => {
    await act(async () => { render(<BrandRecoverPage brandId="acme" brandName="Acme" onExit={() => {}} />) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Detach all' })).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Detach all' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Detach 2 references?' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Detach' })) })
    await waitFor(() => expect(requests.find((r) => r.url === '/api/plugins/brands/acme/recover/detach')).toMatchObject({ method: 'POST', body: { assetIds: ['gone-logo', 'gone-hero'] } }))
    await waitFor(() => expect(screen.getByText('No dangling references')).toBeTruthy())
    expect(requests.find((r) => r.url === '/api/plugins/health/doctor/run')).toMatchObject({ body: { checkIds: ['brands.integrity'] } })
  })
})
