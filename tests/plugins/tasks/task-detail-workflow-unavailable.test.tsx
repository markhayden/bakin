// @vitest-environment jsdom
/**
 * Honest drawer degradation (2026-09-21 review scare): when the workflow
 * instance fetch FAILS for a workflow task, the drawer must say so with a
 * retry — never silently render no approval surface. A 404 (workflow not
 * started) stays silent by design.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'
import { settleReact } from '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-wf-unavailable-${Date.now()}`)

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
  TEAM_VALUE_PREFIX: 'team:',
  isTeamValue: () => false,
  teamIdFromValue: () => '',
}))
mock.module('@makinbakin/sdk/slots', () => ({ Slot: () => null }))

import { usePluginEvent } from '../../../src/hooks/use-plugin-event'
mock.module('@makinbakin/sdk/hooks', () => ({
  useAgent: (agentId: string) => agentId ? { id: agentId, name: agentId } : null,
  toast: mock(),
  useJsonFetch: () => ({ data: null, loading: false, error: null, refresh: () => {} }),
  usePluginEvent,
}))

mock.module('@makinbakin/sdk/ui', () => ({
  Alert: ({ children }: { children?: React.ReactNode }) => <div role="status">{children}</div>,
  AlertTitle: ({ children }: { children?: React.ReactNode }) => <strong>{children}</strong>,
  AlertDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Badge: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Spinner: () => <span>…</span>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  DrawerSection: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => <section><h3>{title}</h3>{children}</section>,
  Field: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  FieldControl: ({ render: r }: { render?: React.ReactNode }) => <div>{r}</div>,
  FieldLabel: ({ children }: { children?: React.ReactNode }) => <label>{children}</label>,
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

const TASK_ID = 'task-unavail-1'
let instanceStatus: number | 'network-error' = 500
let instanceFetches = 0

function makeTask(): Task {
  return {
    id: TASK_ID,
    title: 'Review-column task',
    checked: false,
    agent: 'pixel',
    workflowId: 'image-generation',
    log: [],
  } as Task
}

beforeEach(() => {
  instanceFetches = 0
  instanceStatus = 500
  ;(globalThis as { fetch: typeof fetch }).fetch = (mock(async (url: string) => {
    if (String(url).includes(`/instances/${TASK_ID}`)) {
      instanceFetches += 1
      if (instanceStatus === 'network-error') throw new Error('connection refused')
      if (instanceStatus === 200) {
        return new Response(JSON.stringify({
          instance: {
            instanceId: 'wf_1',
            workflowId: 'image-generation',
            taskId: TASK_ID,
            currentStepId: 'prompt-gate',
            status: 'pending_approval',
            stepStates: { 'prompt-gate': { status: 'pending_approval' } },
          },
        }), { headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ error: 'boom' }), { status: instanceStatus as number })
    }
    return new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } })
  })) as unknown as typeof fetch
})

async function renderDrawer() {
  await act(async () => {
    await act(async () => {
      render(<TaskDetailDrawer task={makeTask()} columnId="review" open editing={false} onClose={() => {}} onEdit={() => {}} onCancelEdit={() => {}} />)
    })
  })
}

describe('workflow state unavailable notice', () => {
  it('a failed instance load surfaces the honest notice with a retry', async () => {
    instanceStatus = 500
    await renderDrawer()

    expect(screen.getByText('Workflow state unavailable')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Retry/ })).not.toBeNull()
  })

  it('a network error surfaces the notice too (server mid-restart)', async () => {
    instanceStatus = 'network-error'
    await renderDrawer()

    expect(screen.getByText('Workflow state unavailable')).not.toBeNull()
  })

  it('Retry recovers: notice clears once the instance loads', async () => {
    instanceStatus = 500
    await renderDrawer()
    expect(screen.getByText('Workflow state unavailable')).not.toBeNull()

    instanceStatus = 200
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    })
    await settleReact()

    expect(screen.queryByText('Workflow state unavailable')).toBeNull()
    expect(instanceFetches).toBeGreaterThanOrEqual(2)
  })

  it('404 (workflow not started) shows NO notice — absence is legitimate', async () => {
    instanceStatus = 404
    await renderDrawer()

    expect(screen.queryByText('Workflow state unavailable')).toBeNull()
  })
})
