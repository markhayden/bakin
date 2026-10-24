/**
 * `/brands/<id>?recover=1` (self-healing PR1 slice 1.4a): dangling asset
 * references are listed with where they are used; Detach confirms, posts the
 * ids, reloads, and reruns the integrity check.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '../../rtl-settle'

mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

import { BrandRecoverPage, type BrandRecoveryReport } from '../../../plugins/brands/components/brand-recover'

let report: BrandRecoveryReport
let requests: Array<{ url: string; method: string; body: unknown }>
const realFetch = globalThis.fetch
beforeEach(() => {
  requests = []
  report = {
    brandId: 'acme', status: 'ok', name: 'Acme',
    dangling: [{ assetId: 'gone-logo', where: 'logo (dark)' }, { assetId: 'gone-hero', where: 'group hero' }],
    tasks: [{ taskId: 't-1', title: 'Launch notes', column: 'todo' }], tasksKnown: true,
  }
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as { assetIds?: string[] } : undefined
    requests.push({ url, method, body })
    if (url === '/api/plugins/brands/acme/recover' && method === 'GET') return Response.json(report)
    if (url === '/api/plugins/brands/acme/recover/detach') {
      report = { ...report, dangling: report.dangling.filter((ref) => !body?.assetIds?.includes(ref.assetId)) }
      return Response.json({ detached: body?.assetIds ?? [], brand: {} })
    }
    if (url === '/api/plugins/brands/acme/recover/recreate') {
      report = { ...report, status: 'ok', error: undefined, raw: undefined }
      return Response.json({ ok: true })
    }
    if (url === '/api/plugins/brands/acme' && method === 'DELETE') return Response.json({ ok: true })
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
    // The usage fact is stated with the task linked.
    expect(screen.getByText(/1 open task uses this brand/)).toBeTruthy()
    expect((screen.getByRole('link', { name: 'Launch notes' }) as HTMLAnchorElement).getAttribute('href')).toBe('/tasks?taskId=t-1')
  })
  it('an unreadable manifest shows the raw file, offers Recreate (confirmed) and the typed-confirm delete; recreate reruns the check', async () => {
    report = { ...report, status: 'invalid', error: 'brand.json is not valid JSON: Unexpected end', raw: '{ "id": "acme", "name": "Acme Corp"', dangling: [] }
    const onDeleted = mock()
    await act(async () => { render(<BrandRecoverPage brandId="acme" onExit={() => {}} onDeleted={onDeleted} />) })
    await waitFor(() => expect(screen.getByRole('list', { name: 'Repairs' })).toBeTruthy())
    expect(screen.getByText(/brand\.json is unreadable: brand\.json is not valid JSON/)).toBeTruthy()
    expect(screen.getByText('{ "id": "acme", "name": "Acme Corp"')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recreate manifest' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Recreate the manifest?' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Recreate' })) })
    await waitFor(() => expect(requests.some((r) => r.url === '/api/plugins/brands/acme/recover/recreate' && r.method === 'POST')).toBe(true))
    await waitFor(() => expect(screen.getByText('brand.json is valid.')).toBeTruthy())
    expect(requests.find((r) => r.url === '/api/plugins/health/doctor/run')).toMatchObject({ body: { checkIds: ['brands.integrity'] } })

    // Delete is the typed-confirm last resort and reports back to the caller.
    cleanup()
    report = { ...report, status: 'invalid', error: 'broken', raw: '{' }
    await act(async () => { render(<BrandRecoverPage brandId="acme" onExit={() => {}} onDeleted={onDeleted} />) })
    const zone = await screen.findByRole('region', { name: 'Delete brand' })
    await act(async () => { fireEvent.click(within(zone).getByRole('button', { name: 'Delete brand' })) })
    const confirm = await screen.findByRole('dialog', { name: 'Delete this brand?' })
    await act(async () => { fireEvent.change(within(confirm).getByRole('textbox'), { target: { value: 'acme' } }) })
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'Delete brand' })) })
    await waitFor(() => expect(requests.some((r) => r.url === '/api/plugins/brands/acme' && r.method === 'DELETE')).toBe(true))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
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
