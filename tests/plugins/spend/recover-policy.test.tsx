/**
 * `/spend?recover=1` (self-healing PR1 slice 1.4b): the spend.json recover
 * editor shows the file and its issues, saves only a valid policy, and
 * "Start without limits" moves the file aside through a typed confirmation.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '../../rtl-settle'

import { SpendRecoverPage } from '../../../plugins/spend/components/spend-recover'

let file: { status: 'absent' | 'ok' | 'invalid'; text: string | null; issues: string[] }
let requests: Array<{ url: string; method: string; body?: unknown }>
const realFetch = globalThis.fetch
beforeEach(() => {
  requests = []
  file = { status: 'invalid', text: '{ "limits": { "rules": [ { "scope": "global", "lane": "metered", "dailyCap": "ten" } ] } }', issues: ['limits.rules.0.dailyCap: Expected number, received string'] }
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    requests.push({ url, method, body })
    if (url.endsWith('/api/plugins/spend/recover') && method === 'GET') return Response.json({ file: '/home/x/.bakin/plugin-settings/spend.json', ...file })
    if (url.endsWith('/api/plugins/spend/recover') && method === 'PUT') {
      const text = String(body?.text)
      if (text.includes('"ten"')) return Response.json({ error: 'not a valid spend policy', issues: ['limits.rules.0.dailyCap: Expected number, received string'] }, { status: 400 })
      return Response.json({ ok: true })
    }
    if (url.endsWith('/api/plugins/spend/recover/reset')) return Response.json({ ok: true, movedTo: '/x/spend.json.rejected-1' })
    return Response.json({})
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('SpendRecoverPage', () => {
  it('shows the file text and its issues; a save that is still invalid shows the new issues and writes nothing', async () => {
    const onExit = mock()
    await act(async () => { render(<SpendRecoverPage onExit={onExit} />) })
    await waitFor(() => expect(screen.getByLabelText('spend.json')).toBeTruthy())
    expect(screen.getByText(/limits\.rules\.0\.dailyCap/)).toBeTruthy()
    expect((screen.getByLabelText('spend.json') as HTMLTextAreaElement).value).toContain('"ten"')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Validate and save' })) })
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT')).toBe(true))
    expect(screen.queryByText('spend.json saved')).toBeNull()
    expect(requests.some((r) => r.url.endsWith('/doctor/run'))).toBe(false)
  })
  it('a corrected file saves, Health reruns the spend checks, and the success banner leads back', async () => {
    const onExit = mock()
    await act(async () => { render(<SpendRecoverPage onExit={onExit} />) })
    await waitFor(() => expect(screen.getByLabelText('spend.json')).toBeTruthy())
    await act(async () => { fireEvent.change(screen.getByLabelText('spend.json'), { target: { value: '{ "limits": { "rules": [] }, "billing": { "overrides": [] } }' } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Validate and save' })) })
    await waitFor(() => expect(screen.getByText('spend.json saved')).toBeTruthy())
    expect(requests.find((r) => r.url.endsWith('/doctor/run'))).toMatchObject({ body: { checkIds: ['spend.budget', 'health.spend-policy'] } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open Spend' })) })
    expect(onExit).toHaveBeenCalled()
  })
  it('"Start without limits" is a typed confirmation that moves the file aside and leaves the page', async () => {
    const onExit = mock()
    await act(async () => { render(<SpendRecoverPage onExit={onExit} />) })
    await waitFor(() => expect(screen.getByRole('region', { name: 'Start without limits' })).toBeTruthy())
    const zone = screen.getByRole('region', { name: 'Start without limits' })
    await act(async () => { fireEvent.click(within(zone).getByRole('button', { name: 'Start without limits' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Start without spending limits?' })
    await act(async () => { fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'spend.json' } }) })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Start without limits' })) })
    await waitFor(() => expect(requests.some((r) => r.url.endsWith('/recover/reset'))).toBe(true))
    await waitFor(() => expect(onExit).toHaveBeenCalled())
  })
  it('an absent file is an honest "nothing to fix"', async () => {
    file = { status: 'absent', text: null, issues: [] }
    await act(async () => { render(<SpendRecoverPage onExit={() => {}} />) })
    await waitFor(() => expect(screen.getByText('No limits file')).toBeTruthy())
    expect(screen.queryByLabelText('spend.json')).toBeNull()
  })
})
