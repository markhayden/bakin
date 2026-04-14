// @vitest-environment jsdom

import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-session-list-${Date.now()}`)

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    settings: join(testDir, 'settings.json'),
  }),
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('../../../src/core/watcher', () => ({
  watchFiles: vi.fn(),
}))

vi.mock('../../../src/core/openclaw-client', () => ({
  sendMessage: vi.fn(),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} disabled={disabled as boolean} {...props}>
      {children as React.ReactNode}
    </button>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: Record<string, unknown>) => (
    <span data-testid="badge" {...props}>{children as React.ReactNode}</span>
  ),
}))

vi.mock('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => (
    <span data-testid={`avatar-${agentId}`} />
  ),
}))

vi.mock('lucide-react', () => ({
  Plus: () => <span />,
  MessageSquare: () => <span />,
  CheckCircle: () => <span data-testid="check-circle" />,
  MoreHorizontal: () => <span />,
  Trash2: () => <span />,
  ArrowUpDown: () => <span />,
}))

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

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: Record<string, unknown>) => <div>{children as React.ReactNode}</div>,
  DropdownMenuTrigger: ({ children, onClick }: Record<string, unknown>) => <div onClick={onClick as () => void}>{children as React.ReactNode}</div>,
  DropdownMenuContent: ({ children }: Record<string, unknown>) => <div>{children as React.ReactNode}</div>,
  DropdownMenuItem: ({ children, onClick }: Record<string, unknown>) => <div onClick={onClick as () => void}>{children as React.ReactNode}</div>,
}))

vi.mock('../../../plugins/messaging/components/delete-session-dialog', () => ({
  DeleteSessionDialog: () => null,
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
  return vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
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
    vi.restoreAllMocks()
  })

  it('shows empty state when no sessions', async () => {
    globalThis.fetch = mockFetch([])
    render(<SessionList onSelectSession={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeDefined()
    })
    expect(screen.getByText('Plan your content calendar')).toBeDefined()
  })

  it('shows agent cards in empty state', async () => {
    globalThis.fetch = mockFetch([])
    render(<SessionList onSelectSession={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('agent-card-basil')).toBeDefined()
    })
    expect(screen.getByTestId('agent-card-scout')).toBeDefined()
    expect(screen.getByTestId('agent-card-nemo')).toBeDefined()
    expect(screen.getByTestId('agent-card-zen')).toBeDefined()
  })

  it('renders session entries with correct data', async () => {
    globalThis.fetch = mockFetch()
    render(<SessionList onSelectSession={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Week 15 recipes')).toBeDefined()
    })
    expect(screen.getByText('Week 14 recipes')).toBeDefined()
    expect(screen.getByText('Outdoor content sprint')).toBeDefined()
  })

  it('filters sessions by agentFilter prop', async () => {
    globalThis.fetch = mockFetch()
    render(<SessionList onSelectSession={vi.fn()} agentFilter="basil" />)
    await waitFor(() => {
      expect(screen.getByTestId('session-entry-s1')).toBeDefined()
    })
    expect(screen.getByTestId('session-entry-s2')).toBeDefined()
    expect(screen.queryByTestId('session-entry-s3')).toBeNull()
  })

  it('shows proposal counts on entries', async () => {
    globalThis.fetch = mockFetch()
    render(<SessionList onSelectSession={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('3/5')).toBeDefined()
    })
    expect(screen.getByText('7/7')).toBeDefined()
    expect(screen.getByText('1/3')).toBeDefined()
  })

  it('shows active before completed (sorting)', async () => {
    globalThis.fetch = mockFetch()
    render(<SessionList onSelectSession={vi.fn()} />)
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
    globalThis.fetch = mockFetch()
    const onSelect = vi.fn()
    render(<SessionList onSelectSession={onSelect} />)
    await waitFor(() => {
      expect(screen.getByTestId('session-entry-s1')).toBeDefined()
    })
    fireEvent.click(screen.getByTestId('session-entry-s1'))
    expect(onSelect).toHaveBeenCalledWith('s1')
  })

  it('calls onCreateSession via empty state agent card', async () => {
    globalThis.fetch = mockFetch([])
    const onCreate = vi.fn()
    render(<SessionList onSelectSession={vi.fn()} onCreateSession={onCreate} />)
    await waitFor(() => {
      expect(screen.getByTestId('agent-card-basil')).toBeDefined()
    })
    fireEvent.click(screen.getByTestId('agent-card-basil'))
    expect(onCreate).toHaveBeenCalledWith('basil')
  })
})
