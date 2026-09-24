// @vitest-environment jsdom
/**
 * Spend ladder attention (spec §6): 50/75 = toast + OS notification (once
 * per eventId, however many times an at-least-once delivery repeats it),
 * 90 = a bar (no toast), the badge counts bars needing attention with the
 * error tone once a cap is hit. Rules are pure in attention.ts; the
 * provider wires them to the SSE bus and the lite status.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-spend-badge-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

const useNavBadge = mock()
const toast = mock(() => 'toast-1')
const emitted: Array<Record<string, unknown>> = []
const handlers = new Map<string, (payload: Record<string, unknown>) => void>()
/** A faithful fake of the SDK toast store: add/dismiss/subscribe, persistent toasts never time out. */
interface FakeToast { id: string; type: string; title?: unknown; message: unknown; action?: unknown; persistent?: boolean }
const storeState = { toasts: [] as FakeToast[] }
const listeners = new Set<(state: typeof storeState) => void>()
let toastSeq = 0
const notify = () => { for (const l of [...listeners]) l(storeState) }
const fakeStore = {
  getState: () => ({
    toasts: storeState.toasts,
    add: (t: Omit<FakeToast, 'id'>) => { const id = `t${++toastSeq}`; storeState.toasts = [...storeState.toasts, { ...t, id }]; notify(); return id },
    dismiss: (id: string) => { storeState.toasts = storeState.toasts.filter((t) => t.id !== id); notify() },
  }),
  subscribe: (l: (state: typeof storeState) => void) => { listeners.add(l); return () => listeners.delete(l) },
}
/** The operator pressed the toast's own close control: the store drops it, nobody untracked it. */
const userCloses = (id: string) => fakeStore.getState().dismiss(id)
mock.module('@makinbakin/sdk/hooks', () => ({
  useNavBadge,
  toast,
  emitPluginEvent: (payload: Record<string, unknown>) => { emitted.push(payload) },
  useToastStore: fakeStore,
  useRouter: () => ({ push: mock() }),
  usePluginEvent: (event: string, handler: (payload: Record<string, unknown>) => void) => { handlers.set(event, handler) },
}))
mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ to, children }: { to: string; children: unknown }) => {
    const React = require('react') as typeof import('react')
    return React.createElement('a', { href: to }, children as never)
  },
}))
const notifications: Array<[string, string, string | undefined]> = []
mock.module('../../../plugins/spend/lib/browser-notify', () => ({
  sendBrowserNotification: (title: string, body: string, url?: string) => { notifications.push([title, body, url]) },
}))

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { SpendBadgeProvider } from '../../../plugins/spend/components/spend-badge-provider'
import { headsUpRows, milestoneNotifies, spendBadge, warningBars } from '../../../plugins/spend/components/attention'

let statusBody: Record<string, unknown> = { paused: false, milestones: [], openIncidents: [] }
const posts: Array<{ url: string; body: unknown }> = []
let postReply: { status: number; body: unknown } = { status: 200, body: { ok: true } }
const originalFetch = globalThis.fetch

