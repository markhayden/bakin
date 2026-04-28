// @vitest-environment jsdom

import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, beforeEach, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-session-list-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    settings: join(testDir, 'settings.json'),
  }),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

mock.module('../../../src/core/watcher', () => ({
  watchFiles: mock(),
}))

mock.module('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} disabled={disabled as boolean} {...props}>
      {children as React.ReactNode}
    </button>
  ),
}))

mock.module('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: Record<string, unknown>) => (
    <span data-testid="badge" {...props}>{children as React.ReactNode}</span>
  ),
}))

mock.module('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => (
    <span data-testid={`avatar-${agentId}`} />
  ),
}))

mock.module('@/components/ui/table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children, onClick, ...props }: { children: React.ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    <tr onClick={onClick} {...props}>{children}</tr>
  ),
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
}))

mock.module('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: Record<string, unknown>) => <div>{children as React.ReactNode}</div>,
  DropdownMenuTrigger: ({ children, onClick }: Record<string, unknown>) => <div onClick={onClick as () => void}>{children as React.ReactNode}</div>,
  DropdownMenuContent: ({ children }: Record<string, unknown>) => <div>{children as React.ReactNode}</div>,
  DropdownMenuItem: ({ children, onClick }: Record<string, unknown>) => <div onClick={onClick as () => void}>{children as React.ReactNode}</div>,
}))

mock.module('../../../plugins/messaging/components/delete-session-dialog', () => ({
  DeleteSessionDialog: () => null,
}))

const MOCK_AGENTS = [
  { id: 'basil', name: 'Basil', emoji: '🥗', role: '', headshot: '' },
  { id: 'scout', name: 'Scout', emoji: '🏕️', role: '', headshot: '' },
  { id: 'nemo', name: 'Nemo', emoji: '🏊', role: '', headshot: '' },
  { id: 'zen', name: 'Zen', emoji: '🧘', role: '', headshot: '' },
]
mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgentList: () => MOCK_AGENTS,
  useAgentIds: () => MOCK_AGENTS.map(a => a.id),
  useAgent: (id: string) => MOCK_AGENTS.find(a => a.id === id),
  useAgentColor: () => '#a1a1aa',
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ agents: MOCK_AGENTS, agentIds: MOCK_AGENTS.map(a => a.id) }),
}))

import { SessionList } from '../../../plugins/messaging/components/session-list'

afterEach(() => cleanup())

const mockSessions = [
  {
    id: 's1',
    agentId: 'basil',
    title: 'Week 15 recipes',
    status: 'active' as const,
    createdAt: '2026-04-07T10:00:00Z',
    updatedAt: '2026-04-09T15:00:00Z',
    proposalCount: 5,
    approvedCount: 3,
  },
  {
    id: 's2',
    agentId: 'basil',
    title: 'Week 14 recipes',
    status: 'completed' as const,
    createdAt: '2026-03-31T10:00:00Z',
    updatedAt: '2026-04-04T12:00:00Z',
    proposalCount: 7,
    approvedCount: 7,
  },
  {
    id: 's3',
    agentId: 'scout',
    title: 'Outdoor content sprint',
    status: 'active' as const,
    createdAt: '2026-04-08T09:00:00Z',
    updatedAt: '2026-04-09T14:00:00Z',
    proposalCount: 3,
    approvedCount: 1,
  },
]

function mockFetch(sessions = mockSessions) {
  return mock().mockImplementation((url: string, opts?: RequestInit) => {
    if (url === '/api/plugins/messaging/sessions' && (!opts || opts.method !== 'POST')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ sessions }),
      })
    }
    if (url === '/api/plugins/messaging/sessions' && opts?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          session: { id: 'new-session-id', agentId: 'basil', title: 'New planning session' },
        }),
      })
    }
    return Promise.resolve({ ok: false })
  })
}

