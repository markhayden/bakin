// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

const clearReindexProgress = mock()

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
}))

mock.module('@makinbakin/sdk/components', () => ({
  PluginHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  UnderlineTabs: ({ tabs }: { tabs: Array<{ label: string }> }) => (
    <div>{tabs.map((tab) => <span key={tab.label}>{tab.label}</span>)}</div>
  ),
}))

import { HealthPage } from '../../../plugins/health/components/health-page'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  clearReindexProgress.mockClear()
})

describe('HealthPage search stats', () => {
  it('renders adapter document counts from the stable documents field', async () => {
    const fetchMock = mock((url: string) => {
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
        return Promise.resolve(jsonResponse({ plugins: [] }))
      }
      if (url === '/api/plugins/health/usage') {
        return Promise.resolve(jsonResponse([]))
      }
      if (url === '/api/plugins/health/search-status') {
        return Promise.resolve(jsonResponse({
          enabled: true,
          tables: [{
            table: 'bakin_tasks',
            pluginId: 'tasks',
            healthy: true,
            stats: { table: 'bakin_tasks', documents: 17 },
          }],
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

    render(<HealthPage />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/plugins/health/search-status'))
    expect(await screen.findByText('bakin_tasks')).toBeDefined()
    expect(screen.getByText('17')).toBeDefined()
  })
})
