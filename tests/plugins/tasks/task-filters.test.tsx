// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

mock.module('@makinbakin/sdk/components', () => ({
  AgentFilter: () => <div data-testid="agent-filter" />,
  FacetFilter: () => <div data-testid="facet-filter" />,
}))

mock.module('@makinbakin/sdk/hooks', () => ({
  useAgentIds: () => [],
}))

import { TaskFilters } from '../../../plugins/tasks/components/task-filters'

afterEach(cleanup)

describe('task filters', () => {
  it('leaves scheduled-task hover feedback to the switch instead of highlighting the row', () => {
    render(
      <TaskFilters
        agentFilter="all"
        onAgentChange={() => {}}
        showScheduled
        onShowScheduledChange={() => {}}
      />,
    )

    const scheduledFilter = screen.getByText('Scheduled Tasks').closest('[data-slot="scheduled-tasks-filter"]')
    expect(scheduledFilter?.className).not.toContain('hover:bg-accent')
    expect(scheduledFilter?.className).not.toContain('hover:text-foreground')
    expect(screen.getByRole('switch', { name: /Hide scheduled tasks/ })).toBeTruthy()
  })
})
