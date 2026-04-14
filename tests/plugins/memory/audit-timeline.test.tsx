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

const { searchMock, clearMock, agentListMock, contentStoreMock, searchState } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  clearMock: vi.fn(),
  agentListMock: vi.fn(),
  contentStoreMock: vi.fn(),
  searchState: {
    results: [] as Array<{ id: string; table: string; score: number; fields: Record<string, unknown> }>,
  },
}))

vi.mock('@/hooks/use-search', () => ({
  useSearch: () => ({
    results: searchState.results,
    aggregations: {},
    loading: false,
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
  useAgentList: () => agentListMock(),
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
  contentStoreMock.mockReturnValue([])
  agentListMock.mockReturnValue([
    { id: 'chef', name: 'Chef', emoji: '🌿', role: 'Cook', headshot: '' },
    { id: 'pixel', name: 'Pixel', emoji: '🎨', role: 'Designer', headshot: '' },
  ])

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

  it('falls back to local text filter when search results are empty', async () => {
    searchState.results = [] // no matches from useSearch

    render(<AuditTimeline />)
    await waitFor(() => {
      expect(screen.getAllByTestId('timeline-entry').length).toBe(3)
    })

    const input = screen.getByTestId('search-input') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'agent.online' } })
    })

    await waitFor(() => {
      const rows = screen.getAllByTestId('timeline-entry')
      expect(rows).toHaveLength(1)
      expect(rows[0].getAttribute('data-event')).toBe('agent.online')
    })
  })

  it('filters by agent when the agent button is clicked', async () => {
    render(<AuditTimeline />)
    await waitFor(() => {
      expect(screen.getAllByTestId('timeline-entry').length).toBe(3)
    })

    const pixelBtn = screen.getByTitle('Pixel')
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
