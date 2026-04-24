// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-planning-layout-${Date.now()}`)

// Safety mock — keeps any accidental storage access off ~/.bakin/
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    assets: join(testDir, 'assets'),
    projects: join(testDir, 'projects'),
    heartbeats: join(testDir, 'heartbeats'),
    agents: join(testDir, 'agents'),
    settings: join(testDir, 'settings.json'),
  }),
}))

// Mock all child components to isolate layout testing
mock.module('../../../plugins/messaging/components/session-chat', () => ({
  SessionChat: ({ sessionId, agentId, isCompleted }: Record<string, unknown>) => (
    <div data-testid="session-chat" data-session={sessionId} data-agent={agentId} data-completed={String(isCompleted)}>
      Chat
    </div>
  ),
}))

mock.module('../../../plugins/messaging/components/review-panel', () => ({
  ReviewPanel: ({ sessionId, proposals }: Record<string, unknown>) => (
    <div data-testid="review-panel" data-session={sessionId}>
      Review ({(proposals as unknown[]).length} proposals)
    </div>
  ),
}))

mock.module('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} {...props}>{children as React.ReactNode}</button>
  ),
}))

mock.module('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}))

mock.module('@/components/ui/badge', () => ({
  Badge: ({ children }: Record<string, unknown>) => <span>{children as React.ReactNode}</span>,
}))

mock.module('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span data-testid={`avatar-${agentId}`} />,
}))

mock.module('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: Record<string, unknown>) => <div>{children as React.ReactNode}</div>,
  DropdownMenuTrigger: ({ children }: Record<string, unknown>) => <div>{children as React.ReactNode}</div>,
  DropdownMenuContent: ({ children }: Record<string, unknown>) => <div>{children as React.ReactNode}</div>,
  DropdownMenuItem: ({ children }: Record<string, unknown>) => <div>{children as React.ReactNode}</div>,
}))

mock.module('../../../plugins/messaging/components/delete-session-dialog', () => ({
  DeleteSessionDialog: () => null,
}))

import { PlanningLayout } from '../../../plugins/messaging/components/planning-layout'

afterEach(() => cleanup())

const mockSession = {
  id: 's1',
  agentId: 'basil',
  title: 'Test Plan',
  status: 'active',
  createdAt: '2026-04-07T00:00:00Z',
  updatedAt: '2026-04-07T00:00:00Z',
  messages: [],
  proposals: [
    {
      id: 'p1', messageId: 'm1', revision: 1, agentId: 'basil',
      title: 'Monday Recipe', scheduledAt: '2026-04-13T10:00:00Z',
      contentType: 'recipe', tone: 'energetic', brief: 'Test', status: 'proposed',
    },
  ],
}

beforeEach(() => {
  global.fetch = mock().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ session: mockSession }),
  }) as unknown as unknown as typeof fetch
})

describe('PlanningLayout', () => {
  it('renders session title and agent avatar after loading', async () => {
    render(<PlanningLayout sessionId="s1" />)
    await waitFor(() => {
      expect(screen.getByText('Test Plan')).toBeDefined()
    })
    expect(screen.getByTestId('avatar-basil')).toBeDefined()
  })

  it('renders both chat and review panel', async () => {
    render(<PlanningLayout sessionId="s1" />)
    await waitFor(() => {
      expect(screen.getByTestId('session-chat')).toBeDefined()
    })
    expect(screen.getByTestId('review-panel')).toBeDefined()
  })

  it('passes session data to chat component', async () => {
    render(<PlanningLayout sessionId="s1" />)
    await waitFor(() => {
      const chat = screen.getByTestId('session-chat')
      expect(chat.getAttribute('data-session')).toBe('s1')
      expect(chat.getAttribute('data-agent')).toBe('basil')
    })
  })

  it('passes proposals to review panel', async () => {
    render(<PlanningLayout sessionId="s1" />)
    await waitFor(() => {
      expect(screen.getByText('Review (1 proposals)')).toBeDefined()
    })
  })
})
