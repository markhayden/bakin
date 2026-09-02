// @vitest-environment jsdom
import { describe, expect, it, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { ActivityContext } from '@/context/activity-context'
import type { ActivityEvent } from '@/types'

const activityEvents: ActivityEvent[] = [
  {
    id: 'evt-1',
    ts: '2026-09-02T03:30:00.000Z',
    type: 'log',
    agent: 'patch',
    taskId: 'task-1',
    taskTitle: 'Revise Live Activity typography',
    message: 'This body copy should render at the compact metadata size.',
    eventName: 'tasks.log_progress',
  },
]

mock.module('@makinbakin/sdk/hooks', () => ({
  useAgent: (agent: string) => ({ id: agent, name: 'Patch' }),
  useContentStore: (selector: (state: { activityEvents: ActivityEvent[]; debug: boolean }) => unknown) => selector({ activityEvents, debug: false }),
}))

mock.module('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId, size }: { agentId: string; size?: string }) => <span data-testid="agent-avatar" data-agent={agentId} data-size={size} />,
}))

import { ActivityFeed } from '@/components/tasks/activity-feed'

describe('ActivityFeed typography', () => {
  it('renders Live Activity body text with the existing compact Text meta size', () => {
    render(
      <ActivityContext.Provider value={{ open: true, toggle: mock(), close: mock() }}>
        <ActivityFeed />
      </ActivityContext.Provider>,
    )

    const body = screen.getByText('This body copy should render at the compact metadata size.')
    expect(body.tagName).toBe('P')
    expect(body.getAttribute('data-slot')).toBe('text')
    expect(body.getAttribute('data-size')).toBe('meta')
    expect(body.className).toContain('var(--bakin-typography-size-meta)')
    expect(body.className).not.toContain('typography-size-body')

    const eventName = screen.getByText('tasks.log_progress')
    expect(eventName.getAttribute('data-size')).toBe('meta')
  })
})
