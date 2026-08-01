// @vitest-environment jsdom
/**
 * Pending-gate attention (pi-parity T3.1) — the pure rules (attention.ts)
 * and the ApprovalsBadgeProvider's observable effects: workflows nav badge
 * from /gates/pending, toast on gate-reached-while-elsewhere, badge clear
 * on resolution. Modeled on the chat attention harness.
 */
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-wf-attn-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
// Belt-and-suspenders (CLAUDE.md isolation rules): nothing in this client
// component graph should touch the task store; if a future import does, it
// gets an inert stub instead of ~/.bakin.
mock.module('@/core/task-store', () => ({}))

import { act, render, waitFor } from '@testing-library/react'
import '../../rtl-settle'

import { emitPluginEvent, useToastStore } from '@makinbakin/sdk/hooks'
import { getNavBadge } from '@makinbakin/sdk'

import { attentionForGate, gateBadge, gateUrl, viewingGateTask } from '../../../plugins/workflows/components/attention'
import { ApprovalsBadgeProvider } from '../../../plugins/workflows/components/approvals-badge-provider'

describe('gate attention (pure rules)', () => {
  const gate = { instanceId: 'i1', taskId: 't-42', workflowId: 'wf', stepId: 'g1', label: 'Publish pricing page' }

  it('badges the pending count with attention tone, hidden at zero', () => {
    expect(gateBadge(0)).toBeNull()
    expect(gateBadge(3)).toEqual({ count: 3, tone: 'attention' })
  })

  it('deep-links to the task detail where gates are decided', () => {
    expect(gateUrl(gate)).toBe('/tasks?taskId=t-42')
  })

  it('suppresses fanfare while viewing that task, notifies elsewhere', () => {
    expect(viewingGateTask(gate, { pathname: '/tasks', search: '?taskId=t-42' })).toBe(true)
    expect(attentionForGate(gate, { pathname: '/tasks', search: '?taskId=t-42' }).notify).toBe(false)
    expect(attentionForGate(gate, { pathname: '/tasks', search: '?taskId=other' }).notify).toBe(true)
    const elsewhere = attentionForGate(gate, { pathname: '/health', search: '' })
    expect(elsewhere.notify).toBe(true)
    expect(elsewhere.body).toContain('Publish pricing page')
    expect(elsewhere.url).toBe('/tasks?taskId=t-42')
  })
})

describe('ApprovalsBadgeProvider', () => {
  const realFetch = globalThis.fetch
  let pendingGates: Array<{ taskId: string; stepId: string; label?: string }> = []

  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    window.history.replaceState(null, '', '/health')
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/plugins/workflows/gates/pending')) {
        return Promise.resolve(new Response(JSON.stringify({ gates: pendingGates }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('seeds the workflows nav badge from the pending count', async () => {
    pendingGates = [{ taskId: 't1', stepId: 'g1' }, { taskId: 't2', stepId: 'g2' }]
    render(<ApprovalsBadgeProvider />)
    await waitFor(() => expect(getNavBadge('workflows')).toEqual({ count: 2, tone: 'attention' }))
  })

  it('gate_reached elsewhere: toast fires and the badge refreshes', async () => {
    pendingGates = []
    await act(async () => {
      render(<ApprovalsBadgeProvider />)
    })
    await waitFor(() => expect(getNavBadge('workflows')).toBeFalsy())

    pendingGates = [{ taskId: 't-42', stepId: 'g1', label: 'Publish' }]
    act(() => {
      emitPluginEvent({ event: 'workflow.gate_reached', instanceId: 'i1', taskId: 't-42', workflowId: 'wf', stepId: 'g1', label: 'Publish' })
    })
    await waitFor(() => expect(getNavBadge('workflows')).toEqual({ count: 1, tone: 'attention' }))
    expect(useToastStore.getState().toasts.length).toBe(1)
  })

  it('gate resolution clears the badge without a toast', async () => {
    pendingGates = [{ taskId: 't-42', stepId: 'g1' }]
    await act(async () => {
      render(<ApprovalsBadgeProvider />)
    })
    await waitFor(() => expect(getNavBadge('workflows')).toEqual({ count: 1, tone: 'attention' }))

    pendingGates = []
    act(() => {
      emitPluginEvent({ event: 'workflow.gate_approved', taskId: 't-42', stepId: 'g1' })
    })
    await waitFor(() => expect(getNavBadge('workflows')).toBeFalsy())
    expect(useToastStore.getState().toasts.length).toBe(0)
  })
})
