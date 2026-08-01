// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, render, screen } from '@testing-library/react'
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

mock.module('@makinbakin/sdk/components', () => ({
  BakinDrawer: ({ open, title, actions, children }: { open: boolean; title?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) => (
    open ? <div data-testid="drawer"><div>{title}</div><div>{actions}</div>{children}</div> : null
  ),
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
  AgentAvatar: ({ agentId }: { agentId: string }) => <span>{agentId}</span>,
  AgentSelect: () => <div />,
}))

mock.module('@makinbakin/sdk/slots', () => ({
  Slot: () => null,
}))

mock.module('@makinbakin/sdk/hooks', () => ({
  useAgent: (agentId: string) => agentId ? { id: agentId, name: agentId } : null,
  toast: mock(),
  // useTaskDetail migrated the workflow-definitions load to useJsonFetch (WS3);
  // stub the standard lifecycle shape (no data — this test drives no workflow).
  useJsonFetch: () => ({ data: null, loading: false, error: null, refresh: () => {} }),
  // Inert here — the gate-refresh behavior has its own focused test.
  usePluginEvent: () => {},
}))

mock.module('@makinbakin/sdk/ui', () => ({
  Button: ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
  Separator: () => <hr />,
  Select: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ children, placeholder }: { children?: React.ReactNode; placeholder?: string }) => <span>{children ?? placeholder}</span>,
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
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
    expect(screen.getByText('Technical details')).toBeDefined()
    expect(screen.getByText('No available auth profile for openai-codex')).toBeDefined()
  })
})
