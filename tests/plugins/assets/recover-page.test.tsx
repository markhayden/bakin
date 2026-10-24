/**
 * `/assets/<id>?recover=1` (self-healing PR1 slice 1.4a): the recover page
 * states the facts, offers only the repairs the facts allow, confirms each
 * one, runs it, and re-verifies through Health; trash is the typed-confirm
 * last resort that returns to the list.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '../../rtl-settle'

const push = mock()
mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useHistoryBack: () => () => {},
  useParams: () => ({ assetId: '20260704-recover-a1b2c3d4' }),
  useQueryState: (_key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(defaultValue)
  },
  useRouter: () => ({ push, replace: mock(), back: mock(), forward: mock(), prefetch: mock(), refresh: mock() }),
}))

import { AssetRecoverPage } from '../../../plugins/assets/components/versioned/AssetRecover'
import type { AssetRecoveryReport } from '../../../plugins/assets/components/versioned/types'

const ID = '20260704-recover-a1b2c3d4'
const BASE = `/api/plugins/assets/versioned/${ID}`
let report: AssetRecoveryReport
let requests: Array<{ url: string; method: string; body: unknown }>
let fail: string | null

const realFetch = globalThis.fetch
beforeEach(() => {
  push.mockClear()
  requests = []
  fail = null
  report = {
    assetId: ID, dirExists: true,
    manifest: { status: 'ok', type: 'text', currentVersion: 2, currentVersionPresent: false, taskId: null },
    filesOnDisk: [{ name: 'v1.txt', size: 3 }, { name: 'exports/plain.txt', size: 9 }],
    versionFiles: [{ version: 1, file: 'v1.txt', size: 3 }],
    versions: [{ version: 1, file: 'v1.txt', present: true }, { version: 2, file: 'v2.txt', present: false }],
    exports: [{ name: 'plain', file: 'exports/plain.txt', fromVersion: 2, present: true }],
    references: { known: true, task: { taskId: 't-7', title: 'Launch notes', open: true }, brands: [{ brandId: 'acme', where: 'logo (dark)' }] },
  }
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === `${BASE}/recover`) return Response.json(report)
    if (fail && url.endsWith(fail)) return Response.json({ error: 'the engine said no' }, { status: 400 })
    if (url.startsWith(`${BASE}/recover/`)) {
      // the repair fixed it: versions now consistent
      report = { ...report, manifest: { status: 'ok', type: 'text', currentVersion: 1, currentVersionPresent: true, taskId: null }, versions: [{ version: 1, file: 'v1.txt', present: true }] }
      return Response.json({ ok: true })
    }
    if (url === BASE && method === 'DELETE') return Response.json({ ok: true, trashName: 'x' })
    return Response.json({})
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

async function renderPage() {
  const onExit = mock()
  await act(async () => { render(<AssetRecoverPage assetId={ID} onExit={onExit} />) })
  await waitFor(() => expect(screen.getByRole('list', { name: 'Repairs' })).toBeTruthy())
  return onExit
}

describe('AssetRecoverPage', () => {
  it('states the facts and enables only the repairs the facts allow (a valid manifest cannot be rebuilt; missing versions can be detached; a present export can be restored)', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Recover asset' })).toBeTruthy()
    expect(screen.getByText(/manifest\.json is valid — current version v2 \(its file is missing\)/)).toBeTruthy()
    expect(screen.getByText(/v1 present, v2 MISSING/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Rebuild manifest' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Detach missing' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Restore from export' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('region', { name: 'Move to trash' })).toBeTruthy()
  })

  it('a repair is confirmed, posted, then the facts reload and the originating Health check reruns', async () => {
    await renderPage()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Detach missing' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Detach the missing versions?' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' })) })
    await waitFor(() => expect(requests.some((r) => r.url === `${BASE}/recover/detach-missing` && r.method === 'POST')).toBe(true))
    await waitFor(() => expect(screen.getByText(/manifest\.json is valid — current version v1\./)).toBeTruthy())
    const rerun = requests.find((r) => r.url === '/api/plugins/health/doctor/run')
    expect(rerun).toMatchObject({ method: 'POST', body: { checkIds: ['assets.assets'] } })
    expect((screen.getByRole('button', { name: 'Detach missing' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a refused repair shows the engine\'s reason and changes nothing', async () => {
    fail = '/recover/restore-export'
    await renderPage()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore from export' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Restore from “plain”?' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' })) })
    await waitFor(() => expect(screen.getByText('the engine said no')).toBeTruthy())
    expect(requests.some((r) => r.url === '/api/plugins/health/doctor/run')).toBe(false)
  })

  it('a missing manifest offers Rebuild (when version files exist) and the typed-confirm trash returns to the list', async () => {
    report = { ...report, manifest: { status: 'missing' }, versions: [], exports: [] }
    await renderPage()
    expect(screen.getByText('manifest.json is missing.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Rebuild manifest' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Detach missing' }) as HTMLButtonElement).disabled).toBe(true)
    const zone = screen.getByRole('region', { name: 'Move to trash' })
    await act(async () => { fireEvent.click(within(zone).getByRole('button', { name: 'Move to trash' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Move this asset to the trash?' })
    await act(async () => { fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: ID } }) })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Move to trash' })) })
    await waitFor(() => expect(requests.some((r) => r.url === BASE && r.method === 'DELETE')).toBe(true))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/assets'))
  })

  it('Detach references (spec §3.9) names the task and brands that still point at the asset, confirms, posts, reloads and reruns the check; nothing to detach disables it', async () => {
    await renderPage()
    expect(screen.getByText(/Still referenced by task Launch notes, brand acme \(logo \(dark\)\)/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Detach references' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Detach every reference?' })
    expect(dialog.textContent).toContain('task Launch notes, brand acme (logo (dark)) will no longer point at')
    report = { ...report, references: { known: true, task: null, brands: [] } }
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' })) })
    await waitFor(() => expect(requests.some((r) => r.url === `${BASE}/recover/detach-references` && r.method === 'POST')).toBe(true))
    await waitFor(() => expect(screen.getByText('Nothing references this asset.')).toBeTruthy())
    expect((screen.getByRole('button', { name: 'Detach references' }) as HTMLButtonElement).disabled).toBe(true)
    expect(requests.find((r) => r.url === '/api/plugins/health/doctor/run')).toMatchObject({ body: { checkIds: ['assets.assets'] } })
  })

  it('an unreadable usage leg is said so, never shown as "nothing references it"', async () => {
    report = { ...report, references: { known: false, task: null, brands: [] } }
    await renderPage()
    expect(screen.getByText(/could not be fully read/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Detach references' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a directory that no longer exists is an honest end state, not a spinner', async () => {
    globalThis.fetch = mock(async () => Response.json({ error: 'Not found' }, { status: 404 })) as unknown as typeof fetch
    await act(async () => { render(<AssetRecoverPage assetId={ID} onExit={() => {}} />) })
    await waitFor(() => expect(screen.getByText('Nothing to recover')).toBeTruthy())
  })
})
