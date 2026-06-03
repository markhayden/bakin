// @vitest-environment jsdom
import { describe, expect, it, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
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