describe('SessionList', () => {
  beforeEach(() => {
    mock.restore()
  })

  it('shows empty state when no sessions', async () => {
    globalThis.fetch = mockFetch([]) as unknown as typeof fetch
    render(<SessionList onSelectSession={mock()} />)
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeDefined()
    })
    expect(screen.getByText('Plan your content calendar')).toBeDefined()
  })

  it('shows agent cards in empty state', async () => {
    globalThis.fetch = mockFetch([]) as unknown as typeof fetch
    render(<SessionList onSelectSession={mock()} />)
    await waitFor(() => {
      expect(screen.getByTestId('agent-card-basil')).toBeDefined()
    })
    expect(screen.getByTestId('agent-card-scout')).toBeDefined()
    expect(screen.getByTestId('agent-card-nemo')).toBeDefined()
    expect(screen.getByTestId('agent-card-zen')).toBeDefined()
  })

  it('renders session entries with correct data', async () => {
    globalThis.fetch = mockFetch() as unknown as typeof fetch
    render(<SessionList onSelectSession={mock()} />)
    await waitFor(() => {
      expect(screen.getByText('Week 15 recipes')).toBeDefined()
    })
    expect(screen.getByText('Week 14 recipes')).toBeDefined()
    expect(screen.getByText('Outdoor content sprint')).toBeDefined()
  })

  it('filters sessions by agentFilter prop', async () => {
    globalThis.fetch = mockFetch() as unknown as typeof fetch
    render(<SessionList onSelectSession={mock()} agentFilter="basil" />)
    await waitFor(() => {
      expect(screen.getByTestId('session-entry-s1')).toBeDefined()
    })
    expect(screen.getByTestId('session-entry-s2')).toBeDefined()
    expect(screen.queryByTestId('session-entry-s3')).toBeNull()
  })

  it('shows proposal counts on entries', async () => {
    globalThis.fetch = mockFetch() as unknown as typeof fetch
    render(<SessionList onSelectSession={mock()} />)
    await waitFor(() => {
      expect(screen.getByText('3/5')).toBeDefined()
    })
    expect(screen.getByText('7/7')).toBeDefined()
    expect(screen.getByText('1/3')).toBeDefined()
  })

  it('shows active before completed (sorting)', async () => {
    globalThis.fetch = mockFetch() as unknown as typeof fetch
    render(<SessionList onSelectSession={mock()} />)
    await waitFor(() => {
      expect(screen.getByTestId('session-entry-s1')).toBeDefined()
    })
    // Active sessions should appear before completed in the basil group
    const s1 = screen.getByTestId('session-entry-s1')
    const s2 = screen.getByTestId('session-entry-s2')
    // s1 (active) should come before s2 (completed) in DOM order
    expect(s1.compareDocumentPosition(s2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('calls onSelectSession when clicking a session', async () => {
    globalThis.fetch = mockFetch() as unknown as typeof fetch
    const onSelect = mock()
    render(<SessionList onSelectSession={onSelect} />)
    await waitFor(() => {
      expect(screen.getByTestId('session-entry-s1')).toBeDefined()
    })
    fireEvent.click(screen.getByTestId('session-entry-s1'))
    expect(onSelect).toHaveBeenCalledWith('s1')
  })

  it('calls onCreateSession via empty state agent card', async () => {
    globalThis.fetch = mockFetch([]) as unknown as typeof fetch
    const onCreate = mock()
    render(<SessionList onSelectSession={mock()} onCreateSession={onCreate} />)
    await waitFor(() => {
      expect(screen.getByTestId('agent-card-basil')).toBeDefined()
    })
    fireEvent.click(screen.getByTestId('agent-card-basil'))
    expect(onCreate).toHaveBeenCalledWith('basil')
  })

  it('reorders by search score when searchResults are provided', async () => {
    globalThis.fetch = mockFetch() as unknown as typeof fetch
    // s3 wins, then s1. s2 is filtered out because it's not in scoreMap.
    // Keys come in with the `brainstorm-` prefix — the component strips it.
    const searchResults = [
      { id: 'brainstorm-s3', table: 'messaging_brainstorm', score: 0.9, fields: {} },
      { id: 'brainstorm-s1', table: 'messaging_brainstorm', score: 0.4, fields: {} },
    ]
    render(
      <SessionList
        onSelectSession={mock()}
        search="tips"
        searchResults={searchResults}
      />
    )
    await waitFor(() => {
      expect(screen.getByTestId('session-entry-s3')).toBeDefined()
    })
    expect(screen.getByTestId('session-entry-s1')).toBeDefined()
    expect(screen.queryByTestId('session-entry-s2')).toBeNull()
    const s3 = screen.getByTestId('session-entry-s3')
    const s1 = screen.getByTestId('session-entry-s1')
    // Higher score (s3) should render before lower (s1)
    expect(s3.compareDocumentPosition(s1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps full list visible while searchLoading and no results yet', async () => {
    globalThis.fetch = mockFetch() as unknown as typeof fetch
    // Search is typed, but the hook hasn't resolved — searchLoading=true.
    // The list should stay populated instead of flashing "no matches".
    render(
      <SessionList
        onSelectSession={mock()}
        search="water"
        searchResults={[]}
        searchLoading={true}
      />
    )
    await waitFor(() => {
      expect(screen.getByTestId('session-entry-s1')).toBeDefined()
    })
    expect(screen.getByTestId('session-entry-s2')).toBeDefined()
    expect(screen.getByTestId('session-entry-s3')).toBeDefined()
    expect(screen.queryByText(/No sessions matching/)).toBeNull()
  })

  it('falls back to local substring match when loading settles with no hits', async () => {
    globalThis.fetch = mockFetch() as unknown as typeof fetch
    // Loading has settled (searchLoading=false) and search returned nothing
    // — the local title/agentId substring path runs.
    render(
      <SessionList
        onSelectSession={mock()}
        search="outdoor"
        searchResults={[]}
        searchLoading={false}
      />
    )
    await waitFor(() => {
      expect(screen.getByTestId('session-entry-s3')).toBeDefined()
    })
    expect(screen.queryByTestId('session-entry-s1')).toBeNull()
    expect(screen.queryByTestId('session-entry-s2')).toBeNull()
  })
})
