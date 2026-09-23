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
const handlers = new Map<string, (payload: Record<string, unknown>) => void>()
mock.module('@makinbakin/sdk/hooks', () => ({
  useNavBadge,
  toast,
  useToastStore: { getState: () => ({ dismiss: mock() }) },
  useRouter: () => ({ push: mock() }),
  usePluginEvent: (event: string, handler: (payload: Record<string, unknown>) => void) => { handlers.set(event, handler) },
}))
const notifications: Array<[string, string, string | undefined]> = []
mock.module('../../../plugins/spend/lib/browser-notify', () => ({
  sendBrowserNotification: (title: string, body: string, url?: string) => { notifications.push([title, body, url]) },
}))

import { act, render } from '@testing-library/react'
import '../../rtl-settle'
import { SpendBadgeProvider } from '../../../plugins/spend/components/spend-badge-provider'
import { headsUpRows, milestoneNotifies, spendBadge, warningBars } from '../../../plugins/spend/components/attention'

let statusBody: Record<string, unknown> = { paused: false, milestones: [], openIncidents: [] }
const originalFetch = globalThis.fetch

beforeEach(() => {
  useNavBadge.mockClear()
  toast.mockClear()
  notifications.length = 0
  handlers.clear()
  statusBody = { paused: false, milestones: [], openIncidents: [] }
  globalThis.fetch = mock(async () => new Response(JSON.stringify(statusBody), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
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
