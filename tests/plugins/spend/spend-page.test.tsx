// @vitest-environment jsdom
/**
 * /spend page smoke: the page composes its own data hook against the spend
 * plugin's routes (scope suggestions still read the models catalog),
 * renders Overview tiles from `/spend`, the Limits tab from the policy,
 * and open incidents as banners on both.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import '../../rtl-settle'

const querySeed: Record<string, string> = {}

mock.module('@tanstack/react-router', () => ({
  useNavigate: () => () => undefined,
}))
/** The dirty-exit guard is kit-owned (needs a router); the page test pins what it is TOLD. */
const guardCalls: Array<{ hasUnsavedChanges: boolean; saving: boolean }> = []
mock.module('@makinbakin/sdk/navigation', () => ({
  useQueryState: (key: string, initial?: string) => {
    const [value, setValue] = useState<string | null>(querySeed[key] ?? initial ?? null)
    return [value, setValue, setValue]
  },
  useUnsavedChangesGuard: (options: { hasUnsavedChanges: boolean; saving: boolean }) => {
    guardCalls.push({ hasUnsavedChanges: options.hasUnsavedChanges, saving: options.saving })
    return { requestExit: () => {}, reset: () => {}, dialog: null }
  },
}))
mock.module('@makinbakin/sdk/hooks', () => ({
  useAgentList: () => [{ id: 'main', name: 'Main', emoji: '🤖', role: '', headshot: '' }],
  usePluginEvent: () => {},
  emitPluginEvent: () => {},
}))

import { SpendPage } from '../../../plugins/spend/components/spend-page'

const originalFetch = globalThis.fetch
const requested: string[] = []

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const lane = { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 0, unpricedMeteredTokens: 0 }
const scope = { ...lane, unattributed: { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 0 } }
const window = { startMs: 0, global: { ...scope, meteredUsdMicros: 12_500_000, meteredTokens: 1_000 }, byAgent: {}, byProvider: {}, byModel: {} }

const spendFixture = {
  window: '24h', estimated: true, totalUsdMicros: 4_250_000,
  byAgent: [{ agent: 'main', costUsdMicros: 4_250_000, runs: 3 }, { agent: 'pixel', costUsdMicros: 1_000_000, runs: 5 }],
  byModel: [{ model: 'anthropic/claude-sonnet-4-6', costUsdMicros: 1_780_000, runs: 9 }],
  byWorkClass: [{ workClass: 'workflow', runs: 8, totalTokens: 48_000, costUsdMicros: 1_480_000, subscriptionTokens: 0, avgCostUsdMicros: 185_000 }],
  timeline: [
    { startMs: Date.now() - 8 * 60 * 60 * 1000, endMs: Date.now() - 4 * 60 * 60 * 1000, costUsdMicros: 980_000, subscriptionTokens: 8_000, unpricedMeteredTokens: 0 },
    { startMs: Date.now() - 4 * 60 * 60 * 1000, endMs: Date.now(), costUsdMicros: 1_500_000, subscriptionTokens: 16_000, unpricedMeteredTokens: 0 },
  ],
  facets: { computedAt: 1, daily: window, monthly: window },
  pace: {
    daily: { meteredUsdMicros: 3_100_000, subscriptionTokens: 30_000, endsMs: Date.now() + 43_200_000 },
    monthly: { meteredUsdMicros: 12_000_000, subscriptionTokens: 180_000, endsMs: Date.now() + 604_800_000 },
  },
  observedDays: { month: 9, daysIntoMonth: 22 },
}