beforeEach(() => {
  useNavBadge.mockClear()
  toast.mockClear()
  notifications.length = 0
  emitted.length = 0
  posts.length = 0
  postReply = { status: 200, body: { ok: true } }
  handlers.clear()
  listeners.clear()
  storeState.toasts = []
  statusBody = { paused: false, milestones: [], openIncidents: [] }
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') {
      posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify(postReply.body), { status: postReply.status, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify(statusBody), { headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
})
afterEach(() => { globalThis.fetch = originalFetch })

const ROW_90 = { id: 5, ruleId: 'r', window: 'monthly' as const, milestone: 90, spentValue: 91, capValue: 100, unit: 'usd_micros' as const, acknowledgedAt: null }
const CAP = { id: 7, eventId: 'e', episode: 1, scope: 'global', scopeId: '', lane: 'metered' as const, window: 'monthly' as const, unit: 'usd_micros' as const, capValue: 100, spentValue: 101, atCap: 'defer' as const, status: 'open' as const }

describe('attention rules', () => {
  it('50 and 75 notify; 90 and 100 are bars', () => {
    expect(milestoneNotifies(50)).toBe(true)
    expect(milestoneNotifies(75)).toBe(true)
    expect(milestoneNotifies(90)).toBe(false)
    expect(milestoneNotifies(100)).toBe(false)
  })

  it('badge: warnings are attention, any open cap makes it error; acknowledged 90 rows and non-open incidents are quiet', () => {
    expect(spendBadge([], [])).toBeNull()
    expect(spendBadge([ROW_90], [])).toEqual({ count: 1, tone: 'attention' })
    expect(spendBadge([ROW_90], [CAP])).toEqual({ count: 2, tone: 'error' })
    expect(spendBadge([{ ...ROW_90, acknowledgedAt: 1 }], [{ ...CAP, status: 'acknowledged' }])).toBeNull()
    expect(warningBars([ROW_90, { ...ROW_90, id: 6, milestone: 75 }])).toHaveLength(1)
  })
})

describe('attention rules — 50/75 heads-ups', () => {
  it('an unacknowledged 50/75 row badges (info tone) until the Spend page is opened; it never becomes a bar', () => {
    const row75 = { ...ROW_90, id: 8, milestone: 75 }
    expect(headsUpRows([row75, ROW_90])).toEqual([row75])
    expect(spendBadge([row75], [])).toEqual({ count: 1, tone: 'info' })
    expect(spendBadge([row75, ROW_90], [])).toEqual({ count: 2, tone: 'attention' })
    expect(spendBadge([{ ...row75, acknowledgedAt: 1 }], [])).toBeNull()
    expect(warningBars([row75])).toHaveLength(0)
  })
})

describe('SpendBadgeProvider', () => {
  it('renders nothing and derives the badge from the lite status rows', async () => {
    statusBody = { paused: false, milestones: [ROW_90], openIncidents: [CAP] }
    let container: HTMLElement | null = null
    await act(async () => { container = render(<SpendBadgeProvider />).container })
    expect(container!.firstChild).toBeNull()
    await act(async () => { await Promise.resolve() })
    expect(useNavBadge).toHaveBeenLastCalledWith('spend', 'spend', { count: 2, tone: 'error' })
  })

  it('toasts + OS-notifies a 50/75 event ONCE per eventId, never for 90, and refreshes the badge', async () => {
    await act(async () => { render(<SpendBadgeProvider />) })
    const event = { eventId: 'evt-1', milestoneId: 1, ruleId: 'r', scope: 'global', lane: 'metered', window: 'monthly', unit: 'usd_micros', highest: 75, count: 2, spentValue: 76_000_000, capValue: 100_000_000 }
    await act(async () => { handlers.get('spend.milestone')!(event) })
    await act(async () => { handlers.get('spend.milestone')!(event) }) // at-least-once redelivery
    expect(toast).toHaveBeenCalledTimes(1)
    expect(notifications).toEqual([['75% of your monthly limit', 'Global · $76.00 of $100.00 metered.', '/spend']])
    await act(async () => { handlers.get('spend.milestone')!({ ...event, eventId: 'evt-2', highest: 90 }) })
    expect(toast).toHaveBeenCalledTimes(1)
    expect(notifications).toHaveLength(1)
  })
})

describe('SpendBadgeProvider — ladder toasts (decision 2026-09-23: toasts the operator has to close, no header bars)', () => {
  const settle = async () => { await act(async () => { await Promise.resolve() }) }

  it('keeps one persistent toast per unacknowledged 90% row and per open cap incident, derived from the lite status', async () => {
    statusBody = { paused: false, milestones: [ROW_90], openIncidents: [CAP] }
    await act(async () => { render(<SpendBadgeProvider />) })
    await settle()
    expect(storeState.toasts.map((t) => [t.type, t.title, t.persistent])).toEqual([
      ['info', '90% of your monthly limit', true],
      ['error', 'monthly limit reached', true],
    ])
    expect(String(storeState.toasts[1]!.message)).toContain('Global · $0.00 of $0.00 metered — matching work waits for the next period. Close to acknowledge.')
    // A re-read with the same rows adds nothing.
    await act(async () => { handlers.get('budget.incident_opened')!({}) })
    await settle()
    expect(storeState.toasts).toHaveLength(2)
  })

  it('closing a toast IS the acknowledgement: the 90% row is acked and the event fans out; the cap incident is acked quietly', async () => {
    statusBody = { paused: false, milestones: [ROW_90], openIncidents: [CAP] }
    await act(async () => { render(<SpendBadgeProvider />) })
    await settle()
    const [warn, cap] = storeState.toasts
    await act(async () => { userCloses(warn!.id) })
    await waitFor(() => expect(posts).toEqual([{ url: '/api/plugins/spend/milestones/5/ack', body: undefined }]))
    expect(emitted).toEqual([{ event: 'spend.milestone_acknowledged', milestoneId: 5 }])
    await act(async () => { userCloses(cap!.id) })
    await waitFor(() => expect(posts.at(-1)).toEqual({ url: '/api/plugins/spend/incidents/7/resolve', body: { action: 'ack' } }))
  })

  it('a row handled elsewhere (acked on another tab, resolved, rolled over) takes its toast away WITHOUT acknowledging again', async () => {
    statusBody = { paused: false, milestones: [ROW_90], openIncidents: [CAP] }
    await act(async () => { render(<SpendBadgeProvider />) })
    await settle()
    expect(storeState.toasts).toHaveLength(2)
    statusBody = { paused: false, milestones: [], openIncidents: [] }
    await act(async () => { handlers.get('budget.incident_resolved')!({}) })
    await settle()
    expect(storeState.toasts).toHaveLength(0)
    expect(posts).toHaveLength(0)
  })

  it('a failed acknowledgement (already rolled over) says so and the toast is not silently gone for good — the next read re-derives it', async () => {
    statusBody = { paused: false, milestones: [ROW_90], openIncidents: [] }
    await act(async () => { render(<SpendBadgeProvider />) })
    await settle()
    postReply = { status: 404, body: { error: 'No unacknowledged milestone 5' } }
    await act(async () => { userCloses(storeState.toasts[0]!.id) })
    await waitFor(() => expect(toast).toHaveBeenCalledWith('No unacknowledged milestone 5', 'error'))
    // The re-read after the failure still lists the row: the toast comes back.
    await settle()
    await waitFor(() => expect(storeState.toasts).toHaveLength(1))
  })

  it("a pause cap's toast offers Resume as-is; a 409 turns the link into \"Raise limit to resume\" with the server's reason", async () => {
    statusBody = { paused: false, milestones: [], openIncidents: [{ ...CAP, atCap: 'pause' }] }
    await act(async () => { render(<SpendBadgeProvider />) })
    await settle()
    expect(String(storeState.toasts[0]!.message)).toContain('paused until you act')
    render(storeState.toasts[0]!.action as never)
    expect(screen.getByRole('link', { name: 'Raise limit' }).getAttribute('href')).toBe('/spend?tab=limits')
    postReply = { status: 409, body: { error: 'still_over_limit', message: 'Spend is still at or over this limit — raise the limit to resume.' } }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resume as-is' })) })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Raise limit to resume' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Resume as-is' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('raise the limit to resume')
  })
})

it('retains known alerts on failed reconnect reads, then clears on authoritative recovery', async () => {
  statusBody = { milestones: [ROW_90], openIncidents: [] }
  await act(async () => { render(<SpendBadgeProvider />) })
  expect(useNavBadge).toHaveBeenLastCalledWith('spend', 'spend', { count: 1, tone: 'attention' })
  const goodFetch = globalThis.fetch
  globalThis.fetch = mock(async () => { throw new Error('offline') }) as unknown as typeof fetch
  await act(async () => { handlers.get('bakin.reconcile')?.({}) })
  expect(useNavBadge).toHaveBeenLastCalledWith('spend', 'spend', { count: 1, tone: 'attention' })
  globalThis.fetch = goodFetch
  statusBody = { milestones: [], openIncidents: [] }
  await act(async () => { handlers.get('bakin.reconcile')?.({}) })
  expect(useNavBadge).toHaveBeenLastCalledWith('spend', 'spend', null)
  expect(notifications).toHaveLength(0)
})
