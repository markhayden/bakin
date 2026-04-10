// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'

// Mock all child components to isolate layout testing
vi.mock('../../../plugins/calendar/components/session-chat', () => ({
  SessionChat: ({ sessionId, agentId, isCompleted }: Record<string, unknown>) => (
    <div data-testid="session-chat" data-session={sessionId} data-agent={agentId} data-completed={String(isCompleted)}>
      Chat
    </div>
  ),
}))

vi.mock('../../../plugins/calendar/components/review-panel', () => ({
  ReviewPanel: ({ sessionId, proposals }: Record<string, unknown>) => (
    <div data-testid="review-panel" data-session={sessionId}>
      Review ({(proposals as unknown[]).length} proposals)
    </div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} {...props}>{children as React.ReactNode}</button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: Record<string, unknown>) => <span>{children as React.ReactNode}</span>,
}))

vi.mock('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span data-testid={`avatar-${agentId}`} />,
}))

vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span />,
  PanelRight: () => <span />,
  PanelRightClose: () => <span />,
  Pencil: () => <span />,
  Check: () => <span />,
  X: () => <span />,
  Calendar: () => <span />,
}))

vi.mock('../../../plugins/calendar/components/mini-calendar', () => ({
  MiniCalendar: () => <div data-testid="mini-calendar">Mini Calendar</div>,
}))

import { PlanningLayout } from '../../../plugins/calendar/components/planning-layout'

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
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ session: mockSession }),
  }) as unknown as typeof fetch
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