const routes: Record<string, unknown> = {
  'spend?window=24h': spendFixture,
  limits: { rules: [{ id: 'g', scope: 'global', lane: 'metered', dailyCap: 20, atCap: 'defer' }], revision: 'rev-1' },
  incidents: {
    incidents: [{
      id: 7, scope: 'global', scopeId: '', lane: 'metered', window: 'daily', windowStartMs: 0, kind: 'cap',
      unit: 'usd_micros', capValue: 20_000_000, spentValue: 21_000_000, atCap: 'defer', openedAt: 1, status: 'open',
    }],
  },
  status: { paused: false, configured: true, perAgent: {}, perTask: {}, billing: { main: { provider: 'openai-codex', lane: 'subscription', model: 'openai-codex/gpt-5.6-luna' } }, overrides: [], deferredProviders: [], openIncidents: [] },
  'models:available': { models: [{ id: 'openai-codex/gpt-5.6-luna', provider: 'openai-codex' }] },
  coverage: {
    lookbackDays: 30, computedAt: 1, coveredDays: Array.from({ length: 14 }, (_, i) => `2026-09-${String(8 + i).padStart(2, '0')}`), uncoveredDays: [],
    covered: { window: { ...window, global: { ...scope, meteredUsdMicros: 140_000_000 } } },
    uncovered: { window: { ...window, global: { ...scope, meteredUsdMicros: 5_000_000 } } },
    suggestion: { status: 'ready', monthlyUsd: 450, basis: { coveredDays: 14, coveredUsdMicros: 140_000_000, dailyRateUsdMicros: 10_000_000 }, unobservedUsdMicros: 5_000_000 },
  },
}
const putBodies: Array<Record<string, unknown>> = []
const resolvePosts: Array<{ path: string; body: Record<string, unknown> }> = []
let putReply: Response | null = null
const globalIncident = {
  id: 7, scope: 'global', scopeId: '', lane: 'metered', window: 'daily', windowStartMs: 0, kind: 'cap',
  unit: 'usd_micros', capValue: 20_000_000, spentValue: 21_000_000, atCap: 'defer', openedAt: 1, status: 'open',
}

beforeEach(() => {
  requested.length = 0
  putBodies.length = 0
  resolvePosts.length = 0
  putReply = null
  routes.limits = { rules: [{ id: 'g', scope: 'global', lane: 'metered', dailyCap: 20, atCap: 'defer' }], revision: 'rev-1' }
  routes.incidents = { incidents: [globalIncident] }
  routes['spend?window=24h'] = spendFixture
  routes.status = {
    paused: false, configured: true, perAgent: {}, perTask: {},
    billing: { main: { provider: 'openai-codex', lane: 'subscription', model: 'openai-codex/gpt-5.6-luna' } },
    overrides: [], deferredProviders: [], openIncidents: [],
    // This period's ladder for rule g's daily window: 50 seen, 75 not yet.
    milestones: [
      { id: 1, ruleId: 'g', window: 'daily', milestone: 50, spentValue: 10_000_000, capValue: 20_000_000, unit: 'usd_micros', acknowledgedAt: 1 },
      { id: 2, ruleId: 'g', window: 'daily', milestone: 75, spentValue: 15_000_000, capValue: 20_000_000, unit: 'usd_micros', acknowledgedAt: null },
    ],
  }
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const path = url.startsWith('/api/plugins/models/') ? `models:${url.slice('/api/plugins/models/'.length)}` : url.replace('/api/plugins/spend/', '')
    requested.push(url)
    if (init?.method === 'PUT' && path === 'limits') {
      putBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return putReply ?? jsonResponse({ ok: true, revision: 'rev-2' })
    }
    if (init?.method === 'POST' && /^incidents\/\d+\/resolve$/.test(path)) {
      resolvePosts.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> })
      // The incident is gone on the next read.
      routes.incidents = { incidents: [] }
      return jsonResponse({ ok: true })
    }
    const body = routes[path]
    return body === undefined ? jsonResponse({ error: 'not found' }, 404) : jsonResponse(body)
  }) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  for (const key of Object.keys(querySeed)) delete querySeed[key]
})

