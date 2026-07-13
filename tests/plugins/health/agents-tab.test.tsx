// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import '../../rtl-settle'

const queryKeys: string[] = []

mock.module('@makinbakin/sdk/hooks', () => ({
  useQueryState: (key: string, initial: string) => {
    queryKeys.push(key)
    return useState(initial)
  },
}))

import { AgentsTab } from '../../../plugins/health/components/agents-tab'

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function history(window: '24h' | '7d' | '30d') {
  return {
    window,
    since: '2026-07-12',
    scannedAt: '2026-07-13T12:00:00.000Z',
    byAgent: [
      {
        agent: 'pixel',
        tokens: { input: 700, output: 200, cacheRead: 100, cacheWrite: 0, total: 1_000 },
        costUsdMicros: 25_000,
        costedMessages: 2,
        messageCount: 4,
      },
      {
        agent: 'scout',
        tokens: { input: 200, output: 100, cacheRead: 0, cacheWrite: 0, total: 300 },
        costUsdMicros: null,
        costedMessages: 0,
        messageCount: 2,
      },
    ],
    byDay: [
      {
        day: '2026-07-12',
        tokens: { input: 250, output: 50, cacheRead: 0, cacheWrite: 0, total: 300 },
        costUsdMicros: 5_000,
        costedMessages: 1,
        messageCount: 2,
      },
      {
        day: '2026-07-13',
        tokens: { input: 650, output: 250, cacheRead: 100, cacheWrite: 0, total: 1_000 },
        costUsdMicros: 20_000,
        costedMessages: 1,
        messageCount: 4,
      },
    ],
    byAgentDay: [
      {
        agent: 'pixel',
        day: '2026-07-12',
        tokens: { input: 200, output: 50, cacheRead: 0, cacheWrite: 0, total: 250 },
        costUsdMicros: 5_000,
        costedMessages: 1,
        messageCount: 1,
      },
      {
        agent: 'scout',
        day: '2026-07-12',
        tokens: { input: 50, output: 0, cacheRead: 0, cacheWrite: 0, total: 50 },
        costUsdMicros: null,
        costedMessages: 0,
        messageCount: 1,
      },
      {
        agent: 'pixel',
        day: '2026-07-13',
        tokens: { input: 500, output: 150, cacheRead: 100, cacheWrite: 0, total: 750 },
        costUsdMicros: 20_000,
        costedMessages: 1,
        messageCount: 3,
      },
      {
        agent: 'scout',
        day: '2026-07-13',
        tokens: { input: 150, output: 100, cacheRead: 0, cacheWrite: 0, total: 250 },
        costUsdMicros: null,
        costedMessages: 0,
        messageCount: 1,
      },
    ],
  }
}

function effort(window: '24h' | '7d' | '30d') {
  return {
    window,
    scannedAt: '2026-07-13T12:00:00.000Z',
    agents: [
      {
        agent: 'pixel',
        windowTokens: 900,
        windowCostUsdMicros: 14_000,
        runs: 3,
        completions: 2,
        tokensPerCompletion: 450,
        totalObservedTokens: 1_000,
        unattributedTokens: 100,
        flags: [{ kind: 'spike', message: 'Token use is much higher than pixel\'s recent baseline.' }],
      },
      {
        agent: 'scout',
        windowTokens: 200,
        windowCostUsdMicros: null,
        runs: 2,
        completions: 0,
        tokensPerCompletion: null,
        totalObservedTokens: 300,
        unattributedTokens: 100,
        flags: [{ kind: 'effort-no-outcome', message: 'No completion was recorded for scout.' }],
      },
    ],
  }
}

