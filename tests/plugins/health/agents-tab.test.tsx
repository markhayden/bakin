// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import '../../rtl-settle'

const queryKeys: string[] = []

mock.module('@tanstack/react-router', () => ({
  useNavigate: () => () => undefined,
}))

mock.module('@makinbakin/sdk/hooks', () => ({
  useQueryState: (key: string, initial: string) => {
    queryKeys.push(key)
    return useState(initial)
  },
}))

import { AgentsTab } from '../../../plugins/health/components/agents-tab'
import { AgentPulse } from '../../../plugins/health/components/agent-pulse'
import type { AgentEffortData, UsageHistoryData } from '../../../plugins/health/types'

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
        originTokens: { bakin: 250, external: 0, unknown: 0 },
        costUsdMicros: 5_000,
        costedMessages: 1,
        messageCount: 1,
      },
      {
        agent: 'scout',
        day: '2026-07-12',
        tokens: { input: 50, output: 0, cacheRead: 0, cacheWrite: 0, total: 50 },
        originTokens: { bakin: 50, external: 0, unknown: 0 },
        costUsdMicros: null,
        costedMessages: 0,
        messageCount: 1,
      },
      {
        agent: 'pixel',
        day: '2026-07-13',
        tokens: { input: 500, output: 150, cacheRead: 100, cacheWrite: 0, total: 750 },
        originTokens: { bakin: 750, external: 0, unknown: 0 },
        costUsdMicros: 20_000,
        costedMessages: 1,
        messageCount: 3,
      },
      {
        agent: 'scout',
        day: '2026-07-13',
        tokens: { input: 150, output: 100, cacheRead: 0, cacheWrite: 0, total: 250 },
        originTokens: { bakin: 250, external: 0, unknown: 0 },
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
    since: '2026-07-12',
    throughDay: '2026-07-13',
    scopeLabel: '2026-07-12 through 2026-07-13',
    scannedAt: null,
    coverage: {
      status: 'partial',
      reason: 'agent_scan_failed',
      agents: [
        { agent: 'main', status: 'complete' },
        { agent: 'enrich', status: 'partial' },
        { agent: 'pixel', status: 'complete' },
        { agent: 'scout', status: 'complete' },
      ],
    },
    agents: [
      {
        agent: 'main',
        windowTokens: 120,
        windowCostUsdMicros: 8_000,
        runs: 1,
        tokenApplicableRuns: 1,
        tokenMeteredRuns: 1,
        tokenAggregateRepresentable: true,
        costedRuns: 1,
        costAggregateRepresentable: true,
        completions: 1,
        tokensPerCompletion: 120,
        totalObservedTokens: 120,
        interactiveTokens: 0,
        unexplainedTokens: 0,
        flags: [],
      },
      {
        agent: 'enrich',
        windowTokens: 0,
        windowCostUsdMicros: null,
        runs: 0,
        tokenApplicableRuns: 0,
        tokenMeteredRuns: 0,
        tokenAggregateRepresentable: true,
        costedRuns: 0,
        costAggregateRepresentable: true,
        completions: 0,
        tokensPerCompletion: null,
        totalObservedTokens: null,
        interactiveTokens: null,
        unexplainedTokens: null,
        flags: [],
      },
      {
        agent: 'pixel',
        windowTokens: 900,
        windowCostUsdMicros: 25_000,
        runs: 3,
        tokenApplicableRuns: 3,
        tokenMeteredRuns: 3,
        tokenAggregateRepresentable: true,
        costedRuns: 3,
        costAggregateRepresentable: true,
        completions: 2,
        tokensPerCompletion: 450,
        totalObservedTokens: 1_000,
        interactiveTokens: 0,
        unexplainedTokens: 100,
        flags: [{ kind: 'spike', message: 'Token use is much higher than pixel\'s recent baseline.' }],
      },
      {
        agent: 'scout',
        windowTokens: 200,
        windowCostUsdMicros: null,
        runs: 2,
        tokenApplicableRuns: 2,
        tokenMeteredRuns: 2,
        tokenAggregateRepresentable: true,
        costedRuns: 0,
        costAggregateRepresentable: true,
        completions: 0,
        tokensPerCompletion: null,
        totalObservedTokens: 300,
        interactiveTokens: 0,
        unexplainedTokens: 100,
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
    if (url === '/api/plugins/health/usage-snapshot' || url === '/api/plugins/health/usage') {
      const sessions = [{
        agent: 'pixel',
        sessionId: 'session-pixel',
        sessionStarted: '2026-07-13T11:00:00.000Z',
        lastMessageAt: '2026-07-13T11:05:00.000Z',
        model: 'gpt-5.4',
        messages: 8,
        tokens: { input: 600, output: 200, cacheRead: 400, cacheWrite: 0, total: 1_200 },
        cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null, source: 'unavailable' },
      }]
      return Promise.resolve(jsonResponse(url.endsWith('usage-snapshot') ? {
        generatedAt: '2026-07-13T12:00:00.000Z',
        source: { status: 'complete', reason: 'complete', failedAgents: [] },
        sessions,
      } : sessions))
    }
    if (url === '/api/plugins/health/live-now') {
      return Promise.resolve(jsonResponse({
        generatedAt: '2026-07-13T12:00:00.000Z',
        runs: [{
          agent: 'main',
          taskId: 'task-refresh-search',
          taskTitle: 'Refresh search index',
          runId: 'run-main',
          startedAt: Date.parse('2026-07-13T11:58:00.000Z'),
          runningForMs: 120_000,
          heartbeatAgeMs: 2_000,
        }],
      }))
    }
    if (url === '/api/context-report') {
      return Promise.resolve(jsonResponse({
        ok: true,
        tokenEstimateNote: 'Approximate bytes per dispatch.',
        agents: [{
          agentId: 'main',
          staticTaskBytes: 8_192,
          staticWorkflowBytes: 4_096,
          estimatedMaxTaskBytes: 32_768,
          workspaceAvailable: true,
          workspaceTotalBytes: 20_480,
          lastObserved: null,
        }],
      }))
    }
    if (url === '/api/settings') {
      return Promise.resolve(jsonResponse({ dispatch: { contextBudgetBytes: 65_536 } }))
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

function agentSurface(): HTMLElement {
  const pulseHeading = screen.queryByRole('heading', { level: 3, name: 'Agent pulse' })
  const pulseCard = pulseHeading?.closest<HTMLElement>('[data-section-card]')
  if (!pulseCard) throw new Error('Could not find the Agent pulse surface')
  return pulseCard
}

function agentRow(surface: HTMLElement, agent: string): HTMLElement {
  const row = within(surface)
    .getAllByText(agent, { exact: true })
    .map((label) => label.closest<HTMLElement>('[data-agent-pulse-row], [data-agent-comparison-row], article, li'))
    .find((candidate): candidate is HTMLElement => candidate !== null)
  if (!row) throw new Error(`Could not find the ${agent} row`)
  return row
}

afterEach(() => {
  cleanup()
  queryKeys.length = 0
  globalThis.fetch = originalFetch
})

describe('AgentsTab', () => {
  it('keeps supporting trend and cost evidence together beneath the agent pulse', async () => {
    const { urls } = stubAgentFetch()
    render(<AgentsTab />)

    await screen.findByRole('heading', { level: 3, name: 'Agent pulse' })
    const usageCostHeading = screen.getByRole('heading', { level: 3, name: 'Usage & cost' })
    const usageCost = usageCostHeading.closest<HTMLElement>('[data-section-card]')
    expect(usageCost).not.toBeNull()
    expect(screen.queryByRole('heading', { level: 3, name: 'Reported cost' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 3, name: 'Latest-session details' })).toBeNull()
    expect(queryKeys).toContain('agents_window')
    expect(urls).toContain('/api/plugins/health/usage-history?window=24h')
    expect(urls).toContain('/api/plugins/health/agent-effort?window=24h')
    expect(urls).not.toContain('/api/plugins/models/spend?window=24h')

    const takeaway = within(usageCost!).getByText(/The last completed day, 07-12, had 300 tokens.*Today is still being counted/i)
    const trendPlot = usageCost!.querySelector('[data-agent-token-trend-plot]')
    expect(takeaway.compareDocumentPosition(trendPlot!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const exactTrend = within(usageCost!).getByRole('table', { name: 'Usage over time data', hidden: true })
    expect(exactTrend.textContent).toContain('07-12')
    expect(exactTrend.textContent).toContain('pixel')

    expect(usageCost!.textContent).toContain('$0.03')
    expect(usageCost!.textContent).toContain('2 of 6 messages from 2026-07-12 through 2026-07-13 reported cost')
    expect(usageCost!.textContent).toContain('Today is still being counted')
    expect(screen.queryByText('Bakin-attributed estimate')).toBeNull()
    expect(screen.queryByText('fixed 24h scope · used by budget caps')).toBeNull()
    expect(within(usageCost!).getByRole('link', { name: 'View budgets in Models' }).getAttribute('href')).toBe('/models?tab=spend')
  })

  it('totals only explicitly complete agents when transcript coverage is partial', async () => {
    const { fetchMock } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('/api/plugins/health/usage-history')) {
        const window = new URL(url, 'http://localhost').searchParams.get('window') as '24h' | '7d' | '30d'
        return Promise.resolve(jsonResponse({
          ...history(window),
          scannedAt: null,
          coverage: {
            status: 'partial',
            reason: 'agent_scan_failed',
            agents: [
              { agent: 'pixel', status: 'complete' },
              { agent: 'scout', status: 'partial' },
            ],
          },
        }))
      }
      return fetchMock(input)
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    const card = (await screen.findByRole('heading', { level: 3, name: 'Usage & cost' }))
      .closest<HTMLElement>('[data-section-card]')!
    expect(card.textContent).toContain('Transcript coverage is partial')
    expect(card.textContent).toContain('only 1 fully scanned agent')
    expect(card.textContent).toContain('1 unverified agent is excluded')
    expect(card.textContent).toContain('2 of 4 messages')
    const exact = within(card).getByRole('table', { name: 'Usage over time data', hidden: true })
    expect(exact.textContent).toContain('pixel')
    expect(exact.textContent).not.toContain('scout')
  })

  it('does not present durable rows as current totals before a scan has run', async () => {
    const { fetchMock } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('/api/plugins/health/usage-history')) {
        const window = new URL(url, 'http://localhost').searchParams.get('window') as '24h' | '7d' | '30d'
        return Promise.resolve(jsonResponse({
          ...history(window),
          scannedAt: null,
          coverage: { status: 'unavailable', reason: 'scan_not_run', agents: [] },
        }))
      }
      return fetchMock(input)
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    const card = (await screen.findByRole('heading', { level: 3, name: 'Usage & cost' }))
      .closest<HTMLElement>('[data-section-card]')!
    expect(card.textContent).toContain('Retained rows are excluded')
    expect(card.textContent).toContain('No fully verified usage total is available yet')
    expect(within(card).queryByRole('group', { name: 'Usage over time' })).toBeNull()
    expect(card.textContent).not.toContain('1.3k')
  })

  it('switches the combined Usage & cost visualization between tokens and honestly covered reported cost', async () => {
    stubAgentFetch()
    render(<AgentsTab />)

    const usageCostHeading = await screen.findByRole('heading', { level: 3, name: 'Usage & cost' })
    const usageCost = usageCostHeading.closest<HTMLElement>('[data-section-card]')
    expect(usageCost).not.toBeNull()

    const control = within(usageCost!).getByRole('tablist', { name: 'Usage metric' })
    const tokensTab = within(control).getByRole('tab', { name: 'Tokens' })
    const costTab = within(control).getByRole('tab', { name: 'Reported cost' })

    expect(control.hasAttribute('data-segmented-control')).toBe(true)
    expect(tokensTab.getAttribute('aria-selected')).toBe('true')
    expect(costTab.getAttribute('aria-selected')).toBe('false')
    fireEvent.click(costTab)
    await waitFor(() => expect(costTab.getAttribute('aria-selected')).toBe('true'))

    expect(within(usageCost!).getByRole('group', { name: /reported cost.*over time/i })).toBeDefined()
    expect(within(usageCost!).getByText(/View reported cost.*data/i)).toBeDefined()
    expect(within(usageCost!).getByRole('table', { name: /reported cost.*data/i, hidden: true })).toBeDefined()
    const exactCost = within(usageCost!).getByRole('table', { name: /reported cost.*data/i, hidden: true })
    expect(exactCost.textContent).toContain('scout')
    expect(exactCost.textContent).toContain('Unreported')
    expect(usageCost!.textContent).toMatch(/2 of 6 messages.*reported cost/i)
    expect(usageCost!.textContent).toMatch(/partial|coverage/i)
  })

  it('uses one dominant Agent pulse, keeps every agent visible, and sorts flagged rows first', async () => {
    stubAgentFetch()
    render(<AgentsTab />)

    const pulseHeading = await screen.findByRole('heading', { level: 3, name: 'Agent pulse' })
    expect(screen.queryByRole('heading', { level: 3, name: 'Agents to review' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 3, name: 'Agent activity' })).toBeNull()

    const pulse = pulseHeading.closest<HTMLElement>('[data-section-card]')
    expect(pulse).not.toBeNull()
    const surface = pulse!
    const pixel = agentRow(surface, 'pixel')
    const scout = agentRow(surface, 'scout')
    const main = agentRow(surface, 'main')
    const enrich = agentRow(surface, 'enrich')

    expect(pixel.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(scout.compareDocumentPosition(enrich) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(surface).getByRole('listitem', { name: 'pixel' })).toBe(pixel)
  })

  it('labels independently pending agent evidence as checking instead of unavailable', async () => {
    const { fetchMock } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      if (String(input).startsWith('/api/plugins/health/usage-history')) return fetchMock(input)
      return new Promise<Response>(() => {})
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    await waitFor(() => expect(agentRow(agentSurface(), 'pixel')).toBeDefined())
    const pixel = agentRow(agentSurface(), 'pixel')
    expect(agentSurface().textContent).toContain('Checking live activity')
    expect(agentSurface().textContent).toContain('Checking review flags')
    expect(agentSurface().textContent).not.toContain('0 working agents')
    expect(pixel.textContent).toContain('Checking review')
    expect(pixel.textContent).toContain('Checking live state')
    expect(pixel.textContent).toMatch(/Tracked work\s*Checking/i)
    expect(pixel.textContent).toMatch(/Startup context\s*Checking/i)
    expect(pixel.textContent).not.toContain('Work evidence unavailable')

    fireEvent.click(within(pixel).getByRole('button', { name: /pixel.*details/i }))
    expect(pixel.textContent).toContain('Checking latest session')
  })

  it('qualifies retained live evidence as last seen instead of claiming it is current', () => {
    render(
      <AgentPulse
        effort={null}
        history={history('24h') as UsageHistoryData}
        latestSessions={[]}
        liveNow={{
          generatedAt: '2026-07-13T12:00:00.000Z',
          runs: [{
            agent: 'main',
            taskId: 'task-main',
            taskTitle: null,
            runId: 'run-main',
            startedAt: Date.parse('2026-07-13T11:58:00.000Z'),
            runningForMs: 120_000,
            heartbeatAgeMs: 2_000,
          }],
        }}
        context={null}
        contextBudgetBytes={null}
        pending={{
          effort: false,
          history: false,
          latestSessions: false,
          liveNow: false,
          context: false,
          settings: false,
        }}
        unavailable={{
          effort: false,
          history: false,
          latestSessions: false,
          liveNow: false,
          context: false,
          settings: false,
        }}
        errors={[]}
        liveNowStale
        onRetry={() => {}}
      />,
    )

    const main = agentRow(agentSurface(), 'main')
    expect(main.textContent).toContain('Last seen working')
    expect(within(main).queryByText('Working', { exact: true })).toBeNull()
    expect(main.textContent).toContain('Active task title unavailable')
  })

  it('does not turn failed live or latest-session reads into claims of inactivity', async () => {
    const { fetchMock } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input)
      if (url === '/api/plugins/health/live-now' || url === '/api/plugins/health/usage-snapshot') {
        return Promise.resolve(jsonResponse({ error: 'Unavailable' }, 503))
      }
      return fetchMock(input)
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    await waitFor(() => expect(agentRow(agentSurface(), 'main')).toBeDefined())
    const surface = agentSurface()
    const main = agentRow(surface, 'main')
    expect(surface.textContent).toContain('Live activity unavailable')
    expect(surface.textContent).not.toContain('0 working agents')
    expect(main.textContent).toContain('Live state unavailable')
    expect(main.textContent).not.toContain('No active task reported')

    fireEvent.click(within(main).getByRole('button', { name: /main.*details/i }))
    expect(main.textContent).toContain('Latest-session detail is unavailable')
  })

  it('treats a successful unavailable-source envelope as unavailable evidence', async () => {
    const { fetchMock } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      if (String(input) === '/api/plugins/health/usage-snapshot') {
        return Promise.resolve(jsonResponse({
          generatedAt: '2026-07-13T12:00:00.000Z',
          source: { status: 'unavailable', reason: 'transcript_source_unavailable', failedAgents: [] },
          sessions: [],
        }))
      }
      return fetchMock(input)
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    await waitFor(() => expect(agentRow(agentSurface(), 'pixel')).toBeDefined())
    expect(agentSurface().textContent).toContain('The runtime transcript source is unavailable.')
    const pixel = agentRow(agentSurface(), 'pixel')
    fireEvent.click(within(pixel).getByRole('button', { name: /pixel.*details/i }))
    expect(pixel.textContent).toContain('Latest-session detail is unavailable')
    expect(pixel.textContent).not.toContain('No latest-session token breakdown')
  })

  it('keeps partial session data while identifying the agents whose reads failed', async () => {
    const { fetchMock } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      if (String(input) === '/api/plugins/health/usage-snapshot') {
        return Promise.resolve(jsonResponse({
          generatedAt: '2026-07-13T12:00:00.000Z',
          source: { status: 'partial', reason: 'session_read_failures', failedAgents: ['scout'] },
          sessions: [{
            agent: 'pixel', sessionId: 'session-pixel',
            sessionStarted: '2026-07-13T11:00:00.000Z', lastMessageAt: '2026-07-13T11:05:00.000Z',
            model: 'gpt-5.4', messages: 8,
            tokens: { input: 600, output: 200, cacheRead: 400, cacheWrite: 0, total: 1_200 },
            cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null, source: 'unavailable' },
          }],
        }))
      }
      return fetchMock(input)
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    await waitFor(() => expect(screen.getByText(/Latest-session evidence is partial for scout/)).toBeDefined())
    const scout = agentRow(agentSurface(), 'scout')
    fireEvent.click(within(scout).getByRole('button', { name: /scout.*details/i }))
    expect(scout.textContent).toContain('Latest-session detail is unavailable')

    const pixel = agentRow(agentSurface(), 'pixel')
    fireEvent.click(within(pixel).getByRole('button', { name: /pixel.*details/i }))
    expect(pixel.textContent).toContain('600')
    expect(pixel.textContent).not.toContain('Latest-session detail is unavailable')
  })

  it('falls back to the legacy session array during a rolling server upgrade', async () => {
    const { fetchMock, urls } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      if (String(input) === '/api/plugins/health/usage-snapshot') {
        return Promise.resolve(jsonResponse({ error: 'Not found' }, 404))
      }
      return fetchMock(input)
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    await waitFor(() => expect(agentRow(agentSurface(), 'pixel')).toBeDefined())
    expect(urls).toContain('/api/plugins/health/usage')
    expect(screen.getByText(/Latest-session coverage cannot be verified until Bakin is restarted/)).toBeDefined()
    const pixel = agentRow(agentSurface(), 'pixel')
    fireEvent.click(within(pixel).getByRole('button', { name: /pixel.*details/i }))
    expect(pixel.textContent).toContain('600')
  })

  it('does not turn a stale empty live snapshot into a current zero', () => {
    render(
      <AgentPulse
        effort={null}
        history={history('24h') as UsageHistoryData}
        latestSessions={[]}
        liveNow={{ generatedAt: '2026-07-13T12:00:00.000Z', runs: [] }}
        context={null}
        contextBudgetBytes={null}
        pending={{
          effort: false,
          history: false,
          latestSessions: false,
          liveNow: false,
          context: false,
          settings: false,
        }}
        unavailable={{
          effort: false,
          history: false,
          latestSessions: false,
          liveNow: false,
          context: false,
          settings: false,
        }}
        errors={[]}
        liveNowStale
        onRetry={() => {}}
      />,
    )

    const surface = agentSurface()
    expect(surface.textContent).toContain('Live activity stale')
    expect(surface.textContent).not.toContain('0 working agents')
    expect(agentRow(surface, 'pixel').textContent).toContain('Live state stale')
    expect(agentRow(surface, 'pixel').textContent).not.toContain('No active task reported')
  })

  it('states tracked runs, token totals, and task completions separately', async () => {
    stubAgentFetch()
    render(<AgentsTab />)

    await waitFor(() => expect(agentRow(agentSurface(), 'scout')).toBeDefined())
    const surface = agentSurface()
    const pixel = agentRow(surface, 'pixel')
    const scout = agentRow(surface, 'scout')

    expect(pixel.textContent).toContain('3 tracked runs')
    expect(pixel.textContent).toContain('900 tracked tokens')
    expect(pixel.textContent).toContain('2 task completions')
    expect(scout.textContent).toContain('2 tracked runs')
    expect(scout.textContent).toContain('200 tracked tokens')
    expect(scout.textContent).toContain('0 task completions')
    expect(surface.textContent).not.toMatch(/\d+ of \d+ runs completed/i)
  })

  it('labels partial token and cost evidence instead of rendering a plausible subtotal', () => {
    const effort: AgentEffortData = {
      window: '24h',
      scannedAt: '2026-07-13T12:00:00.000Z',
      coverage: {
        status: 'complete',
        reason: 'complete',
        agents: [{ agent: 'partial-metering', status: 'complete' }],
      },
      agents: [{
        agent: 'partial-metering',
        windowTokens: null,
        windowCostUsdMicros: null,
        runs: 3,
        tokenApplicableRuns: 2,
        tokenMeteredRuns: 1,
        tokenAggregateRepresentable: true,
        costedRuns: 1,
        costAggregateRepresentable: true,
        completions: 1,
        tokensPerCompletion: null,
        totalObservedTokens: 1_000,
        interactiveTokens: null,
        unexplainedTokens: null,
        flags: [],
      }],
    }

    render(
      <AgentPulse
        effort={effort}
        history={null}
        latestSessions={[]}
        liveNow={null}
        context={null}
        contextBudgetBytes={null}
        pending={{ effort: false, history: false, latestSessions: false, liveNow: false, context: false, settings: false }}
        unavailable={{ effort: false, history: false, latestSessions: false, liveNow: false, context: false, settings: false }}
        errors={[]}
        onRetry={() => {}}
      />,
    )

    const row = agentRow(agentSurface(), 'partial-metering')
    expect(row.textContent).toContain('Metering incomplete')
    expect(row.textContent).toContain('3 tracked runs')
    expect(row.textContent).toContain('Token totals unavailable · 1 of 2 token-bearing calls metered')
    expect(row.textContent).toContain('1 task completion · cost 1 of 3 runs priced')
    expect(row.textContent).not.toContain('0 tracked tokens')
  })

  it('withholds legacy effort subtotals when per-dimension coverage is unavailable', () => {
    const legacyEffort: AgentEffortData = {
      window: '24h',
      scannedAt: '2026-07-13T12:00:00.000Z',
      agents: [{
        agent: 'legacy',
        windowTokens: 8_000,
        windowCostUsdMicros: 25_000,
        runs: 2,
        completions: 1,
        tokensPerCompletion: 8_000,
        totalObservedTokens: 9_000,
        interactiveTokens: 0,
        unexplainedTokens: 1_000,
        flags: [],
      }],
    }

    render(
      <AgentPulse
        effort={legacyEffort}
        history={null}
        latestSessions={[]}
        liveNow={null}
        context={null}
        contextBudgetBytes={null}
        pending={{ effort: false, history: false, latestSessions: false, liveNow: false, context: false, settings: false }}
        unavailable={{ effort: false, history: false, latestSessions: false, liveNow: false, context: false, settings: false }}
        errors={[]}
        onRetry={() => {}}
      />,
    )

    const row = agentRow(agentSurface(), 'legacy')
    expect(row.textContent).toContain('Coverage unavailable')
    expect(row.textContent).toContain('Token totals unavailable · coverage unavailable')
    expect(row.textContent).toContain('Cost unavailable')
    expect(row.textContent).not.toContain('8k tracked tokens')
    expect(row.textContent).not.toContain('$0.03')
  })

  it('explains safely withheld aggregate totals without faking incomplete coverage counts', () => {
    const effort: AgentEffortData = {
      window: '24h',
      scannedAt: '2026-07-13T12:00:00.000Z',
      agents: [{
        agent: 'huge',
        windowTokens: null,
        windowCostUsdMicros: null,
        runs: 2,
        tokenApplicableRuns: 2,
        tokenMeteredRuns: 2,
        tokenAggregateRepresentable: false,
        costedRuns: 2,
        costAggregateRepresentable: false,
        completions: 1,
        tokensPerCompletion: null,
        totalObservedTokens: null,
        interactiveTokens: null,
        unexplainedTokens: null,
        flags: [],
      }],
    }

    render(
      <AgentPulse
        effort={effort}
        history={null}
        latestSessions={[]}
        liveNow={null}
        context={null}
        contextBudgetBytes={null}
        pending={{ effort: false, history: false, latestSessions: false, liveNow: false, context: false, settings: false }}
        unavailable={{ effort: false, history: false, latestSessions: false, liveNow: false, context: false, settings: false }}
        errors={[]}
        onRetry={() => {}}
      />,
    )

    const row = agentRow(agentSurface(), 'huge')
    expect(row.textContent).toContain('2 of 2 token-bearing calls reported totals · combined total too large to report')
    expect(row.textContent).toContain('2 of 2 runs priced · combined cost too large to report')
  })

  it('qualifies partial reported cost in latest-session details', () => {
    render(
      <AgentPulse
        effort={null}
        history={null}
        latestSessions={[{
          agent: 'partial-cost',
          sessionId: 'session-1',
          sessionStarted: '2026-07-13T12:00:00.000Z',
          lastMessageAt: '2026-07-13T12:02:00.000Z',
          model: 'gpt-test',
          messages: 2,
          costedMessages: 1,
          tokens: { input: 200, output: 100, cacheRead: 0, cacheWrite: 0, total: 300 },
          cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: 0.03, source: 'runtime' },
        }]}
        liveNow={null}
        context={null}
        contextBudgetBytes={null}
        pending={{ effort: false, history: false, latestSessions: false, liveNow: false, context: false, settings: false }}
        unavailable={{ effort: false, history: false, latestSessions: false, liveNow: false, context: false, settings: false }}
        errors={[]}
        onRetry={() => {}}
      />,
    )

    const row = agentRow(agentSurface(), 'partial-cost')
    fireEvent.click(within(row).getByRole('button', { name: /partial-cost.*details/i }))
    expect(row.textContent).toContain('$0.03+ reported cost')
    expect(row.textContent).toContain('1 of 2 messages')
  })

  it('distinguishes clear review coverage from unavailable coverage without saying No issues', async () => {
    stubAgentFetch()
    render(<AgentsTab />)

    await waitFor(() => expect(agentRow(agentSurface(), 'enrich')).toBeDefined())
    const surface = agentSurface()
    const main = agentRow(surface, 'main')
    const enrich = agentRow(surface, 'enrich')

    expect(main.textContent).toContain('No review flags')
    expect(enrich.textContent).toContain('Coverage unavailable')
    expect(surface.textContent).not.toContain('No issues')
  })

  it('shows who is working, their current task, and startup context as percent of budget', async () => {
    const { urls } = stubAgentFetch()
    render(<AgentsTab />)

    await waitFor(() => expect(agentRow(agentSurface(), 'main')).toBeDefined())
    const main = agentRow(agentSurface(), 'main')

    expect(main.textContent).toContain('Working')
    expect(main.textContent).toContain('Refresh search index')
    expect(main.textContent).toContain('Startup context')
    expect(main.textContent).toMatch(/50%.*budget/i)
    expect(main.textContent).not.toMatch(/context[- ]window/i)
    expect(within(main).getByRole('progressbar', { name: 'main startup context budget' }).getAttribute('aria-valuetext'))
      .toBe('50% of budget')
    expect(urls).toContain('/api/plugins/health/live-now')
    expect(urls).toContain('/api/context-report')
    expect(urls).toContain('/api/settings')
  })

  it('shows reported cost per agent without turning unavailable pricing into zero dollars', async () => {
    stubAgentFetch()
    render(<AgentsTab />)

    await waitFor(() => expect(agentRow(agentSurface(), 'pixel')).toBeDefined())
    const surface = agentSurface()
    const pixel = agentRow(surface, 'pixel')
    const scout = agentRow(surface, 'scout')

    expect(pixel.textContent).toMatch(/reported cost/i)
    expect(pixel.textContent).toContain('$0.03')
    expect(scout.textContent).toMatch(/cost unavailable|unpriced/i)
    expect(scout.textContent).not.toContain('$0.00')
    expect(agentRow(surface, 'main').textContent).toContain('$0.0080 tracked cost')
  })

  it('opens the latest-session token breakdown from an agent row and labels its diagnostics destination', async () => {
    stubAgentFetch()
    render(<AgentsTab />)

    await waitFor(() => expect(agentRow(agentSurface(), 'pixel')).toBeDefined())
    const pixel = agentRow(agentSurface(), 'pixel')
    const details = within(pixel).getByRole('button', { name: /pixel.*details|details.*pixel/i })
    const detailsId = details.getAttribute('aria-controls')

    fireEvent.click(details)
    expect(detailsId).not.toBeNull()
    expect(document.getElementById(detailsId!)).not.toBeNull()
    expect(pixel.textContent).toContain('gpt-5.4')
    expect(pixel.textContent).toContain('8 messages')
    expect(pixel.textContent).toContain('1.2k tokens')
    expect(pixel.textContent).toMatch(/Cache read\s*400/i)
    expect(within(pixel).getByRole('link', { name: /pixel.*diagnostics|diagnostics.*pixel/i }).getAttribute('href'))
      .toBe('/team/pixel?tab=diagnostics')
  })

  it('keeps usage over time compact and marks today as incomplete without hiding exact values', async () => {
    stubAgentFetch()
    render(<AgentsTab />)

    const chart = await screen.findByRole('group', { name: 'Usage over time' })
    const plot = chart.closest('[data-agent-token-trend-plot]')

    expect(plot).not.toBeNull()
    expect(plot?.className).toContain('w-full')
    // Plots fill the card — nothing renders beside them (width cap removed 2026-08-03).
    expect(plot?.className).toContain('w-full')
    expect(within(chart).getByRole('img', { name: /07-13 \(in progress\)/ })).toBeDefined()
    expect(screen.getByRole('table', { name: 'Usage over time data', hidden: true })).toBeDefined()
  })

  it('uses a single aggregate series when per-agent daily history is unavailable', async () => {
    const { fetchMock } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('/api/plugins/health/usage-history')) {
        const window = new URL(url, 'http://localhost').searchParams.get('window') as '24h' | '7d' | '30d'
        return Promise.resolve(jsonResponse({ ...history(window), byAgentDay: [] }))
      }
      return fetchMock(input)
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    const exactTrend = await screen.findByRole('table', { name: 'Usage over time data', hidden: true })
    expect(exactTrend.textContent).toContain('All agents')
    expect(exactTrend.textContent).not.toContain('pixel')
    expect(exactTrend.textContent).not.toContain('scout')
  })

  it('keeps every independently loading section named in the accessibility tree', () => {
    globalThis.fetch = mock(() => new Promise<Response>(() => {})) as unknown as typeof fetch

    render(<AgentsTab />)

    const identity = screen.getByRole('heading', { level: 2, name: 'Agents' })
    expect(identity.className).toContain('sr-only')
    const intro = screen.getByText(/Compare token use, cost, tracked work, and recorded outcomes across agents/i)
    expect(intro.getAttribute('data-size')).toBe('meta')
    expect(intro.className).toContain('leading-relaxed')
    expect(intro.className).toContain('text-bakin-text-muted')
    expect(screen.getByRole('heading', { level: 3, name: 'Agent pulse' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 3, name: 'Usage & cost' })).toBeDefined()
    expect(screen.queryByRole('heading', { level: 3, name: 'Reported cost' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 3, name: 'Latest-session details' })).toBeNull()
    expect(screen.getByRole('status', { name: 'Loading agent pulse' })).toBeDefined()
    expect(screen.getByRole('status', { name: 'Loading usage and cost' })).toBeDefined()
  })

  it('uses one URL-backed window for history and agent outcomes', async () => {
    const { urls } = stubAgentFetch()
    render(<AgentsTab />)
    await screen.findByText('Agent pulse')

    fireEvent.click(screen.getByRole('tab', { name: '7d' }))

    await waitFor(() => {
      expect(urls).toContain('/api/plugins/health/usage-history?window=7d')
      expect(urls).toContain('/api/plugins/health/agent-effort?window=7d')
    })
    expect(screen.getByText(/2 of 6 messages from 2026-07-06 through 2026-07-13 reported cost.*Today is still being counted/)).toBeDefined()
    expect(screen.queryByText('fixed 24h scope · used by budget caps')).toBeNull()
  })

  it('keeps combined cost coverage unavailable instead of presenting zero messages when history fails', async () => {
    const { fetchMock } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      if (String(input).startsWith('/api/plugins/health/usage-history')) {
        return Promise.resolve(jsonResponse({ error: 'Unavailable' }, 503))
      }
      return fetchMock(input)
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    const usageCostHeading = await screen.findByRole('heading', { level: 3, name: 'Usage & cost' })
    const usageCost = usageCostHeading.closest<HTMLElement>('[data-section-card]')
    expect(usageCost).not.toBeNull()
    expect(usageCost!.textContent).toContain('Cost could not be checked because usage history could not be loaded (503).')
    expect(usageCost!.textContent).not.toContain('0 of 0 messages')
    expect(agentSurface().textContent).toContain('Some agent evidence is unavailable: Usage history could not be loaded (503).')
  })

  it('shows complete zero-dollar reporting as a clear zero state instead of a blank or partial chart', async () => {
    const { fetchMock } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('/api/plugins/health/usage-history')) {
        const window = new URL(url, 'http://localhost').searchParams.get('window') as '24h' | '7d' | '30d'
        const data = history(window)
        return Promise.resolve(jsonResponse({
          ...data,
          byAgent: data.byAgent.map((row) => ({
            ...row,
            costUsdMicros: 0,
            costedMessages: row.messageCount,
          })),
          byDay: data.byDay.map((row) => ({
            ...row,
            costUsdMicros: 0,
            costedMessages: row.messageCount,
          })),
          byAgentDay: data.byAgentDay.map((row) => ({
            ...row,
            costUsdMicros: 0,
            costedMessages: row.messageCount,
          })),
        }))
      }
      return fetchMock(input)
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    const usageCostHeading = await screen.findByRole('heading', { level: 3, name: 'Usage & cost' })
    const usageCost = usageCostHeading.closest<HTMLElement>('[data-section-card]')!
    fireEvent.click(within(usageCost).getByRole('tab', { name: 'Reported cost' }))

    expect(within(usageCost).getByText('$0.00', { selector: '[data-reported-cost-zero] strong' })).toBeDefined()
    expect(usageCost.textContent).toContain('All 6 cost-reporting messages returned $0.00')
    expect(usageCost.textContent).not.toMatch(/coverage is partial/i)
    expect(within(usageCost).queryByRole('group', { name: 'Reported cost over time' })).toBeNull()
  })

  it('keeps a reported zero partial when other messages have no cost evidence', async () => {
    const { fetchMock } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('/api/plugins/health/usage-history')) {
        const window = new URL(url, 'http://localhost').searchParams.get('window') as '24h' | '7d' | '30d'
        const data = history(window)
        return Promise.resolve(jsonResponse({
          ...data,
          byAgent: data.byAgent.map((row) => row.agent === 'pixel'
            ? { ...row, costUsdMicros: 0 }
            : row),
          byDay: data.byDay.map((row) => ({ ...row, costUsdMicros: 0 })),
          byAgentDay: data.byAgentDay.map((row) => row.agent === 'pixel'
            ? { ...row, costUsdMicros: 0 }
            : row),
        }))
      }
      return fetchMock(input)
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    const usageCostHeading = await screen.findByRole('heading', { level: 3, name: 'Usage & cost' })
    const usageCost = usageCostHeading.closest<HTMLElement>('[data-section-card]')!
    fireEvent.click(within(usageCost).getByRole('tab', { name: 'Reported cost' }))

    expect(usageCost.textContent).toContain('Reported cost $0.00+')
    expect(usageCost.textContent).toMatch(/coverage is partial/i)
    expect(within(usageCost).queryByText('$0.00', { selector: '[data-reported-cost-zero] strong' })).toBeNull()
    expect(within(usageCost).getByRole('group', { name: 'Reported cost over time' })).toBeDefined()
    expect(within(usageCost).getByRole('table', { name: 'Reported cost over time data', hidden: true }).textContent)
      .toContain('Unreported')
  })

  it('labels an absent agent-day cost cell as no activity rather than missing pricing', async () => {
    const { fetchMock } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('/api/plugins/health/usage-history')) {
        const window = new URL(url, 'http://localhost').searchParams.get('window') as '24h' | '7d' | '30d'
        const data = history(window)
        return Promise.resolve(jsonResponse({
          ...data,
          byAgent: data.byAgent.map((row) => row.agent === 'pixel'
            ? { ...row, costUsdMicros: 22_500, costedMessages: row.messageCount }
            : { ...row, costUsdMicros: 2_500, costedMessages: row.messageCount }),
          byDay: data.byDay.map((row) => row.day === '2026-07-12'
            ? { ...row, costUsdMicros: 5_000, costedMessages: row.messageCount }
            : { ...row, costUsdMicros: 20_000, costedMessages: row.messageCount }),
          byAgentDay: data.byAgentDay
            .filter((row) => !(row.agent === 'scout' && row.day === '2026-07-13'))
            .map((row) => ({
              ...row,
              costUsdMicros: row.day === '2026-07-12' ? 2_500 : 20_000,
              costedMessages: row.messageCount,
            })),
        }))
      }
      return fetchMock(input)
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    const usageCostHeading = await screen.findByRole('heading', { level: 3, name: 'Usage & cost' })
    const usageCost = usageCostHeading.closest<HTMLElement>('[data-section-card]')!
    fireEvent.click(within(usageCost).getByRole('tab', { name: 'Reported cost' }))
    const exact = within(usageCost).getByRole('table', { name: 'Reported cost over time data', hidden: true })

    expect(usageCost.textContent).toContain('6 of 6 messages')
    expect(exact.textContent).toContain('No activity')
    expect(exact.textContent).not.toContain('Unreported')
  })

  it('keeps a wholly unreported cost day distinct from a reported zero-dollar day', async () => {
    const { fetchMock } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('/api/plugins/health/usage-history')) {
        const window = new URL(url, 'http://localhost').searchParams.get('window') as '24h' | '7d' | '30d'
        const data = history(window)
        return Promise.resolve(jsonResponse({
          ...data,
          byAgent: data.byAgent.map((row) => row.agent === 'pixel'
            ? { ...row, costUsdMicros: 5_000, costedMessages: 1 }
            : row),
          byDay: data.byDay.map((row) => row.day === data.throughDay
            ? { ...row, costUsdMicros: null, costedMessages: 0 }
            : row),
          byAgentDay: data.byAgentDay.map((row) => row.day === data.throughDay
            ? { ...row, costUsdMicros: null, costedMessages: 0 }
            : row),
        }))
      }
      return fetchMock(input)
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    const usageCostHeading = await screen.findByRole('heading', { level: 3, name: 'Usage & cost' })
    const usageCost = usageCostHeading.closest<HTMLElement>('[data-section-card]')!
    fireEvent.click(within(usageCost).getByRole('tab', { name: 'Reported cost' }))

    expect(within(usageCost).getByRole('img', { name: /07-13 \(in progress\): Unreported/i })).toBeDefined()
    expect(usageCost.textContent).toContain('Today has no reported cost evidence yet')
    expect(usageCost.textContent).not.toContain('$0.00 reported cost so far')
    expect(within(usageCost).getByRole('table', { name: 'Reported cost over time data', hidden: true }).textContent)
      .toContain('Unreported')
  })

  it('keeps coverage and the Models destination visible when no message reported cost', async () => {
    const { fetchMock } = stubAgentFetch()
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('/api/plugins/health/usage-history')) {
        const window = new URL(url, 'http://localhost').searchParams.get('window') as '24h' | '7d' | '30d'
        const data = history(window)
        return Promise.resolve(jsonResponse({
          ...data,
          byAgent: data.byAgent.map((row) => ({ ...row, costUsdMicros: null, costedMessages: 0 })),
          byDay: data.byDay.map((row) => ({ ...row, costUsdMicros: null, costedMessages: 0 })),
          byAgentDay: data.byAgentDay.map((row) => ({ ...row, costUsdMicros: null, costedMessages: 0 })),
        }))
      }
      return fetchMock(input)
    }) as unknown as typeof fetch

    render(<AgentsTab />)

    const usageCostHeading = await screen.findByRole('heading', { level: 3, name: 'Usage & cost' })
    const usageCost = usageCostHeading.closest<HTMLElement>('[data-section-card]')!
    fireEvent.click(within(usageCost).getByRole('tab', { name: 'Reported cost' }))

    expect(usageCost.textContent).toContain('Reported cost Unavailable')
    expect(usageCost.textContent).toContain('0 of 6 messages')
    expect(usageCost.textContent).toContain('No runtime-reported cost is available in this window.')
    expect(usageCost.textContent).toContain('none included runtime-reported cost')
    expect(usageCost.textContent).not.toContain('$0.00')
    expect(within(usageCost).getByRole('link', { name: 'View budgets in Models' }).getAttribute('href'))
      .toBe('/models?tab=spend')
  })
})