describe('SpendPage', () => {
  it('renders the Overview from /spend with the open incident banner above the tabs', async () => {
    render(<SpendPage />)
    await waitFor(() => expect(screen.getAllByText('$4.25').length).toBeGreaterThan(0))
    expect(screen.getByRole('heading', { name: 'Spend' })).toBeTruthy()
    expect(screen.getByText('Budget cap reached')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeTruthy()
    // Every read went to this plugin's routes, except the catalog scopes (models).
    expect(requested.filter((url) => !url.startsWith('/api/plugins/spend/'))).toEqual(['/api/plugins/models/available'])
  })

  it('an incident names the OTHER limits at their cap, and resolving it says what still holds matching work (#911 review)', async () => {
    // A second rule — agent "main", $5/day — is over on current spend but has no incident of its own yet.
    routes.limits = { rules: [
      { id: 'g', scope: 'global', lane: 'metered', dailyCap: 20, atCap: 'defer' },
      { id: 'a', scope: 'agent', scopeId: 'main', lane: 'metered', dailyCap: 5, atCap: 'defer' },
    ], revision: 'rev-1' }
    routes['spend?window=24h'] = { ...spendFixture, facets: { computedAt: 1, daily: { ...window, byAgent: { main: { ...scope, meteredUsdMicros: 6_000_000 } } }, monthly: window } }
    render(<SpendPage />)
    const other = await screen.findByTestId('incident-7-other-holds')
    expect(other.textContent).toContain('Agent main · metered · daily ($6.00 of $5.00)')
    expect(other.textContent).toContain('does not release the work they hold')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' })) })
    expect(resolvePosts).toEqual([{ path: 'incidents/7/resolve', body: { action: 'ack' } }])
    const notice = await screen.findByTestId('incident-resolved-notice')
    expect(notice.textContent).toContain('Acknowledged — matching work is still held')
    expect(notice.textContent).toContain('Agent main · metered · daily ($6.00 of $5.00)')
    // The resolved incident is gone; the verdict stays until dismissed.
    await waitFor(() => expect(screen.queryByText('Budget cap reached')).toBeNull())
    await act(async () => { fireEvent.click(within(notice).getByRole('button', { name: 'Dismiss' })) })
    expect(screen.queryByTestId('incident-resolved-notice')).toBeNull()
  })

  it('resolving the only limit at its cap says matching work runs again; with the kill switch on it says dispatch is paused', async () => {
    render(<SpendPage />)
    await screen.findByText('Budget cap reached')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' })) })
    expect((await screen.findByTestId('incident-resolved-notice')).textContent).toContain('matching work runs again')
    cleanup()

    routes.incidents = { incidents: [globalIncident] }
    routes.status = { ...(routes.status as Record<string, unknown>), paused: true }
    render(<SpendPage />)
    await screen.findByText('Budget cap reached')
    expect((await screen.findByText(/All dispatch is paused, too/)).textContent).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' })) })
    expect((await screen.findByTestId('incident-resolved-notice')).textContent).toContain('kill switch is on')
  })

  it('switches to Limits and shows the policy rule editor with the roster + billing lanes', async () => {
    render(<SpendPage />)
    await waitFor(() => expect(screen.getAllByText('$4.25').length).toBeGreaterThan(0))
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Limits' })) })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Limits', selected: true })).toBeTruthy())
    expect(screen.getByLabelText('Scope')).toBeTruthy()
    expect(screen.getByText('Budget cap reached')).toBeTruthy()
    expect(screen.getAllByText('Main').length).toBeGreaterThan(0)
  })

  it('Limits: every saved rule shows its utilization with the next reset, and "This period\'s milestones" discloses what the ladder recorded (#911 review)', async () => {
    render(<SpendPage />)
    await waitFor(() => expect(screen.getAllByText('$4.25').length).toBeGreaterThan(0))
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Limits' })) })
    const period = within(await screen.findByTestId('current-period'))
    // $12.50 of the $20 daily cap on current spend, and the window's end from the pace line (~12 h out).
    const tiles = period.getByRole('group', { name: 'Budget utilization' })
    expect(tiles.textContent).toContain('Global · metered · daily')
    expect(tiles.textContent).toContain('63%')
    expect(tiles.textContent).toContain('$12.50 of $20.00 · resets in 12 h')
    // The disclosure lists this period's rows: 50 seen, 75 new, and the open cap incident as 100.
    const disclosure = period.getByTestId('period-milestones')
    expect(disclosure.textContent).toContain('3 crossed')
    await act(async () => { fireEvent.click(within(disclosure).getByText("This period's milestones")) })
    expect(within(disclosure).getByText('50%')).toBeTruthy()
    expect(within(disclosure).getByText('75% · new')).toBeTruthy()
    expect(within(disclosure).getByText('100% · waiting')).toBeTruthy()
  })

  it('renders the honest unavailable state when /spend fails, with Limits still reachable', async () => {
    delete routes['spend?window=24h']
    try {
      render(<SpendPage />)
      await waitFor(() => expect(screen.getByText('Spend data is unavailable')).toBeTruthy())
      expect(screen.getByRole('tab', { name: 'Limits' })).toBeTruthy()
    } finally {
      routes['spend?window=24h'] = spendFixture
    }
  })

  it('composes Overview and Limits from shared summary, selection, pagination, and form patterns', async () => {
    const { container } = render(<SpendPage />)
    expect(await screen.findByRole('region', { name: 'Spending overview' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Spend breakdown' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Estimated spend over time' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Top agent spend' })).toBeTruthy()
    expect(container.querySelectorAll('select')).toHaveLength(0)
    // The window selector lives in the page header's controls slot.
    const windowControl = screen.getByRole('tablist', { name: 'Spend window' })
    expect(windowControl.closest('[data-slot="page-header-controls"]')).toBeTruthy()
    // The ranked chart's exact-data table adds one occurrence beyond the breakdown rows.
    expect(screen.getAllByText('pixel')).toHaveLength(3)

    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Models' })) })
    expect(await screen.findAllByText('anthropic/claude-sonnet-4-6')).toHaveLength(3)
    expect(screen.getByRole('group', { name: 'Top model spend' })).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Limits' })) })
    expect(await screen.findByRole('region', { name: 'Budget rules' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Billing lanes' })).toBeTruthy()
    expect(screen.queryByRole('tablist', { name: 'Spend window' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add a rule' })) })
    expect(await screen.findByText('Unsaved budget rules')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Discard changes' })) })
    expect(screen.queryByText('Unsaved budget rules')).toBeNull()
  })

  it('Add a limit: the dialog prefills the coverage suggestion, "Pause" maps to atCap pause, and saves through PUT /limits under the loaded revision — onto the existing global metered rule (one rule per identity)', async () => {
    querySeed.tab = 'limits'
    render(<SpendPage />)
    await waitFor(() => expect(screen.getByRole('region', { name: 'Budget rules' })).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Add a limit' })[0]!) })
    const dialog = await screen.findByRole('dialog', { name: 'Add a spending limit' })
    await waitFor(() => expect(within(dialog).getByText('$140.00')).toBeTruthy())
    // Basis copy: observed days + rate; unobserved spend shown separately, not in the rate.
    expect(within(dialog).getByText(/14 of 30 days watched/)).toBeTruthy()
    expect(within(dialog).getByText('$5.00')).toBeTruthy()
    const monthly = within(dialog).getByLabelText('Monthly limit (USD)') as HTMLInputElement
    await waitFor(() => expect(monthly.value).toBe('450'))
    expect(within(dialog).getByText(/Suggested \$450/)).toBeTruthy()
    expect(within(dialog).getByText(/notified at 50%, 75%, 90%/)).toBeTruthy()

    await act(async () => { fireEvent.click(within(dialog).getByRole('radio', { name: 'Pause matching work until I raise or resume' })) })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save limit' })) })
    await waitFor(() => expect(putBodies).toHaveLength(1))
    expect(putBodies[0]).toEqual({
      revision: 'rev-1',
      rules: [
        { id: 'g', scope: 'global', lane: 'metered', dailyCap: 20, monthlyCap: 450, atCap: 'pause' },
      ],
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a spending limit' })).toBeNull())
  })

  it('a failed /limits load renders the unavailable state — never "No spending limits" — and nothing can be added or saved against unknown rules', async () => {
    delete routes.limits
    querySeed.tab = 'limits'
    render(<SpendPage />)
    await waitFor(() => expect(screen.getByText('Spend limits could not be loaded')).toBeTruthy())
    expect(screen.queryByText('No spending limits')).toBeNull()
    for (const button of screen.getAllByRole('button', { name: 'Add a limit' })) expect((button as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Add a rule' }) as HTMLButtonElement).disabled).toBe(true)
    expect(putBodies).toHaveLength(0)
  })

  it('a save under a revision that moved is refused by the server and explained — the limits reload, nothing is re-posted', async () => {
    putReply = jsonResponse({ error: 'stale_revision', message: 'the spend limits changed since this edit was loaded — reload and try again', current: 'rev-9' }, 409)
    querySeed.tab = 'limits'
    render(<SpendPage />)
    await waitFor(() => expect(screen.getByRole('region', { name: 'Budget rules' })).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Add a limit' })[0]!) })
    const dialog = await screen.findByRole('dialog', { name: 'Add a spending limit' })
    const monthly = within(dialog).getByLabelText('Monthly limit (USD)') as HTMLInputElement
    await waitFor(() => expect(monthly.value).toBe('450'))
    const limitsLoads = () => requested.filter((u) => u === '/api/plugins/spend/limits').length
    const before = limitsLoads()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save limit' })) })
    expect(await within(dialog).findByText(/changed since this page loaded/)).toBeTruthy()
    await waitFor(() => expect(limitsLoads()).toBeGreaterThan(before))
    expect(putBodies).toHaveLength(1)
  })

  it('Add a limit: a number typed while the suggestion is still loading is kept — the prefill only fills an empty field', async () => {
    let releaseCoverage!: () => void
    const gate = new Promise<void>((resolve) => { releaseCoverage = resolve })
    const inner = globalThis.fetch
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/plugins/spend/coverage') await gate
      return inner(input, init)
    }) as unknown as typeof fetch
    querySeed.tab = 'limits'
    render(<SpendPage />)
    await waitFor(() => expect(screen.getByRole('region', { name: 'Budget rules' })).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Add a limit' })[0]!) })
    const dialog = await screen.findByRole('dialog', { name: 'Add a spending limit' })
    const monthly = within(dialog).getByLabelText('Monthly limit (USD)') as HTMLInputElement
    await act(async () => { fireEvent.change(monthly, { target: { value: '200' } }) })
    await act(async () => { releaseCoverage() })
    await waitFor(() => expect(within(dialog).getByText(/Suggested \$450/)).toBeTruthy())
    expect(monthly.value).toBe('200')
  })

  it('staged rule edits arm the dirty-exit guard (leaving asks: save, discard or stay); a discard disarms it', async () => {
    querySeed.tab = 'limits'
    guardCalls.length = 0
    render(<SpendPage />)
    await waitFor(() => expect(screen.getByRole('region', { name: 'Budget rules' })).toBeTruthy())
    expect(guardCalls.at(-1)?.hasUnsavedChanges).toBe(false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add a rule' })) })
    await waitFor(() => expect(guardCalls.at(-1)?.hasUnsavedChanges).toBe(true))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Discard changes' })) })
    await waitFor(() => expect(guardCalls.at(-1)?.hasUnsavedChanges).toBe(false))
  })

  it('Add a limit: an invalid amount is rejected inside the dialog, nothing is sent', async () => {
    querySeed.tab = 'limits'
    render(<SpendPage />)
    await waitFor(() => expect(screen.getByRole('region', { name: 'Budget rules' })).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Add a limit' })[0]!) })
    const dialog = await screen.findByRole('dialog', { name: 'Add a spending limit' })
    const monthly = within(dialog).getByLabelText('Monthly limit (USD)')
    await waitFor(() => expect((monthly as HTMLInputElement).value).toBe('450'))
    await act(async () => { fireEvent.change(monthly, { target: { value: 'lots' } }) })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save limit' })) })
    expect(await within(dialog).findByText('Enter a monthly limit in dollars.')).toBeTruthy()
    expect(putBodies).toHaveLength(0)
  })

  it('Overview: the pace line states its observed-days basis; empty lanes read as "not metered" / "none", never "$ unavailable"', async () => {
    routes['spend?window=24h'] = {
      ...spendFixture,
      facets: { computedAt: 1, daily: window, monthly: { ...window, global: { ...scope, subscriptionTokens: 0 } } },
      pace: { daily: { meteredUsdMicros: null, subscriptionTokens: null, endsMs: 1 }, monthly: { meteredUsdMicros: 30_000_000, subscriptionTokens: 0, endsMs: 1 } },
      observedDays: { month: 9, daysIntoMonth: 22 },
    }
    try {
      render(<SpendPage />)
      await waitFor(() => expect(screen.getByTestId('spend-pace').textContent).toBe('On pace for ~$30.00 metered this month — based on 9 observed days of 22.'))
      expect(screen.getByText('Not metered')).toBeTruthy()
      expect(screen.getByText('None')).toBeTruthy()
      expect(screen.queryByText('$ unavailable')).toBeNull()
    } finally {
      routes['spend?window=24h'] = spendFixture
    }
  })

  it('Overview: too little of the month ⇒ the pace line says so instead of projecting', async () => {
    routes['spend?window=24h'] = { ...spendFixture, pace: { daily: { meteredUsdMicros: null, subscriptionTokens: null, endsMs: 1 }, monthly: { meteredUsdMicros: null, subscriptionTokens: null, endsMs: 1 } } }
    try {
      render(<SpendPage />)
      await waitFor(() => expect(screen.getByTestId('spend-pace').textContent).toBe('Not enough of the month has passed to project a pace.'))
    } finally {
      routes['spend?window=24h'] = spendFixture
    }
  })
})
