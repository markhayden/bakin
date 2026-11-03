/**
 * The raw recovery editor under the REAL unsaved-changes guard (Codex r3 #7):
 * its identity lives in the query (`?recover=1&skill=…`), so a history move
 * that drops or changes the recover target — Back to `/workflows` — blocks a
 * dirty draft behind the decision, while another query key does not.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { settleReact } from '../../rtl-settle'

type Blocker = (args: { currentLocation: unknown; nextLocation: unknown }) => Promise<boolean>
let blockers: Blocker[] = []
const router = {
  navigate: () => {},
  history: { block: ({ blockerFn }: { blockerFn: Blocker }) => { blockers.push(blockerFn); return () => { blockers = blockers.filter((b) => b !== blockerFn) } } },
  parseLocation: (location: unknown) => location,
}
mock.module('@tanstack/react-router', () => ({
  ...require('../../shims/tanstack-router'),
  useRouter: () => router,
}))

import { WorkflowRecoverEditor, sameRecoverLocation } from '../../../plugins/workflows/components/workflow-recover-editor'

const at = (pathname: string, search: Record<string, string>) => ({ pathname, search, searchStr: Object.keys(search).length ? `?${new URLSearchParams(search).toString()}` : '' })
const realFetch = globalThis.fetch
beforeEach(() => {
  blockers = []
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/skills/review.md/raw') && (init?.method ?? 'GET') === 'GET') return Response.json({ name: 'review.md', path: '/x/review.md', content: 'just a body\n', problems: [] })
    return Response.json({ error: `unexpected ${url}` }, { status: 500 })
  }) as unknown as typeof fetch
})
afterEach(async () => { await settleReact(); cleanup(); globalThis.fetch = realFetch })

function track(promise: Promise<boolean>): { value: boolean | 'pending' } {
  const box: { value: boolean | 'pending' } = { value: 'pending' }
  void promise.then((value) => { box.value = value })
  return box
}

describe('sameRecoverLocation', () => {
  it('same page and same recover/skill/step = staying; a different recover target or page = leaving', () => {
    expect(sameRecoverLocation(at('/workflows', { recover: '1', skill: 'a.md' }), at('/workflows', { recover: '1', skill: 'a.md', page: '3' }))).toBe(true)
    expect(sameRecoverLocation(at('/workflows', { recover: '1', skill: 'a.md' }), at('/workflows', {}))).toBe(false)
    expect(sameRecoverLocation(at('/workflows', { recover: '1', skill: 'a.md' }), at('/workflows', { recover: '1', skill: 'b.md' }))).toBe(false)
    expect(sameRecoverLocation(at('/workflows/x', { recover: '1' }), at('/workflows/x', { recover: '1', step: 'draft' }))).toBe(false)
    expect(sameRecoverLocation(at('/workflows/x', { recover: '1' }), at('/tasks', {}))).toBe(false)
  })
})

describe('WorkflowRecoverEditor under the real guard', () => {
  it('a dirty draft blocks Back to /workflows (the recover target vanishes) behind the Unsaved repair decision; another query key passes; clean passes', async () => {
    await act(async () => { render(<WorkflowRecoverEditor target={{ kind: 'skill', file: 'review.md' }} onExit={() => {}} />) })
    const textarea = await screen.findByTestId('workflow-recover-editor-text') as HTMLTextAreaElement
    await waitFor(() => expect(textarea.value).toBe('just a body\n'))
    expect(blockers).toHaveLength(0) // clean: nothing to block

    await act(async () => { fireEvent.change(textarea, { target: { value: '---\nname: review\n---\nbody\n' } }) })
    await waitFor(() => expect(blockers).toHaveLength(1))
    let page = track(Promise.resolve(true))
    await act(async () => { page = track(blockers[0]!({ currentLocation: at('/workflows', { recover: '1', skill: 'review.md' }), nextLocation: at('/workflows', { recover: '1', skill: 'review.md', page: '2' }) })) })
    await settleReact()
    expect(page.value).toBe(false)

    let back = track(Promise.resolve(false))
    await act(async () => { back = track(blockers[0]!({ currentLocation: at('/workflows', { recover: '1', skill: 'review.md' }), nextLocation: at('/workflows', {}) })) })
    await settleReact()
    expect(back.value).toBe('pending')
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved repair' })
    expect(dialog).toBeTruthy()
    // Keep editing: the navigation stays blocked and the draft survives.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
    await settleReact()
    expect(back.value).toBe(true)
    expect((screen.getByTestId('workflow-recover-editor-text') as HTMLTextAreaElement).value).toBe('---\nname: review\n---\nbody\n')
  })
})
