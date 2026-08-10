// @vitest-environment jsdom
import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-task-card-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@makinbakin/sdk/hooks', () => ({
  useAgent: (agentId: string) => agentId ? { name: 'Reviewer' } : undefined,
  useAgentDisplayName: () => undefined,
  useAgentColor: () => 'var(--bakin-color-signal-accent)',
}))
mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => <a href={to} {...props}>{children}</a>,
}))
// Defensive isolation (checker-required): the card component itself never
// touches the store, but nothing transitively imported may either.
mock.module('../../../src/core/task-store', () => ({}))
mock.module('@/core/task-store', () => ({}))

import { TaskCardContent } from '../../../plugins/tasks/components/task-card'
import type { Task } from '../../../plugins/tasks/types'

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task1234',
    title: 'Dispatch failure task',
    checked: false,
    ...overrides,
  }
}

describe('TaskCardContent dispatch failure context', () => {
  it('shows a compact provider-unavailable label from the latest dispatch failure log', () => {
    const { container } = render(
      <TaskCardContent
        task={makeTask({
          log: [
            { timestamp: '2026-06-03T00:00:00Z', author: 'system', message: 'older' },
            {
              timestamp: '2026-06-03T00:01:00Z',
              author: 'system',
              message: 'Dispatch failed',
              data: {
                dispatchFailure: {
                  category: 'model_provider_unavailable',
                  reasonCode: 'provider_cooldown',
                  summary: 'Dispatch failed: model provider unavailable',
                  specificReason: 'Provider in cooldown after timeout',
                  provider: 'openai-codex',
                  retryable: true,
                },
              },
            },
          ],
        })}
        columnId="todo"
      />,
    )

    expect(screen.getByText('Dispatch failed: model provider unavailable')).toBeDefined()
    expect(screen.queryByText('Provider in cooldown after timeout')).toBeNull()
    expect(container.querySelector('[data-slot="card"]')?.getAttribute('data-size')).toBe('sm')
    expect(container.querySelector('[data-status-badge="accent"]')).toBeTruthy()
    expect(screen.getByText('Dispatch failed: model provider unavailable').closest('[data-slot="kanban-card-signal"]')?.getAttribute('data-tone')).toBe('danger')
  })
})

describe('TaskCardContent hierarchy', () => {
  it('uses a filled state label, flush bold headline, quiet workflow metadata, and full-width approval feedback', () => {
    const onOpen = mock()
    const { container } = render(
      <TaskCardContent
        task={makeTask({
          title: 'Approve launch recommendation',
          workflowId: 'approval-copy',
        })}
        columnId="review"
        gateLabel="Approve final copy"
        onOpen={onOpen}
      />,
    )

    const state = screen.getByText('Review').closest('[data-status-badge]')
    expect(state?.getAttribute('data-variant')).toBe('solid')

    const title = screen.getByRole('button', { name: 'Approve launch recommendation' })
    expect(title.closest('h3')).toBeTruthy()
    expect(title.className).toContain('font-bakin-typography-weight-bold')
    fireEvent.click(title)
    expect(onOpen).toHaveBeenCalledTimes(1)

    const workflow = container.querySelector('[data-task-workflow]')
    expect(workflow).toBeTruthy()
    expect(workflow?.querySelector('[data-slot="badge"]')).toBeNull()

    const approval = screen.getByText('Needs approval').closest('[data-slot="kanban-card-signal"]')
    expect(approval?.getAttribute('data-tone')).toBe('attention')
    expect(screen.getByText('Approve final copy')).toBeTruthy()
  })

  it('shows current turn activity as a full-width feedback row', () => {
    render(
      <TaskCardContent
        task={makeTask()}
        columnId="inProgress"
        liveActivity={{ label: 'Writing launch copy…', ts: Date.now() }}
      />,
    )

    const signal = screen.getByText('Current turn').closest('[data-slot="kanban-card-signal"]')
    expect(signal?.getAttribute('data-tone')).toBe('accent')
    expect(screen.getByText('Writing launch copy…')).toBeTruthy()
  })
})

describe('TaskCardContent team assignment (#189)', () => {
  it('unresolved team task shows the team chip and no avatar', () => {
    render(<TaskCardContent task={makeTask({ team: 'development' })} columnId="todo" />)
    expect(screen.getByText('development')).toBeDefined()
  })

  it('resolved team task shows the agent avatar AND the team chip', () => {
    render(<TaskCardContent task={makeTask({ team: 'development', agent: 'reviewer' })} columnId="inProgress" />)
    expect(screen.getByRole('img', { name: 'Reviewer' })).toBeDefined()
    expect(screen.getByText('development')).toBeDefined()
  })

  it('direct-agent task renders no team chip', () => {
    render(<TaskCardContent task={makeTask({ agent: 'reviewer' })} columnId="todo" />)
    expect(screen.getByRole('img', { name: 'Reviewer' })).toBeDefined()
    expect(screen.queryByText('development')).toBeNull()
  })
})

describe('TaskCardContent sub-task indicator', () => {
  it('shows the child task short id and step suffix; no raw title attr (kit tooltip discipline)', () => {
    render(
      <TaskCardContent
        task={makeTask()}
        columnId="inProgress"
        childTaskId="305a1dd6--generate-image"
      />,
    )

    const signal = screen.getByText('Sub-task in progress').closest('[data-slot="kanban-card-signal"]')!
    expect(signal.getAttribute('title')).toBeNull()
    expect(screen.getByText('305A1D · generate-image')).toBeDefined()
  })

  it('outlines the linked child card while the badge is hovered', () => {
    render(
      <div>
        <div data-task-id="305a1dd6--generate-image">
          <div data-testid="child-card" className="rounded-xl border" />
        </div>
        <TaskCardContent
          task={makeTask()}
          columnId="inProgress"
          childTaskId="305a1dd6--generate-image"
        />
      </div>,
    )

    const signal = screen.getByText('Sub-task in progress').closest('[data-slot="kanban-card-signal"]')!
    const childCard = screen.getByTestId('child-card')

    fireEvent.mouseEnter(signal)
    expect(childCard.classList.contains('ring-2')).toBe(true)
    expect(childCard.classList.contains('ring-bakin-focus-ring')).toBe(true)

    fireEvent.mouseLeave(signal)
    expect(childCard.classList.contains('ring-2')).toBe(false)
  })
})
