// @vitest-environment jsdom

/**
 * Brainstorm search consumer smoke tests.
 *
 * Covers the C13 wiring: BrainstormView consumes `useSearch({ plugin:
 * 'messaging' })` and feeds `searchResults` into `SessionList`, which
 * filters its locally-fetched sessions by Antfly hits (stripping the
 * `brainstorm-` key prefix) and falls back to a local title/agentId
 * substring filter when the hook returns nothing.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-messaging-consumer-${Date.now()}`)

vi.mock('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

vi.mock('@/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/core/watcher', () => ({
  registerSyncHook: vi.fn(),
  registerUnlinkHook: vi.fn(),
}))

vi.mock('@/core/openclaw-client', () => ({
  sendToAgent: vi.fn(),
}))

// ---------------------------------------------------------------------------
// useSearch — capture per-call so tests can drive `results` from outside.
// ---------------------------------------------------------------------------

type Hook = {
  results: Array<{ id: string; table: string; score: number; fields: Record<string, unknown> }>
  search: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  aggregations: Record<string, unknown>
  loading: boolean
  error: null
  meta: null
}

const hookState: Hook = {
  results: [],
  search: vi.fn(),
  clear: vi.fn(),
  aggregations: {},
  loading: false,
  error: null,
  meta: null,
}

const useSearchMock = vi.fn((..._args: unknown[]) => hookState)

vi.mock('@/hooks/use-search', () => ({
  useSearch: (...args: unknown[]) => useSearchMock(...args),
}))

// useQueryState — back with a plain useState so the search field is reactive.
vi.mock('@/hooks/use-query-state', async () => {
  const { useState } = await import('react')
  return {
    useQueryState: (_key: string, defaultValue: string) => {
      const [value, setValue] = useState(defaultValue ?? '')
      return [value, setValue, setValue]
    },
    useQueryArrayState: () => {
      const [value, setValue] = useState<string[]>([])
      return [value, setValue, setValue]
    },
  }
})

// next/navigation — minimal shims
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/messaging/brainstorm',
}))

// Heavy / unrelated children
vi.mock('@/components/plugin-header', () => ({
  PluginHeader: ({ title, search }: { title: string; search?: { value: string; onChange: (v: string) => void; placeholder?: string } }) => (
    <div>
      <h1>{title}</h1>
      {search && (
        <input
          data-testid="brainstorm-search-input"
          value={search.value}
          placeholder={search.placeholder}
          onChange={(e) => search.onChange(e.target.value)}
        />
      )}
    </div>
  ),
}))

vi.mock('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span data-testid={`avatar-${agentId}`} />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} disabled={disabled as boolean}>
      {children as React.ReactNode}
    </button>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: Record<string, unknown>) => <span>{children as React.ReactNode}</span>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: Record<string, unknown>) => <div>{children as React.ReactNode}</div>,
  DropdownMenuTrigger: ({ children }: Record<string, unknown>) => <div>{children as React.ReactNode}</div>,
  DropdownMenuContent: ({ children }: Record<string, unknown>) => <div>{children as React.ReactNode}</div>,
  DropdownMenuItem: ({ children, onClick }: Record<string, unknown>) => (
    <div onClick={onClick as () => void}>{children as React.ReactNode}</div>
  ),
}))

// Stub every lucide icon with a noop span. List names imported by
// brainstorm-view + session-list so destructured imports resolve.
vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children, onClick, ...props }: { children: React.ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    <tr onClick={onClick} {...props}>{children}</tr>
  ),
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
}))

vi.mock('../../../plugins/messaging/components/planning-layout', () => ({
  PlanningLayout: () => <div data-testid="planning-layout" />,
}))

vi.mock('../../../plugins/messaging/components/new-session-dialog', () => ({
  NewSessionDialog: () => null,
}))

vi.mock('../../../plugins/messaging/components/delete-session-dialog', () => ({
  DeleteSessionDialog: () => null,
}))

// ---------------------------------------------------------------------------
// Imports — real BrainstormView + real SessionList
// ---------------------------------------------------------------------------
import { BrainstormView } from '../../../plugins/messaging/components/brainstorm-view'

const SESSIONS = [
  {
    id: 'sess-recipes',
    agentId: 'basil',
    title: 'Week 16 recipes',
    status: 'active' as const,
    createdAt: '2026-04-07T10:00:00Z',
    updatedAt: '2026-04-09T15:00:00Z',
    proposalCount: 5,
    approvedCount: 2,
  },
  {
    id: 'sess-outdoor',
    agentId: 'scout',
    title: 'Outdoor sprint',
    status: 'active' as const,
    createdAt: '2026-04-08T10:00:00Z',
    updatedAt: '2026-04-09T16:00:00Z',
    proposalCount: 3,
    approvedCount: 0,
  },
]

function mockFetchSessions() {
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/plugins/messaging/sessions')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ sessions: SESSIONS }),
      })
    }
    return Promise.resolve({ ok: false })
  }) as typeof fetch
}

beforeEach(() => {
  hookState.results = []
  hookState.search.mockClear()
  hookState.clear.mockClear()
  useSearchMock.mockClear()
  mockFetchSessions()
})

afterEach(() => cleanup())

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BrainstormView (search consumer)', () => {
  it('renders without crashing and shows fetched sessions', async () => {
    render(<BrainstormView />)
    await waitFor(() => {
      expect(screen.getByText('Brainstorm')).toBeDefined()
    })
    await waitFor(() => {
      expect(screen.getByText('Week 16 recipes')).toBeDefined()
    })
    expect(screen.getByText('Outdoor sprint')).toBeDefined()
  })

  it('configures useSearch with plugin "messaging" and brainstorm facets', () => {
    render(<BrainstormView />)
    expect(useSearchMock).toHaveBeenCalled()
    const args = useSearchMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(args?.plugin).toBe('messaging')
    expect(args?.facets).toEqual(['status', 'agent_id'])
  })

  it('forwards typed query into searchHook.search()', async () => {
    render(<BrainstormView />)
    await waitFor(() => {
      expect(screen.getByTestId('brainstorm-search-input')).toBeDefined()
    })
    fireEvent.change(screen.getByTestId('brainstorm-search-input'), { target: { value: 'recipes' } })
    await waitFor(() => {
      expect(hookState.search).toHaveBeenCalledWith('recipes')
    })
  })

  it('filters session list to Antfly hits when results are non-empty (strips brainstorm- prefix)', async () => {
    hookState.results = [
      { id: 'brainstorm-sess-recipes', table: 'bakin_messaging_brainstorm', score: 0.95, fields: {} },
    ]
    render(<BrainstormView />)
    await waitFor(() => {
      expect(screen.getByText('Week 16 recipes')).toBeDefined()
    })

    // Trigger a query so the substring/empty branch is bypassed
    fireEvent.change(screen.getByTestId('brainstorm-search-input'), { target: { value: 'recipes' } })

    await waitFor(() => {
      // The matched session is still visible; the unmatched one is filtered out
      expect(screen.queryByText('Outdoor sprint')).toBeNull()
    })
    expect(screen.getByText('Week 16 recipes')).toBeDefined()
  })

  it('falls back to local title/agentId substring when searchHook.results is empty', async () => {
    hookState.results = [] // Antfly returned nothing
    render(<BrainstormView />)
    await waitFor(() => {
      expect(screen.getByText('Outdoor sprint')).toBeDefined()
    })
    fireEvent.change(screen.getByTestId('brainstorm-search-input'), { target: { value: 'outdoor' } })
    await waitFor(() => {
      expect(screen.queryByText('Week 16 recipes')).toBeNull()
    })
    expect(screen.getByText('Outdoor sprint')).toBeDefined()
  })
})
