// @vitest-environment jsdom
/**
 * useTaskApprovals (plan PR 2 T10): one fetch of the pending set indexed by
 * task, refreshed on approval/board events (never polled), a failed refresh
 * keeps the last good answer, and the card label collapses many into a count.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import '../../rtl-settle'
import { actRender } from '../../rtl-settle'
import { emitPluginEvent } from '../../../src/hooks/use-plugin-event'
import { approvalLabelFor, useTaskApprovals } from '../../../plugins/tasks/hooks/use-task-approvals'
import type { TaskApproval } from '../../../plugins/tasks/types'
import { waitUntil } from '../../helpers/wait'

function approval(taskId: string, approvalId: string, title = `Gate: ${taskId}`): TaskApproval {
  return {
    approvalId,
    status: 'pending',
    owner: { kind: 'workflow-gate', taskId, workflowId: 'publish', runId: 'r1', stepId: 'review' },
    request: { title, body: '', options: [{ id: 'approve', label: 'Approve' }] },
    deliveries: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }
}

let pending: TaskApproval[] = []
let failNext = false
const calls: string[] = []
const originalFetch = globalThis.fetch

beforeEach(() => {
  pending = []
  failNext = false
  calls.length = 0
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    calls.push(String(input))
    if (failNext) { failNext = false; return new Response('nope', { status: 500 }) }
    return Response.json({ approvals: pending })
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('useTaskApprovals', () => {
  it('loads every pending approval once and indexes it by task', async () => {
    pending = [approval('t-1', 'a'), approval('t-1', 'b'), approval('t-2', 'c')]
    const { result } = await actRender(() => renderHook(() => useTaskApprovals()))
    await waitUntil(() => !result.current.loading, { label: 'first load' })
    expect(calls).toEqual(['/api/approvals?status=pending'])
    expect(Object.keys(result.current.byTask).sort()).toEqual(['t-1', 't-2'])
    expect(result.current.byTask['t-1']!.map((a) => a.approvalId)).toEqual(['a', 'b'])
    expect(result.current.failed).toBe(false)
  })

  it('narrows to the given tasks for the detail drawer', async () => {
    pending = [approval('t-9', 'z')]
    const { result } = await actRender(() => renderHook(() => useTaskApprovals(['t-9'])))
    await waitUntil(() => !result.current.loading, { label: 'first load' })
    expect(calls).toEqual(['/api/approvals?status=pending&taskIds=t-9'])
    expect(result.current.byTask['t-9']).toHaveLength(1)
  })

  it('refreshes on approval and board events and a failed refresh keeps the last good answer', async () => {
    pending = [approval('t-1', 'a')]
    const { result } = await actRender(() => renderHook(() => useTaskApprovals()))
    await waitUntil(() => !result.current.loading, { label: 'first load' })

    // Each event's refresh lands state asynchronously: fire inside act and
    // let the fetch settle there, so the update is flushed when act exits.
    const fire = async (event: Record<string, unknown>) => {
      await act(async () => {
        emitPluginEvent(event as Parameters<typeof emitPluginEvent>[0])
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }

    pending = []
    await fire({ event: 'approval.resolved', approvalId: 'a', taskId: 't-1' })
    expect(Object.keys(result.current.byTask)).toHaveLength(0)

    pending = [approval('t-3', 'q')]
    await fire({ event: 'approval.pending', approvalId: 'q', taskId: 't-3' })
    expect(result.current.byTask['t-3']).toHaveLength(1)

    failNext = true
    await fire({ event: 'bakin.reconcile' })
    expect(result.current.failed).toBe(true)
    expect(result.current.byTask['t-3']).toHaveLength(1)

    await fire({ event: 'taskboard' })
    expect(result.current.failed).toBe(false)
    expect(calls).toHaveLength(5)
  })

  it('approvalLabelFor: one title, or a count', () => {
    expect(approvalLabelFor(undefined)).toBeUndefined()
    expect(approvalLabelFor([])).toBeUndefined()
    expect(approvalLabelFor([approval('t', 'a', 'Gate: Review')])).toBe('Gate: Review')
    expect(approvalLabelFor([approval('t', 'a'), approval('t', 'b')])).toBe('2 decisions waiting')
  })
})
