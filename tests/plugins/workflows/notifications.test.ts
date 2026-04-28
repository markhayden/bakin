import { describe, it, expect, beforeEach, mock } from 'bun:test'
import {
  buildGateApprovalId,
  parseGateApprovalId,
  resolveGateApproval,
  sendGateApprovalRequest,
  sendGateDecisionSummary,
  setGateNotificationSettings,
  setNotificationRuntime,
  type GateNotificationSettings,
} from '@bakin/workflows/lib/notifications'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import type { WorkflowInstance } from '@bakin/workflows/types'

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

describe('runtime gate notifications', () => {
  const mockInstance: WorkflowInstance = {
    instanceId: 'wf_abc123',
    workflowId: 'content-pipeline',
    taskId: 'task-42',
    currentStepId: 'review-gate',
    status: 'pending_approval',
    stepStates: {},
    history: [],
    createdAt: '2026-04-11T10:00:00Z',
    updatedAt: '2026-04-11T10:00:00Z',
  }

  const enabledSettings: GateNotificationSettings = {
    approvalChannelAlerts: true,
    approvalChannel: 'approvals',
    requireRejectReason: true,
  }

  const createApproval = mock(async () => ({
    deliveries: [{ channelId: 'approvals', ref: 'message:1', renderedAt: '2026-04-11T10:00:00Z' }],
  }))
  const resolveApproval = mock(async () => {})
  const sendNotification = mock(async () => ({ deliveries: [] }))

  beforeEach(() => {
    createApproval.mockClear()
    resolveApproval.mockClear()
    sendNotification.mockClear()
    const runtime = {
      channels: {
        createApproval,
        resolveApproval,
        sendNotification,
      },
    } as unknown as AgentRuntimeAdapter
    setNotificationRuntime(runtime)
    setGateNotificationSettings(enabledSettings)
  })

  it('builds parseable gate approval IDs', () => {
    const id = buildGateApprovalId('task:42', 'review gate')
    expect(parseGateApprovalId(id)).toEqual({ taskId: 'task:42', stepId: 'review gate' })
    expect(parseGateApprovalId('not-a-gate')).toBeNull()
  })

  it('creates approvals through the runtime channel adapter', async () => {
    const ref = await sendGateApprovalRequest(
      mockInstance,
      'review-gate',
      'Review Draft',
      { draft: { caption: 'Hello world' } },
      enabledSettings,
    )

    expect(ref).toEqual({
      approvalId: 'workflow-gate:task-42:review-gate',
      deliveries: [{ channelId: 'approvals', ref: 'message:1', renderedAt: '2026-04-11T10:00:00Z' }],
    })
    expect(createApproval).toHaveBeenCalledTimes(1)
    const [call] = createApproval.mock.calls[0] as unknown as [Record<string, unknown> & { request: { options: unknown } }]
    expect(call).toEqual(expect.objectContaining({
      approvalId: 'workflow-gate:task-42:review-gate',
      channels: ['approvals'],
    }))
    expect(call.request.options).toEqual([
      { id: 'approve', label: 'Approve', variant: 'primary' },
      { id: 'reject', label: 'Reject', variant: 'destructive' },
    ])
  })

  it('skips approval creation when channel alerts are disabled', async () => {
    const ref = await sendGateApprovalRequest(
      mockInstance,
      'review-gate',
      'Review Draft',
      undefined,
      { ...enabledSettings, approvalChannelAlerts: false },
    )

    expect(ref).toBeNull()
    expect(createApproval).not.toHaveBeenCalled()
  })

  it('resolves rendered approvals through the runtime channel adapter', async () => {
    await resolveGateApproval(
      {
        approvalId: 'workflow-gate:task-42:review-gate',
        deliveries: [{ channelId: 'approvals', ref: 'message:1', renderedAt: '2026-04-11T10:00:00Z' }],
      },
      'rejected',
      { source: 'channel', id: 'reviewer-1', displayName: 'Reviewer One' },
      '2026-04-11T10:05:00Z',
      'Needs revisions',
    )

    expect(resolveApproval).toHaveBeenCalledTimes(1)
    const [call] = resolveApproval.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(call).toEqual(expect.objectContaining({
      approvalId: 'workflow-gate:task-42:review-gate',
      response: expect.objectContaining({
        selectedOption: 'reject',
        comment: 'Needs revisions',
        actor: { type: 'human', id: 'reviewer-1', displayName: 'Reviewer One' },
      }),
    }))
  })

  it('sends decision summaries through the runtime channel adapter', async () => {
    await sendGateDecisionSummary(
      mockInstance,
      'review-gate',
      'Review Draft',
      'Approve the draft',
      'approved',
      { source: 'web', id: 'roscoe', displayName: 'roscoe' },
      '2026-04-11T10:00:00Z',
      '2026-04-11T10:05:00Z',
      undefined,
      enabledSettings,
    )

    expect(sendNotification).toHaveBeenCalledTimes(1)
    const [call] = sendNotification.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(call).toEqual(expect.objectContaining({
      channels: ['approvals'],
      notification: expect.objectContaining({
        severity: 'success',
        title: 'Gate Approved: Review Draft',
      }),
    }))
  })
})
