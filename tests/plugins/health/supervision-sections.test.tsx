// @vitest-environment jsdom
/**
 * Supervision sections (#385) — live-now table, attention chips from cached
 * doctor data.agents, and the effort-vs-outcome table with delta columns.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
import '../../rtl-settle'
import type { ReactNode } from 'react'

const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-supervision-unused',
  getBakinPaths: () => ({ home: '/tmp/bakin-test-supervision-unused' }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

mock.module('@makinbakin/sdk/hooks', () => ({
  useQueryState: (_key: string, initial: string) => [initial, mock()],
}))
mock.module('@makinbakin/sdk/components', () => ({
  ChartExplainer: ({ children }: { children: ReactNode }) => <p role="note">{children}</p>,
}))

import {
  LiveNowSection,
  AttentionSection,
  EffortSection,
  deriveAttentionChips,
} from '../../../plugins/health/components/supervision-sections'
import type { PolledResult } from '../../../plugins/health/components/use-health-data'
import type { HealthSummary } from '../../../plugins/health/types'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}

function stubFetch(routes: Record<string, unknown>) {
  const fetchMock = mock((url: string) => {
    for (const [prefix, body] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return Promise.resolve(jsonResponse(body))
    }
    return Promise.resolve(jsonResponse({}))
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function summaryResult(doctor: unknown): PolledResult<HealthSummary> {
  return {
    data: { doctor } as unknown as HealthSummary,
    error: null,
    loading: false,
    lastUpdated: Date.now(),
    refresh: () => {},
  }
}


describe('deriveAttentionChips', () => {
  it('builds chips only from data.agents on the three attention checks', () => {
    const chips = deriveAttentionChips([
      { check: 'agent-sync', status: 'warn', message: '2 stale', data: { agents: ['pixel', 'scout'] } },
      { check: 'usage.agent-burn', status: 'warn', message: 'burn', data: { agents: ['pixel'] } },
      { check: 'context.startup-size', status: 'ok', message: 'fine', data: { agents: ['basil'] } }, // ok → no chip
      { check: 'search', status: 'error', message: 'down' }, // not an attention check
      { check: 'agent-sync', status: 'warn', message: 'no data field' }, // no agents → no chips
    ])
    expect(chips.map((c) => `${c.agent}:${c.kind}`)).toEqual(['pixel:burn', 'pixel:drift', 'scout:drift'])
  })
})

describe('LiveNowSection', () => {
  it('renders the honest empty state', async () => {
    stubFetch({ '/api/plugins/health/live-now': { runs: [], generatedAt: 'now' } })
    render(<LiveNowSection refreshNonce={0} />)
    expect(await screen.findByText(/Nothing is running right now/)).toBeDefined()
  })

  it('renders an in-flight run and flags a stale heartbeat', async () => {
    stubFetch({
      '/api/plugins/health/live-now': {
        generatedAt: 'now',
        runs: [{
          agent: 'pixel', taskId: 't1', taskTitle: 'resize hero images', runId: 'task:t1:d1',
          startedAt: 0, runningForMs: 95_000, heartbeatAgeMs: 200_000,
        }],
      },
    })
    render(<LiveNowSection refreshNonce={0} />)
    expect(await screen.findByText('resize hero images')).toBeDefined()
    expect(screen.getByText('pixel')).toBeDefined()
    expect(screen.getByText(/⚠/)).toBeDefined() // stale heartbeat marker
  })
})

describe('AttentionSection', () => {
  it('waits for the first doctor run', () => {
    render(<AttentionSection result={summaryResult(null)} />)
    expect(screen.getByText(/Waiting for the first doctor run/)).toBeDefined()
  })

  it('renders all-healthy when the cache has no flagged agents', () => {
    render(<AttentionSection result={summaryResult({ results: [{ check: 'agent-sync', status: 'ok', message: 'in sync' }] })} />)
    expect(screen.getByText('All agents look healthy.')).toBeDefined()
  })

  it('renders deep-linking chips for flagged agents', () => {
    render(
      <AttentionSection
        result={summaryResult({
          results: [{ check: 'usage.agent-burn', status: 'warn', message: 'pixel burns', data: { agents: ['pixel'] } }],
        })}
      />,
    )
    const chip = screen.getByRole('link')
    expect(chip.getAttribute('href')).toBe('/team/pixel?tab=diagnostics')
    expect(chip.textContent).toContain('pixel')
    expect(chip.textContent).toContain('token burn')
  })
})

describe('EffortSection', () => {
  it('renders delta columns with null-honest em-dashes and the flag marker', async () => {
    stubFetch({
      '/api/plugins/health/agent-effort': {
        window: '24h',
        scannedAt: null,
        agents: [
          {
            agent: 'pixel', windowTokens: 210_000, windowCostUsdMicros: 40_000, runs: 14, completions: 1,
            tokensPerCompletion: 210_000, totalObservedTokens: 1_000_000, unattributedTokens: 790_000,
            flags: [{ kind: 'unattributed', message: 'pixel used 790k tokens outside Bakin-managed tasks' }],
          },
          {
            agent: 'scout', windowTokens: 5_000, windowCostUsdMicros: null, runs: 2, completions: 2,
            tokensPerCompletion: 2_500, totalObservedTokens: null, unattributedTokens: null, flags: [],
          },
        ],
      },
    })
    render(<EffortSection refreshNonce={0} />)
    expect(await screen.findByText('pixel')).toBeDefined()
    expect(screen.getByText('scout')).toBeDefined()
    // scout's observed/unattributed/cost are unknown → em-dashes, never zeros
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
    // pixel's flag marker present
    expect(screen.getByText('⚠')).toBeDefined()
  })

  it('honest empty state', async () => {
    stubFetch({ '/api/plugins/health/agent-effort': { window: '24h', scannedAt: null, agents: [] } })
    render(<EffortSection refreshNonce={0} />)
    expect(await screen.findByText('No agent activity in this window.')).toBeDefined()
  })
})
