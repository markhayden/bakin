// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-task-detail-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

mock.module('@makinbakin/sdk/slots', () => ({
  Slot: () => null,
}))

mock.module('../../../plugins/tasks/components/task-run-history', () => ({
  TaskRunHistory: () => null,
}))

mock.module('@makinbakin/sdk/hooks', () => ({
  useAgent: (agentId: string) => agentId ? { id: agentId, name: agentId } : null,
  useAgentList: () => [],
  useAgentStore: (selector: (state: { displaySettings: Record<string, never>; teams: never[] }) => unknown) => selector({
    displaySettings: {},
    teams: [],
  }),
  toast: mock(),
  // useTaskDetail migrated the workflow-definitions load to useJsonFetch (WS3);
  // stub the standard lifecycle shape (no data — this test drives no workflow).
  useJsonFetch: () => ({ data: null, loading: false, error: null, refresh: () => {} }),
  // Inert here — the gate-refresh behavior has its own focused test.
  usePluginEvent: () => {},
}))

import { TaskDetailDrawer } from '../../../plugins/tasks/components/task-detail-dialog'
import type { Task } from '../../../plugins/tasks/types'

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task1234',
    title: 'Provider failure task',
    checked: false,
    agent: 'main',
    log: [],
    ...overrides,
  }
}

beforeEach(() => {
  ;(globalThis as { fetch: typeof fetch }).fetch = (mock(async () => {
    throw new Error('workflow definitions unavailable in this test')
  })) as unknown as typeof fetch
})

describe('TaskDetailDrawer dispatch failure context', () => {
  it('renders specific provider failure details from structured log data', async () => {
    await act(async () => {
      render(
        <TaskDetailDrawer
          task={makeTask({
            log: [
              {
                timestamp: '2026-06-03T00:01:00Z',
                author: 'system',
                message: 'Dispatch failed',
                data: {
                  dispatchFailure: {
                    category: 'model_provider_unavailable',
                    reasonCode: 'auth_profile_unavailable',
                    summary: 'Dispatch failed: model provider unavailable',
                    specificReason: 'Auth profile unavailable',
                    provider: 'openai-codex',
                    model: 'openai-codex/gpt-5.5',
                    retryable: true,
                    rawError: 'No available auth profile for openai-codex',
                  },
                },
              },
            ],
          })}
          columnId="todo"
          open
          editing={false}
          onClose={() => {}}
          onEdit={() => {}}
          onCancelEdit={() => {}}
        />,
      )
    })

    expect(screen.getByText('Dispatch failed: model provider unavailable')).toBeDefined()
    expect(screen.getAllByText('Auth profile unavailable').length).toBeGreaterThan(0)
    expect(screen.getByText('openai-codex')).toBeDefined()
    expect(screen.getByText('openai-codex/gpt-5.5')).toBeDefined()
    expect(screen.getByText('Yes')).toBeDefined()
    fireEvent.click(screen.getByText('Technical details'))
    expect(screen.getByText('No available auth profile for openai-codex')).toBeDefined()
  })
})
