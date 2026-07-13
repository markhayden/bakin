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
    since: window === '24h' ? '2026-07-12' : window === '7d' ? '2026-07-06' : '2026-06-13',
    throughDay: '2026-07-13',
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
  it('puts actionable agent concerns before a plain-language activity summary', async () => {
    const { urls } = stubAgentFetch()
    render(<AgentsTab />)

    const reviewHeading = await screen.findByRole('heading', { level: 3, name: 'Agents to review' })
    const activityHeading = screen.getByRole('heading', { level: 3, name: 'Agent activity' })
    expect(reviewHeading.compareDocumentPosition(activityHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Usage over time' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Latest-session details' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Reported cost' })).toBeDefined()
    expect(queryKeys).toContain('agents_window')
    expect(urls).toContain('/api/plugins/health/usage-history?window=24h')
    expect(urls).toContain('/api/plugins/health/agent-effort?window=24h')
    expect(urls).not.toContain('/api/plugins/models/spend?window=24h')

    const comparison = screen.getByTestId('agents-comparison')
    expect(within(comparison).getAllByText('Usage').length).toBeGreaterThan(0)
    expect(within(comparison).getAllByText('Work & results').length).toBeGreaterThan(0)
    expect(within(comparison).getAllByText('Status').length).toBeGreaterThan(0)
    expect(within(comparison).queryByText('Transcript observed')).toBeNull()
    expect(within(comparison).queryByText('Bakin attributed')).toBeNull()
    expect(within(comparison).queryByText('Unattributed')).toBeNull()

    const scoutRow = within(comparison).getByRole('link', { name: 'scout' }).closest('[data-agent-comparison-row]')
    expect(scoutRow?.textContent).toContain('300 total')
    expect(scoutRow?.textContent).toContain('200 tracked · 100 outside')
    expect(scoutRow?.textContent).toContain('0 of 2 runs completed')
    expect(scoutRow?.textContent).toContain('Needs review')

    const attention = screen.getByTestId('agents-attention')
    const warningFlag = within(attention).getByText('2 tracked runs produced no recorded completions.')
    expect(warningFlag).toBeDefined()
    expect(warningFlag.closest('ul')?.classList.contains('text-warning')).toBe(true)
    expect(within(attention).getByRole('link', { name: "Review scout's recent sessions" }).getAttribute('href')).toBe('/team/scout?tab=diagnostics')
    expect(comparison.querySelector('table')).toBeNull()
    expect(comparison.querySelector('[data-agent-comparison-row]')?.getAttribute('data-compact-layout')).toBe('stacked')

    expect(screen.getByText(/Most recent session reported by each agent.*independent of the selected period/i)).toBeDefined()
    const latestSessions = screen.getByTestId('latest-session-usage')
    const sessionDetails = latestSessions.querySelector('details')
    const sessionSummary = sessionDetails?.querySelector('summary')
    expect(sessionDetails?.open).toBe(false)
    expect(sessionSummary?.textContent).toContain('pixel')
    expect(sessionSummary?.textContent).toContain('gpt-5.4 · 8 messages')
    expect(sessionSummary?.textContent).toContain('1.2k tokens')
    expect(sessionDetails?.querySelector('[data-session-token-breakdown]')?.textContent).toContain('Cache read400')
    fireEvent.click(sessionSummary!)
    expect(sessionDetails?.open).toBe(true)

    const takeaway = screen.getByText(/The last completed day, 07-12, had 300 tokens.*Today is still being counted/i)
    const trendPlot = document.querySelector('[data-agent-token-trend-plot]')
    expect(takeaway.compareDocumentPosition(trendPlot!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const exactTrend = document.querySelector('table[aria-label="Usage over time data"]')
    expect(exactTrend).not.toBeNull()
    expect(exactTrend?.textContent).toContain('07-12')
    expect(exactTrend?.textContent).toContain('pixel')

    const costSummary = screen.getByTestId('reported-cost-summary')
    expect(costSummary.textContent).toContain('$0.03')
    expect(costSummary.textContent).toContain('2 of 6 messages from 2026-07-12 through 2026-07-13 reported cost')
    expect(costSummary.textContent).toContain('Today is still being counted')
    expect(screen.queryByText('Bakin-attributed estimate')).toBeNull()
    expect(screen.queryByText('fixed 24h scope · used by budget caps')).toBeNull()
    expect(screen.getByRole('link', { name: 'View budgets in Models' }).getAttribute('href')).toBe('/models?tab=spend')
  })

  it('keeps usage over time compact on wide screens without hiding exact values', async () => {
    stubAgentFetch()
    render(<AgentsTab />)

    const chart = await screen.findByRole('group', { name: 'Usage over time' })
    const plot = chart.closest('[data-agent-token-trend-plot]')

    expect(plot).not.toBeNull()
    expect(plot?.className).toContain('w-full')
    expect(plot?.className).toContain('max-w-4xl')
    expect(chart.getAttribute('viewBox')).toBe('0 0 640 144')
    expect(screen.getByRole('table', { name: 'Usage over time data', hidden: true })).toBeDefined()
  })

  it('keeps every independently loading section named in the accessibility tree', () => {
    globalThis.fetch = mock(() => new Promise<Response>(() => {})) as unknown as typeof fetch

    render(<AgentsTab />)

    expect(screen.getByRole('heading', { level: 2, name: 'Agents' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Agents to review' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Usage over time' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Agent activity' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Latest-session details' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Reported cost' })).toBeDefined()
    expect(screen.getByRole('status', { name: 'Loading agents to review' })).toBeDefined()
    expect(screen.getByRole('status', { name: 'Loading usage over time' })).toBeDefined()
    expect(screen.getByRole('status', { name: 'Loading agent comparison' })).toBeDefined()
    expect(screen.getByRole('status', { name: 'Loading latest-session details' })).toBeDefined()
    expect(screen.getByRole('status', { name: 'Loading reported cost' })).toBeDefined()
  })

  it('uses one URL-backed window for history and agent outcomes', async () => {
    const { urls } = stubAgentFetch()
    render(<AgentsTab />)
    await screen.findByText('Agent activity')

    fireEvent.click(screen.getByRole('tab', { name: '8 calendar days' }))

    await waitFor(() => {
      expect(urls).toContain('/api/plugins/health/usage-history?window=7d')
      expect(urls).toContain('/api/plugins/health/agent-effort?window=7d')
    })
    expect(screen.getByText(/2 of 6 messages from 2026-07-06 through 2026-07-13 reported cost.*Today is still being counted/)).toBeDefined()
    expect(screen.queryByText('fixed 24h scope · used by budget caps')).toBeNull()
  })

  it('does not present zero-message cost coverage when usage history fails', async () => {
    const { fetchMock } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      if (String(input).startsWith('/api/plugins/health/usage-history')) {
        return Promise.resolve(jsonResponse({ error: 'Unavailable' }, 503))
      }
      return fetchMock(input)
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    const costSummary = await screen.findByTestId('reported-cost-summary')
    expect(costSummary.textContent).toContain('Cost could not be checked because usage history could not be loaded (503).')
    expect(costSummary.textContent).not.toContain('0 of 0 messages')
  })
})
