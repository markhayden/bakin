// @vitest-environment jsdom
import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
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
mock.module('@makinbakin/sdk/components', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span>{agentId}</span>,
}))

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
    render(
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
  })
})

describe('TaskCardContent sub-task indicator', () => {
  it('shows the child task short id and step suffix with the full id as tooltip', () => {
    render(
      <TaskCardContent
        task={makeTask()}
        columnId="inProgress"
        childTaskId="305a1dd6--generate-image"
      />,
    )

    const badge = screen.getByText('Sub-task in progress').parentElement!
    expect(badge.getAttribute('title')).toBe('305a1dd6--generate-image')
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

    const badge = screen.getByText('Sub-task in progress').parentElement!
    const childCard = screen.getByTestId('child-card')

    fireEvent.mouseEnter(badge)
    expect(childCard.classList.contains('ring-2')).toBe(true)
    expect(childCard.classList.contains('ring-cyan-400/60')).toBe(true)

    fireEvent.mouseLeave(badge)
    expect(childCard.classList.contains('ring-2')).toBe(false)
  })
})
