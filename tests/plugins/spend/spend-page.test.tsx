// @vitest-environment jsdom
/**
 * /spend page smoke: the page composes its own data hook against the
 * spend/policy/incident/billing routes (served by the models plugin until
 * the ownership cutover), renders Overview tiles from `/spend`, the
 * Limits tab from the policy, and open incidents as banners on both.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import '../../rtl-settle'

const querySeed: Record<string, string> = {}

mock.module('@tanstack/react-router', () => ({
  useNavigate: () => () => undefined,
}))
mock.module('@makinbakin/sdk/navigation', () => ({
  useQueryState: (key: string, initial?: string) => {
    const [value, setValue] = useState<string | null>(querySeed[key] ?? initial ?? null)
    return [value, setValue, setValue]
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

const routes: Record<string, unknown> = {
  'spend?window=24h': {
    window: '24h', estimated: true, totalUsdMicros: 4_250_000,
    byAgent: [{ agent: 'main', costUsdMicros: 4_250_000, runs: 3 }], byModel: [], timeline: [],
    facets: { computedAt: 1, daily: window, monthly: window },
  },
  budget: { rules: [{ scope: 'global', lane: 'metered', dailyCap: 20, atCap: 'defer' }] },
  'budget/incidents': {
    incidents: [{
      id: 7, scope: 'global', scopeId: '', lane: 'metered', window: 'daily', windowStartMs: 0, kind: 'cap',
      unit: 'usd_micros', capValue: 20_000_000, spentValue: 21_000_000, atCap: 'defer', openedAt: 1, status: 'open',
    }],
  },
  'budget/status': { paused: false, configured: true, perAgent: {}, perTask: {}, billing: { main: { provider: 'openai-codex', lane: 'subscription', model: 'openai-codex/gpt-5.6-luna' } }, overrides: [], deferredProviders: [], openIncidents: [] },
  available: { models: [{ id: 'openai-codex/gpt-5.6-luna', provider: 'openai-codex' }] },
}

beforeEach(() => {
  requested.length = 0
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const path = url.replace('/api/plugins/models/', '')
    requested.push(url)
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
    // Every read went to the source plugin's routes — no hand-built URLs.
    expect(requested.every((url) => url.startsWith('/api/plugins/models/'))).toBe(true)
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

  it('renders the honest unavailable state when /spend fails, with Limits still reachable', async () => {
    delete routes['spend?window=24h']
    try {
      render(<SpendPage />)
      await waitFor(() => expect(screen.getByText('Spend data is unavailable')).toBeTruthy())
      expect(screen.getByRole('tab', { name: 'Limits' })).toBeTruthy()
    } finally {
      routes['spend?window=24h'] = {
        window: '24h', estimated: true, totalUsdMicros: 4_250_000, byAgent: [], byModel: [], timeline: [],
        facets: { computedAt: 1, daily: window, monthly: window },
      }
    }
  })
})
