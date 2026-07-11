// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

const clearReindexProgress = mock()

// Pure client-component test (stubbed global fetch, no server imports) — the
// isolation mocks are belt-and-braces per the repo's test rules.
const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-health-page-unused',
  getBakinPaths: () => ({ home: '/tmp/bakin-test-health-page-unused' }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

mock.module('@makinbakin/sdk/hooks', () => ({
  useContentStore: (selector: (state: { reindexProgress: Record<string, unknown>; clearReindexProgress: () => void }) => unknown) =>
    selector({ reindexProgress: {}, clearReindexProgress }),
  useQueryState: (_key: string, initial: string) => [initial, mock()],
}))

mock.module('@makinbakin/sdk/ui', () => ({
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  CardHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  CardTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Skeleton: () => <div data-testid="skeleton" />,
  Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) => open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

mock.module('@makinbakin/sdk/components', () => ({
  PluginHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  UnderlineTabs: ({ tabs }: { tabs: Array<{ label: string }> }) => (
    <div>{tabs.map((tab) => <span key={tab.label}>{tab.label}</span>)}</div>
  ),
  StackedColumnChart: ({ data }: { data: Array<{ x: string; values: Record<string, number> }> }) => (
    <div data-testid="stacked-chart">
      {data.map((d) => (
        <span key={d.x} title={`${d.x}: ${Object.values(d.values).reduce((a, b) => a + b, 0)} tokens`} />
      ))}
    </div>
  ),
  ChartExplainer: ({ children }: { children: ReactNode }) => <p role="note">{children}</p>,
}))

import { HealthPage } from '../../../plugins/health/components/health-page'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  })
}

function setupHealthFetch(options: {
  usage?: unknown[]
  usageHistory?: Record<string, unknown>
  searchTables?: unknown[]
  registryPlugins?: unknown[]
  manifestPlugins?: unknown[]
} = {}) {
  const fetchMock = mock((url: string, init?: RequestInit) => {
    if (url === '/api/plugins/upgrade' && init?.method === 'POST') {
      return Promise.resolve(jsonResponse({ ok: true, id: 'projects', noop: false }))
    }
    if (url === '/api/plugins/health/summary') {
      return Promise.resolve(jsonResponse({
        doctor: null,
        errors1h: { total: 0, byKind: { mcp: 0, rest: 0, agent: 0 } },
        activeSessions: [],
        upSince: '2026-05-01T00:00:00.000Z',
        server: { port: 3737, pid: 1, nodeVersion: 'v22.0.0', memoryMB: 512, totalMemoryMB: 4096 },
      }))
    }
    if (url === '/api/plugins/health/registry') {
      return Promise.resolve(jsonResponse({ plugins: options.registryPlugins ?? [] }))
    }
    if (url.startsWith('/api/plugins/manifest')) {
      return Promise.resolve(jsonResponse({ plugins: options.manifestPlugins ?? [] }))
    }
    if (url === '/api/plugins/health/usage') {
      return Promise.resolve(jsonResponse(options.usage ?? []))
    }
    if (url.startsWith('/api/plugins/health/usage-history')) {
      return Promise.resolve(jsonResponse(options.usageHistory ?? {
        window: '24h', since: '2026-05-01', scannedAt: null, byAgent: [], byDay: [],
      }))
    }
    if (url === '/api/plugins/health/search-status') {
      return Promise.resolve(jsonResponse({
        enabled: true,
        tables: options.searchTables ?? [],
      }))
    }
    if (url.startsWith('/api/plugins/health/usage-feed')) {
      return Promise.resolve(jsonResponse({
        totals: { count: 0, errors: 0, errorRate: 0 },
        topByName: [],
        byAgent: [],
        recent: [],
      }))
    }
    return Promise.resolve(jsonResponse({}))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearReindexProgress.mockClear()
})

describe('HealthPage search stats', () => {
  it('renders per-table doc counts from the blue/green snapshot', async () => {
    const fetchMock = setupHealthFetch({
      searchTables: [{
        logical: 'bakin_tasks',
        physical: 'bakin_tasks_v1_abcd1234',
        schemaVersion: 1,
        state: 'active',
        phase: null,
        pluginId: 'tasks',
        healthy: true,
        docCount: 17,
        legs: [],
      }],
    })

    render(<HealthPage />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/plugins/health/search-status'))
    expect(await screen.findByText('bakin_tasks')).toBeDefined()
    expect(screen.getByText('17')).toBeDefined()
  })
})

describe('HealthPage runtime usage display', () => {
  it('shows the Runtime Usage token table without a dollar cost (cost lives in Bakin Spend)', async () => {
    setupHealthFetch({
      usage: [
        {
          agent: 'patch',
          sessionId: 's1',
          sessionStarted: '2026-05-26T10:00:00.000Z',
          model: 'claude-4',
          messages: 2,
          tokens: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 0, total: 1700 },
          cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0, total: 0.031, source: 'runtime' },
        },
        {
          agent: 'local',
          sessionId: 's2',
          sessionStarted: '2026-05-26T11:00:00.000Z',
          model: 'local-model',
          messages: 1,
          tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
          cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null, source: 'unavailable' },
        },
      ],
    })

    render(<HealthPage />)

    // The runtime card is now usage-only (tokens), no dollar figure — cost
    // moved to the separate "Bakin Spend" card to avoid two competing
    // "cost" numbers.
    expect(await screen.findByText('Latest Session Context')).toBeDefined()
    expect(screen.getAllByText('patch').length).toBeGreaterThan(0)
    // No runtime-reported dollar cost rendered on this card anymore.
    expect(screen.queryByText(/reported/)).toBeNull()
    expect(screen.queryByText(/\$0\.03/)).toBeNull()
  })
})

