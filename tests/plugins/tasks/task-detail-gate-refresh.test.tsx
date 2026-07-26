// @vitest-environment jsdom
/**
 * Out-of-band gate decisions (Discord bridge buttons, the fallback page,
 * another tab) must refresh the open task drawer's workflow instance —
 * otherwise the pending-approval callout lingers until an unrelated action
 * refetches (#669 live-validation finding). Uses the REAL plugin-event bus.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, render } from '@testing-library/react'
import '../../rtl-settle'
import { settleReact } from '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-gate-refresh-${Date.now()}`)

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

// Real event bus, stubbed data hooks.
import { usePluginEvent, emitPluginEvent } from '../../../src/hooks/use-plugin-event'
mock.module('@makinbakin/sdk/hooks', () => ({
  useAgent: (agentId: string) => agentId ? { id: agentId, name: agentId } : null,
  toast: mock(),
  useJsonFetch: () => ({ data: null, loading: false, error: null, refresh: () => {} }),
  usePluginEvent,
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

const TASK_ID = 'task-gate-1'
let instanceFetches = 0

function makeTask(): Task {
  return {
    id: TASK_ID,
    title: 'Gated task',
    checked: false,
    agent: 'main',
    workflowId: 'messaging-blog-prep',
    log: [],
  } as Task
}

beforeEach(() => {
  instanceFetches = 0
  ;(globalThis as { fetch: typeof fetch }).fetch = (mock(async (url: string) => {
    if (String(url).includes(`/instances/${TASK_ID}`)) {
      instanceFetches += 1
      return new Response(JSON.stringify({
        instance: {
          instanceId: 'wf_1',
          workflowId: 'messaging-blog-prep',
          taskId: TASK_ID,
          currentStepId: 'review',
          status: instanceFetches === 1 ? 'pending_approval' : 'in_progress',
          stepStates: { review: { status: instanceFetches === 1 ? 'pending_approval' : 'in_progress' } },
        },
      }), { headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } })
  })) as unknown as typeof fetch
})

afterEach(() => {
  // rtl-settle unmounts; nothing else to clean.
})

describe('task drawer gate refresh on plugin events', () => {
  it('refetches the workflow instance when the open task gate resolves out-of-band', async () => {
    render(<TaskDetailDrawer task={makeTask()} columnId="review" open editing={false} onClose={() => {}} onEdit={() => {}} onCancelEdit={() => {}} />)
    await settleReact()
    expect(instanceFetches).toBe(1)

    await act(async () => {
      emitPluginEvent({ event: 'workflow.gate_approved', taskId: TASK_ID })
    })
    await settleReact()
    expect(instanceFetches).toBe(2)
  })

  it("ignores gate events for OTHER tasks", async () => {
    render(<TaskDetailDrawer task={makeTask()} columnId="review" open editing={false} onClose={() => {}} onEdit={() => {}} onCancelEdit={() => {}} />)
    await settleReact()
    expect(instanceFetches).toBe(1)

    await act(async () => {
      emitPluginEvent({ event: 'workflow.gate_approved', taskId: 'someone-else' })
    })
    await settleReact()
    expect(instanceFetches).toBe(1)
  })
})
