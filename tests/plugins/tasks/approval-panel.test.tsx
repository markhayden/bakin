// @vitest-environment jsdom
/**
 * ApprovalPanel (plan PR 2 T11): one renderer per approval kind over core
 * records — gate approve/reject with a typed reason, repair apply behind a
 * ConfirmDialog that names every frozen change, navigate open + dismiss —
 * plus the inline decision error, the failed-load retry and the loading row.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import '../../rtl-settle'

mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => <a href={to} {...rest}>{children}</a>,
}))
mock.module('@makinbakin/sdk/content', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div data-markdown="">{content}</div>,
}))

import { ApprovalPanel, type ApprovalPanelProps } from '../../../plugins/tasks/components/approval-panel'
import type { TaskApproval } from '../../../plugins/tasks/types'

afterEach(() => document.body.replaceChildren())

const base = { status: 'pending' as const, deliveries: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }
const gate: TaskApproval = {
  ...base,
  approvalId: 'gate-1',
  owner: { kind: 'workflow-gate', taskId: 't-1', workflowId: 'publish', runId: 'r1', stepId: 'review' },
  request: { title: 'Gate: Review the draft', body: 'Workflow publish has reached a gate.', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }], context: { requireRejectReason: true } },
}
const repair: TaskApproval = {
  ...base,
  approvalId: 'repair-1',
  owner: {
    kind: 'health-repair', taskId: 't-1', requestId: 'req-1', incidentIds: ['health:search:index-corrupt'],
    proposal: { reportId: 'rep-1', observationIds: ['health.search:index'], items: [{ actionId: 'search.rebuild', itemId: 'search.rebuild:rebuild', safety: 'destructive', changes: [{ kind: 'file', target: 'bakin_tasks_v3', action: 'delete', description: 'Drop and rebuild the search table.' }] }] },
  },
  request: { title: 'Repair: Search index is corrupt', body: 'Bakin Health proposes a repair.', options: [{ id: 'apply', label: 'Apply repair', variant: 'primary' }, { id: 'dismiss', label: 'Dismiss', variant: 'neutral' }] },
}
const navigate: TaskApproval = {
  ...base,
  approvalId: 'nav-1',
  owner: { kind: 'health-navigate', taskId: 't-1', requestId: 'req-2', incidentIds: ['health:runtime:auth-expired'], href: '/settings?tab=integrations' },
  request: { title: 'OpenAI auth expired', body: 'Renew the key.', options: [{ id: 'dismiss', label: 'Dismiss', variant: 'neutral' }] },
}

function renderPanel(overrides: Partial<ApprovalPanelProps> = {}) {
  const props: ApprovalPanelProps = {
    approvals: [], loading: false, failed: false, busyApprovalId: null, error: null,
    onResolve: mock(), onRetry: mock(),
    ...overrides,
  }
  render(<ApprovalPanel {...props} />)
  return props
}

describe('ApprovalPanel', () => {
  it('renders nothing with no approvals, a status row while loading, and a retry when the load failed', () => {
    const { container } = render(<ApprovalPanel approvals={[]} loading={false} failed={false} busyApprovalId={null} error={null} onResolve={mock()} onRetry={mock()} />)
    expect(container.innerHTML).toBe('')
    document.body.replaceChildren()

    renderPanel({ loading: true })
    expect(screen.getByRole('status').textContent).toContain('Checking for pending decisions')
    document.body.replaceChildren()

    const props = renderPanel({ failed: true, approvals: [gate] })
    expect(screen.getByText('Pending decisions could not load')).toBeTruthy()
    expect(screen.queryByText(/Approval required/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(props.onRetry).toHaveBeenCalledTimes(1)
  })

  it('workflow gate: approve resolves "approve"; reject needs a typed reason and sends it as the comment', () => {
    const props = renderPanel({ approvals: [gate], gate: { priorStepOutput: { caption: 'Hello world' }, outputLoading: false, outputUnavailable: false, fetchPriorOutput: mock() } })
    expect(screen.getByText('Approval required: Review the draft')).toBeTruthy()
    expect(screen.getByText('Hello world')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(props.onResolve).toHaveBeenCalledWith(gate, 'approve')

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const reason = screen.getByRole('textbox', { name: 'Rejection reason' })
    const reject = screen.getByRole('button', { name: 'Reject' })
    expect(reject.hasAttribute('disabled') || reject.getAttribute('aria-disabled') === 'true').toBe(true)
    fireEvent.change(reason, { target: { value: '  Needs work  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(props.onResolve).toHaveBeenCalledWith(gate, 'reject', 'Needs work')
  })

  it('health repair: Apply opens a danger confirmation naming every frozen change; confirming resolves "apply"; Dismiss resolves directly', async () => {
    const props = renderPanel({ approvals: [repair] })
    expect(screen.getByText('Repair: Search index is corrupt')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(props.onResolve).toHaveBeenCalledWith(repair, 'dismiss')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply repair' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Apply this repair?' })
    expect(within(dialog).getByRole('list', { name: 'Proposed changes' }).textContent).toContain('[destructive] delete file bakin_tasks_v3 — Drop and rebuild the search table.')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Apply repair' })) })
    expect(props.onResolve).toHaveBeenCalledWith(repair, 'apply')
  })

  it('health navigate: Open links to the owner href, Dismiss resolves "dismiss"', () => {
    const props = renderPanel({ approvals: [navigate] })
    expect(screen.getByText('OpenAI auth expired')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Open/ }).getAttribute('href')).toBe('/settings?tab=integrations')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(props.onResolve).toHaveBeenCalledWith(navigate, 'dismiss')
  })

  it('busy disables the decision being applied; an error shows inline on that approval only', () => {
    renderPanel({ approvals: [gate, repair], busyApprovalId: 'repair-1', error: { approvalId: 'repair-1', message: 'The proposed repair changed since this approval was requested; a fresh proposal is waiting on the task.' } })
    const applying = screen.getByRole('button', { name: 'Applying…' })
    expect(applying.hasAttribute('disabled') || applying.getAttribute('aria-disabled') === 'true').toBe(true)
    expect(screen.getAllByText('Decision not applied')).toHaveLength(1)
    const repairCard = screen.getByText('Repair: Search index is corrupt').closest('[data-approval-kind="health-repair"]')!
    expect(within(repairCard as HTMLElement).getByText(/fresh proposal is waiting/)).toBeTruthy()
    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve.hasAttribute('disabled')).toBe(false)
  })
})