describe('HealthPage plugin update controls', () => {
  const registryPlugins = [{
    id: 'projects',
    name: 'Projects',
    version: '2.0.0',
    description: 'Project management',
    source: 'user',
    routes: 15,
  }]

  const manifestPlugins = [{
    id: 'projects',
    name: 'Projects',
    version: '2.0.0',
    source: 'github',
    installed: {
      type: 'github',
      version: '2.0.0',
      commitSha: 'oldsha',
      remoteHeadSha: 'newsha',
      lastChecked: '2026-06-01T12:00:00.000Z',
    },
    upgradeAvailable: true,
    staleHintDays: null,
  }]

  it('checks plugin updates on load and renders update state with manual check', async () => {
    const fetchMock = setupHealthFetch({ registryPlugins, manifestPlugins })

    render(<HealthPage />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/plugins/manifest?check=1'))
    expect(await screen.findByText('Update available')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Upgrade Projects' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Check plugin updates now' }))
    await waitFor(() => expect(fetchMock.mock.calls.filter((call) => call[0] === '/api/plugins/manifest?check=1').length).toBeGreaterThanOrEqual(2))
  })

  it('opens the plugin upgrade modal and calls the upgrade endpoint', async () => {
    const fetchMock = setupHealthFetch({ registryPlugins, manifestPlugins })

    render(<HealthPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade Projects' }))
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Upgrade Projects' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade plugin' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => (
        call[0] === '/api/plugins/upgrade'
        && (call[1] as RequestInit | undefined)?.method === 'POST'
        && String((call[1] as RequestInit | undefined)?.body).includes('"pluginId":"projects"')
      ))).toBe(true)
    })
  })
})

describe('HealthPage usage history section', () => {
  afterEach(() => cleanup())

  it('renders per-agent rollups with partial-cost indicator and em-dash for no cost', async () => {
    setupHealthFetch({
      usageHistory: {
        window: '24h',
        since: '2026-05-01',
        scannedAt: '2026-05-02T10:00:00.000Z',
        byAgent: [
          {
            agent: 'basil',
            tokens: { input: 1000, output: 500, cacheRead: 10, cacheWrite: 5, total: 1515 },
            costUsdMicros: 12_000, costedMessages: 2, messageCount: 3,
          },
          {
            agent: 'clover',
            tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
            costUsdMicros: null, costedMessages: 0, messageCount: 4,
          },
        ],
        byDay: [
          { day: '2026-05-01', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 800 }, costUsdMicros: null, costedMessages: 0, messageCount: 2 },
          { day: '2026-05-02', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 865 }, costUsdMicros: null, costedMessages: 0, messageCount: 5 },
        ],
      },
    })

    render(<HealthPage />)

    expect(await screen.findByText('Usage History')).toBeDefined()
    expect(await screen.findByText('basil')).toBeDefined()
    expect(screen.getByText('clover')).toBeDefined()
    // Partial coverage marker on basil's runtime-reported cost.
    expect(screen.getByTitle('Runtime-reported cost on 2 of 3 messages')).toBeDefined()
    // clover reported no cost — em-dash, never $0.
    expect(screen.getByText('—')).toBeDefined()
    // Daily chart bars carry per-day tooltips.
    expect(screen.getByTitle(/2026-05-01: 800 tokens/)).toBeDefined()
  })

  it('renders the honest empty state before any scan has completed', async () => {
    setupHealthFetch()
    render(<HealthPage />)
    expect(await screen.findByText(/first transcript scan has not completed/)).toBeDefined()
  })
})