function stubAgentFetch() {
  const urls: string[] = []
  const fetchMock = mock((input: string | URL | Request) => {
    const url = String(input)
    urls.push(url)
    if (url.startsWith('/api/plugins/health/usage-history')) {
      const window = new URL(url, 'http://localhost').searchParams.get('window') as '24h' | '7d' | '30d'
      return Promise.resolve(jsonResponse(history(window)))
    }
    if (url.startsWith('/api/plugins/health/agent-effort')) {
      const window = new URL(url, 'http://localhost').searchParams.get('window') as '24h' | '7d' | '30d'
      return Promise.resolve(jsonResponse(effort(window)))
    }
    if (url === '/api/plugins/health/usage') {
      return Promise.resolve(jsonResponse([
        {
          agent: 'pixel',
          sessionId: 'session-pixel',
          sessionStarted: '2026-07-13T11:00:00.000Z',
          model: 'gpt-5.4',
          messages: 8,
          tokens: { input: 600, output: 200, cacheRead: 400, cacheWrite: 0, total: 1_200 },
          cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null, source: 'unavailable' },
        },
      ]))
    }
    if (url === '/api/plugins/models/spend?window=24h') {
      return Promise.resolve(jsonResponse({
        totalUsdMicros: 120_000,
        byAgent: [{ agent: 'pixel', costUsdMicros: 120_000, runs: 3 }],
      }))
    }
    return Promise.resolve(jsonResponse({ error: `Unexpected request: ${url}` }, 404))
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return { fetchMock, urls }
}

afterEach(() => {
  cleanup()
  queryKeys.length = 0
  globalThis.fetch = originalFetch
})

describe('AgentsTab', () => {
  it('consolidates trend, efficiency, latest transcript traffic, and scoped spend', async () => {
    const { urls } = stubAgentFetch()
    render(<AgentsTab />)

    expect(await screen.findByRole('heading', { level: 3, name: 'Usage & efficiency' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Agent token trend' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Latest session token usage' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Spend & budget' })).toBeDefined()
    expect(queryKeys).toContain('agents_window')
    expect(urls).toContain('/api/plugins/health/usage-history?window=24h')
    expect(urls).toContain('/api/plugins/health/agent-effort?window=24h')

    const comparison = screen.getByTestId('agents-comparison')
    expect(within(comparison).getAllByText('Transcript observed').length).toBeGreaterThan(0)
    expect(within(comparison).getAllByText('Bakin attributed').length).toBeGreaterThan(0)
    expect(within(comparison).getAllByText('Unattributed').length).toBeGreaterThan(0)
    expect(within(comparison).getAllByText('Completions').length).toBeGreaterThan(0)
    expect(within(comparison).getAllByText('Outcome').length).toBeGreaterThan(0)
    expect(within(comparison).getAllByText('Flags').length).toBeGreaterThan(0)
    expect(within(comparison).getByText(/No completion was recorded for scout/)).toBeDefined()
    expect(comparison.querySelector('table')).toBeNull()
    expect(comparison.querySelector('[data-agent-comparison-row]')?.getAttribute('data-compact-layout')).toBe('stacked')

    expect(screen.getAllByText('Latest session token usage')).toHaveLength(1)
    expect(screen.getByText(/cumulative token traffic.*not context-window occupancy/i)).toBeDefined()
    expect(within(screen.getByTestId('latest-session-usage')).getAllByText('1.2k').length).toBeGreaterThan(0)

    expect(screen.getByText(/Transcript token traffic peaked on 07-13 at 1.0k/i)).toBeDefined()
    const exactTrend = document.querySelector('table[aria-label="Agent token trend data"]')
    expect(exactTrend).not.toBeNull()
    expect(exactTrend?.textContent).toContain('07-12')
    expect(exactTrend?.textContent).toContain('pixel')

    expect(screen.getByText('Runtime-reported transcript cost')).toBeDefined()
    expect(screen.getByText('selected 24h · 2 of 6 messages reported cost')).toBeDefined()
    expect(screen.getByText('Bakin-attributed estimate')).toBeDefined()
    expect(screen.getByText('fixed 24h scope · used by budget caps')).toBeDefined()
    expect(screen.getByRole('link', { name: /Open Models.*Spend/i }).getAttribute('href')).toBe('/models?tab=spend')
  })

  it('keeps every independently loading section named in the accessibility tree', () => {
    globalThis.fetch = mock(() => new Promise<Response>(() => {})) as unknown as typeof fetch

    render(<AgentsTab />)

    expect(screen.getByRole('heading', { level: 2, name: 'Agents' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Agent token trend' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Usage & efficiency' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Latest session token usage' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Spend & budget' })).toBeDefined()
    expect(screen.getByRole('status', { name: 'Loading agent token trend' })).toBeDefined()
    expect(screen.getByRole('status', { name: 'Loading agent comparison' })).toBeDefined()
    expect(screen.getByRole('status', { name: 'Loading latest session usage' })).toBeDefined()
  })

  it('uses one URL-backed window for history and agent outcomes', async () => {
    const { urls } = stubAgentFetch()
    render(<AgentsTab />)
    await screen.findByText('Usage & efficiency')

    fireEvent.click(screen.getByRole('tab', { name: '7d' }))

    await waitFor(() => {
      expect(urls).toContain('/api/plugins/health/usage-history?window=7d')
      expect(urls).toContain('/api/plugins/health/agent-effort?window=7d')
    })
    expect(screen.getByText('selected 7d · 2 of 6 messages reported cost')).toBeDefined()
    expect(screen.getByText('fixed 24h scope · used by budget caps')).toBeDefined()
  })
})
