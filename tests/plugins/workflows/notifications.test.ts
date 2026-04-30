import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
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
import { createApprovalRecord, getApprovalRecord } from '@bakin/workflows/lib/approval-store'
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
  const testHome = join(tmpdir(), `bakin-workflow-notifications-${Date.now()}`)
  const previousBakinHome = process.env.BAKIN_HOME

  const mockInstance: WorkflowInstance = {
    instanceId: 'wf_abc123',
    workflowId: 'content-pipeline',
    taskId: 'task-42',
    currentStepId: 'review-gate',
    status: 'pending_approval',
    stepStates: {
      'review-gate': {
        status: 'pending_approval',
        requestedAt: '2026-04-11T10:00:00Z',
      },
    },
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
    rmSync(testHome, { recursive: true, force: true })
    mkdirSync(testHome, { recursive: true })
    process.env.BAKIN_HOME = testHome
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

  afterAll(() => {
    rmSync(testHome, { recursive: true, force: true })
    if (previousBakinHome === undefined) {
      delete process.env.BAKIN_HOME
    } else {
      process.env.BAKIN_HOME = previousBakinHome
    }
  })

  it('builds parseable gate approval IDs', () => {
    const id = buildGateApprovalId('task:42', 'review gate', 'wf 1', '2026-04-11T10:00:00Z')
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

    const expectedApprovalId = buildGateApprovalId(
      'task-42',
      'review-gate',
      'wf_abc123',
      '2026-04-11T10:00:00Z',
    )
    expect(ref).toEqual({
      approvalId: expectedApprovalId,
      deliveries: [{ channelId: 'approvals', ref: 'message:1', renderedAt: '2026-04-11T10:00:00Z' }],
    })
    expect(getApprovalRecord(expectedApprovalId, testHome)).toEqual(expect.objectContaining({
      approvalId: expectedApprovalId,
      status: 'pending',
      deliveries: [{ channelId: 'approvals', ref: 'message:1', renderedAt: '2026-04-11T10:00:00Z' }],
      owner: {
        workflowId: 'content-pipeline',
        runId: 'wf_abc123',
        taskId: 'task-42',
        stepId: 'review-gate',
      },
    }))
    expect(createApproval).toHaveBeenCalledTimes(1)
    const [call] = createApproval.mock.calls[0] as unknown as [Record<string, unknown> & { request: { options: unknown; context: unknown } }]
    expect(call).toEqual(expect.objectContaining({
      approvalId: expectedApprovalId,
      channels: ['approvals'],
    }))
    expect(call.request.options).toEqual([
      { id: 'approve', label: 'Approve', variant: 'primary' },
      { id: 'reject', label: 'Reject', variant: 'destructive' },
    ])
    expect(call.request.context).toEqual(expect.objectContaining({
      approvalUrl: expect.stringContaining('/api/plugins/workflows/gates/task-42/decision'),
    }))
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
    createApprovalRecord({
      approvalId: 'workflow-gate:task-42:review-gate',
      owner: {
        workflowId: 'content-pipeline',
        runId: 'wf_abc123',
        taskId: 'task-42',
        stepId: 'review-gate',
      },
      request: {
        title: 'Gate: Review Draft',
        body: 'Review the draft',
        options: [{ id: 'reject', label: 'Reject' }],
      },
      createdAt: '2026-04-11T10:00:00Z',
    }, testHome)

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
    expect(getApprovalRecord('workflow-gate:task-42:review-gate', testHome)).toEqual(expect.objectContaining({
      status: 'rejected',
      resolvedAt: '2026-04-11T10:05:00Z',
      response: expect.objectContaining({
        selectedOption: 'reject',
        comment: 'Needs revisions',
      }),
    }))
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
      { source: 'web', id: 'main-operator', displayName: 'main-operator' },
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
