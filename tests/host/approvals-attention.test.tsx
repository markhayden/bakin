// @vitest-environment jsdom
/**
 * Host approvals attention (plan PR 2 T4): the pure rules and the provider's
 * observable effects — toast on approval.pending while elsewhere, silence
 * while viewing that task, nothing on approval.resolved. Any kind rides it.
 */
import { describe, expect, it, mock, beforeEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-host-approvals-attn-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@/core/task-store', () => ({}))

import { act, render } from '@testing-library/react'
import '../rtl-settle'
import { emitPluginEvent, useToastStore } from '@makinbakin/sdk/hooks'
import { approvalUrl, attentionForApproval, viewingApprovalTask } from '../../packages/host/src/components/attention/approval-attention'
import { ApprovalsAttentionProvider } from '../../packages/host/src/components/attention/approvals-attention-provider'

describe('approval attention (pure rules)', () => {
  const repair = { approvalId: 'health-repair:r1', kind: 'health-repair', taskId: 't-42', title: 'Rebuild search table bakin_tasks' }

  it('deep-links to the task detail where approvals are decided', () => {
    expect(approvalUrl(repair)).toBe('/tasks?taskId=t-42')
  })

  it('suppresses fanfare while viewing that task, notifies elsewhere, titles by kind', () => {
    expect(viewingApprovalTask(repair, { pathname: '/tasks', search: '?taskId=t-42' })).toBe(true)
    expect(attentionForApproval(repair, { pathname: '/tasks', search: '?taskId=t-42' }).notify).toBe(false)
    expect(attentionForApproval(repair, { pathname: '/tasks', search: '?taskId=other' }).notify).toBe(true)
    const elsewhere = attentionForApproval(repair, { pathname: '/health', search: '' })
    expect(elsewhere).toEqual({ notify: true, title: 'Repair needs your approval', body: 'Rebuild search table bakin_tasks is waiting for your decision.', url: '/tasks?taskId=t-42' })
    expect(attentionForApproval({ ...repair, kind: 'workflow-gate' }, { pathname: '/', search: '' }).title).toBe('Approval needed')
    expect(attentionForApproval({ ...repair, kind: 'health-navigate', title: undefined }, { pathname: '/', search: '' }).body).toBe('A decision is waiting on the task board.')
  })
})

describe('ApprovalsAttentionProvider', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    window.history.replaceState(null, '', '/health')
  })

  it('toasts once for a pending approval of any kind while the user is elsewhere', async () => {
    await act(async () => { render(<ApprovalsAttentionProvider />) })
    act(() => {
      emitPluginEvent({ event: 'approval.pending', approvalId: 'health-repair:r1', kind: 'health-repair', taskId: 't-42', title: 'Rebuild search' })
    })
    expect(useToastStore.getState().toasts.length).toBe(1)
    act(() => {
      emitPluginEvent({ event: 'approval.pending', approvalId: 'gate:t-7', kind: 'workflow-gate', taskId: 't-7', title: 'Gate: review' })
    })
    expect(useToastStore.getState().toasts.length).toBe(2)
  })

  it('stays quiet on resolution and on a pending event without a task', async () => {
    // Viewing-the-task suppression is the pure rule above; the DOM shim does
    // not reflect history.replaceState into window.location, so it is not
    // re-proven through the provider here.
    await act(async () => { render(<ApprovalsAttentionProvider />) })
    act(() => {
      emitPluginEvent({ event: 'approval.resolved', approvalId: 'health-repair:r1', kind: 'health-repair', taskId: 't-42', status: 'approved' })
      emitPluginEvent({ event: 'approval.pending', approvalId: 'orphan', kind: 'health-repair' })
    })
    expect(useToastStore.getState().toasts.length).toBe(0)
  })
})
