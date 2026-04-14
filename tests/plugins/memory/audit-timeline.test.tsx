// @vitest-environment jsdom

/**
 * Smoke test for the AuditTimeline component.
 *
 * Validates:
 *  - Loading state renders before the audit fetch resolves
 *  - Entries fetched from /api/plugins/memory/audit render after resolution
 *  - Typing in the search input triggers the mocked useSearch.search()
 *  - searchHook.results drive the displayed list when present
 *  - Local-text fallback filters when search results are empty
 *  - Agent filter narrows the entries by agent id
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'
import type { AuditEntry } from '../../../plugins/memory/types'

// ---------------------------------------------------------------------------
// Mandatory content-dir isolation (per CLAUDE.md test rules) — this is a
// pure component test, but the safety hook still requires the mock so a
// stray import chain can never reach ~/.bakin/.
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-audit-timeline-${Date.now()}`)

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

vi.mock('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

// ---------------------------------------------------------------------------
// Hoisted mocks (must be declared before the component imports them)
// ---------------------------------------------------------------------------

const { searchMock, clearMock, agentIdsMock, contentStoreMock, searchState, queryStateRefs } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  clearMock: vi.fn(),
  agentIdsMock: vi.fn(),
  contentStoreMock: vi.fn(),
  searchState: {
    results: [] as Array<{ id: string; table: string; score: number; fields: Record<string, unknown> }>,
    loading: false,
  },
  queryStateRefs: {} as Record<string, string>,
}))

vi.mock('@/hooks/use-search', () => ({
  useSearch: () => ({
    results: searchState.results,
    aggregations: {},
    loading: searchState.loading,
    error: null,
    meta: null,
    search: searchMock,
    clear: clearMock,
  }),
  reorderBySearchResults: <T,>(items: T[]) => items,
}))

vi.mock('@/hooks/use-content-store', () => ({
  useContentStore: (selector: (s: { auditEntries: AuditEntry[] }) => unknown) =>
    selector({ auditEntries: contentStoreMock() }),
}))

vi.mock('@bakin/team/hooks/use-agent-store', () => ({
  useAgentIds: () => agentIdsMock(),
}))

// useQueryState — simple module-level ref per key so tests can drive URL
// state without a full Next.js router.
vi.mock('@/hooks/use-query-state', () => {
  const React = require('react')
  return {
    useQueryState: (key: string, defaultValue: string = '') => {
      if (!(key in queryStateRefs)) queryStateRefs[key] = defaultValue
      const [value, setValue] = React.useState<string>(queryStateRefs[key])
      const setter = (v: string) => {
        queryStateRefs[key] = v
        setValue(v)
      }
      return [value, setter, setter] as const
    },
  }
})

// AgentFilter stub — renders one button per agent id with the id as both
// test id and accessible label so tests can click a specific agent.
vi.mock('@/components/agent-filter', () => ({
  AgentFilter: ({ agentIds, value, onChange }: { agentIds: string[]; value: string; onChange: (v: string) => void }) => (
    <div data-testid="agent-filter" data-value={value}>
      <button title="all" onClick={() => onChange('all')}>all</button>
      {agentIds.map(id => (
        <button key={id} title={id} onClick={() => onChange(id)}>{id}</button>
      ))}
    </div>
  ),
}))

// Stub the heavy timeline row — we only care about the surrounding logic
vi.mock('../../../plugins/memory/components/timeline-entry', () => ({
  TimelineEntry: ({ entry }: { entry: AuditEntry }) => (
    <div data-testid="timeline-entry" data-event={entry.event} data-agent={entry.agent}>
      {entry.event}
    </div>
  ),
}))

// shadcn primitives — keep DOM lightweight
vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => (
    <input data-testid="search-input" {...(props as React.InputHTMLAttributes<HTMLInputElement>)} />
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, title, ...props }: Record<string, unknown>) => (
    <button
      onClick={onClick as () => void}
      title={title as string}
      {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {children as React.ReactNode}
    </button>
  ),
}))

vi.mock('lucide-react', () => ({
  Search: () => <span data-testid="search-icon" />,
}))

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------

const sampleEntries: AuditEntry[] = [
  { ts: '2026-04-14T10:00:00Z', event: 'task.created', agent: 'chef', data: { id: 't1' } },
  { ts: '2026-04-14T10:05:00Z', event: 'task.completed', agent: 'chef', data: { id: 't1' } },
  { ts: '2026-04-14T10:10:00Z', event: 'agent.online', agent: 'pixel', data: { reason: 'startup' } },
]

beforeEach(() => {
  searchState.results = []
  searchState.loading = false
  for (const k of Object.keys(queryStateRefs)) delete queryStateRefs[k]
  contentStoreMock.mockReturnValue([])
  agentIdsMock.mockReturnValue(['chef', 'pixel'])

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ entries: sampleEntries }),
    })) as unknown as typeof fetch,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  searchMock.mockClear()
  clearMock.mockClear()
  cleanup()
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { AuditTimeline } from '../../../plugins/memory/components/audit-timeline'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditTimeline', () => {
  it('renders a loading state initially', () => {
    // Make fetch hang so loading sticks
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})) as unknown as typeof fetch,
    )
    render(<AuditTimeline />)
    expect(screen.getByText(/Loading audit log/i)).toBeDefined()
  })

  it('renders fetched entries after the audit request resolves', async () => {
    render(<AuditTimeline />)
    await waitFor(() => {
      expect(screen.getAllByTestId('timeline-entry').length).toBe(3)
    })
  })

  it('calls useSearch.search() when typing in the search input', async () => {
    render(<AuditTimeline />)
    await waitFor(() => {
      expect(screen.getAllByTestId('timeline-entry').length).toBe(3)
    })

    const input = screen.getByTestId('search-input') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'task' } })
    })

    expect(searchMock).toHaveBeenCalledWith('task')
  })

  it('filters by useSearch results when present', async () => {
    searchState.results = [
      { id: '2026-04-14T10:00:00Z', table: 'bakin_audit', score: 5, fields: {} },
    ]

    render(<AuditTimeline />)
    await waitFor(() => {
      expect(screen.getAllByTestId('timeline-entry').length).toBe(3)
    })

    const input = screen.getByTestId('search-input') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'task' } })
    })

    await waitFor(() => {
      const rows = screen.getAllByTestId('timeline-entry')
      expect(rows).toHaveLength(1)
      expect(rows[0].getAttribute('data-event')).toBe('task.created')
    })
  })

  it('keeps the full list while searchLoading and no results yet', async () => {
    // 300ms debounce window — Antfly hasn't responded. List must not flash
    // "no matches" during the loading window.
    searchState.results = []
    searchState.loading = true

    render(<AuditTimeline />)
    await waitFor(() => {
      expect(screen.getAllByTestId('timeline-entry').length).toBe(3)
    })

    const input = screen.getByTestId('search-input') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'zzzzzz' } })
    })

    // All three entries still visible — flash guard holds.
    await waitFor(() => {
      expect(screen.getAllByTestId('timeline-entry').length).toBe(3)
    })
  })

  it('drops the local substring fallback: empty results show full list after loading settles', async () => {
    // Memory intentionally does NOT run a local substring fallback. When
    // Antfly returns no hits and loading settles, the timeline shows the
    // full agent/event-filtered list (score-map-exhaustive pattern).
    searchState.results = []
    searchState.loading = false

    render(<AuditTimeline />)
    await waitFor(() => {
      expect(screen.getAllByTestId('timeline-entry').length).toBe(3)
    })

    const input = screen.getByTestId('search-input') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'agent.online' } })
    })

    // Full list stays visible — no client-side substring narrowing.
    await waitFor(() => {
      expect(screen.getAllByTestId('timeline-entry').length).toBe(3)
    })
  })

  it('filters by agent when the AgentFilter emits an id', async () => {
    render(<AuditTimeline />)
    await waitFor(() => {
      expect(screen.getAllByTestId('timeline-entry').length).toBe(3)
    })

    const pixelBtn = screen.getByTitle('pixel')
    await act(async () => {
      fireEvent.click(pixelBtn)
    })

    await waitFor(() => {
      const rows = screen.getAllByTestId('timeline-entry')
      expect(rows).toHaveLength(1)
      expect(rows[0].getAttribute('data-agent')).toBe('pixel')
    })
  })
})
