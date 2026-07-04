import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { PluginContext } from '@bakin/core/plugin-types'
import type { ApprovalResolveEvent, DurableApprovalRecord } from '@bakin/core/adapters/runtime'

const testDir = join(tmpdir(), `bakin-workflow-channel-approvals-${Date.now()}`)

const contentDirMock = {
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}
mock.module('../../../src/core/content-dir', () => contentDirMock)
mock.module('../../../packages/core/src/content-dir', () => contentDirMock)
mock.module('@/core/content-dir', () => contentDirMock)

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('@bakin/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

mock.module('@/core/task-store', () => ({
  createTask: mock(() => Promise.resolve({ id: 'mock-task' })),
  addTaskLog: mock(() => Promise.resolve()),
  moveTask: mock(() => Promise.resolve()),
  readTaskboard: mock(() => ({
    columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] },
  })),
  getTask: mock(() => null),
  getTaskWithColumn: mock(() => null),
}))

const approveGate = mock((..._args: unknown[]) => ({
  success: true,
  decision: { gateLabel: 'Review', requestedAt: '2026-04-11T10:00:00Z', decidedAt: '2026-04-11T10:05:00Z' },
}))
const rejectGate = mock((..._args: unknown[]) => ({
  success: true,
  decision: { gateLabel: 'Review', requestedAt: '2026-04-11T10:00:00Z', decidedAt: '2026-04-11T10:05:00Z' },
}))
mock.module('@bakin/workflows/lib/runtime', () => ({
  approveGate: (...args: unknown[]) => approveGate(...args),
  rejectGate: (...args: unknown[]) => rejectGate(...args),
  loadInstance: mock(() => null),
  saveInstance: mock(),
}))

const approvalRecord: DurableApprovalRecord = {
  approvalId: 'workflow-gate:task-42:review-gate',
  owner: {
    workflowId: 'content-pipeline',
    runId: 'wf_abc123',
    taskId: 'task-42',
    stepId: 'review-gate',
  },
  status: 'pending',
  request: {
    title: 'Gate: Review',
    body: 'Review the draft',
    options: [
      { id: 'approve', label: 'Approve' },
      { id: 'reject', label: 'Reject' },
    ],
    context: { requireRejectReason: true },
  },
  deliveries: [],
  createdAt: '2026-04-11T10:00:00Z',
  updatedAt: '2026-04-11T10:00:00Z',
}
mock.module('@bakin/workflows/lib/approval-store', () => ({
  getApprovalRecord: mock(() => approvalRecord),
  approvalRefFromRecord: (record: DurableApprovalRecord | null | undefined) =>
    record ? { approvalId: record.approvalId, deliveries: record.deliveries } : undefined,
}))

mock.module('@bakin/workflows/lib/approval-rehydration', () => ({
  rehydratePendingApprovals: mock(async () => ({
    pending: 0, reattached: 0, rerendered: 0, skipped: 0, failed: 0,
  })),
}))

mock.module('@bakin/workflows/lib/gate-settings', () => ({
  activeGateSettings: () => ({
    approvalChannelAlerts: false,
    approvalChannel: 'approvals',
    requireRejectReason: true,
    notifyOnGate: true,
    gateTimeout: 24,
    maxConcurrentSteps: 3,
  }),
}))

mock.module('@bakin/workflows/lib/search-sync', () => ({
  indexInstance: mock(async () => {}),
}))
mock.module('@bakin/workflows/lib/trigger-dispatch', () => ({
  triggerDispatch: mock(),
}))
mock.module('@bakin/workflows/lib/notifications', () => ({
  resolveGateApproval: mock(async () => {}),
  sendGateDecisionSummary: mock(async () => {}),
}))
mock.module('@bakin/workflows/lib/gate-audit', () => ({
  buildGateAuditPayload: mock(() => ({})),
  getGateDescription: mock(() => undefined),
}))

const { wireChannelApprovals } = await import('@bakin/workflows/lib/channel-approvals')

function makeCtx(capture: { handler?: (event: ApprovalResolveEvent) => Promise<void> | void }): PluginContext {
  return {
    runtime: {
      channels: {
        subscribeApprovalResponses: (handler: (event: ApprovalResolveEvent) => void) => {
          capture.handler = handler
          return () => {}
        },
      },
    },
    activity: {
      audit: mock(),
      log: mock(),
    },
  } as unknown as PluginContext
}

function rejectEvent(comment?: string): ApprovalResolveEvent {
  return {
    approvalId: 'workflow-gate:task-42:review-gate',
    channelId: 'discord:channel-1',
    response: {
      selectedOption: 'reject',
      respondedAt: '2026-04-11T10:05:00Z',
      actor: { type: 'human', id: 'owner-1', displayName: 'Owner' },
      ...(comment !== undefined ? { comment } : {}),
    },
  }
}

describe('workflow channel approvals', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
    process.env.BAKIN_HOME = testDir
    approveGate.mockClear()
    rejectGate.mockClear()
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
    delete process.env.BAKIN_HOME
  })

  it('rejects with a default reason when a channel reject carries no comment on a require-reason gate', async () => {
    const capture: { handler?: (event: ApprovalResolveEvent) => Promise<void> | void } = {}
    await wireChannelApprovals(makeCtx(capture))

    await capture.handler!(rejectEvent())

    expect(rejectGate).toHaveBeenCalledTimes(1)
    expect(rejectGate.mock.calls[0]).toEqual([
      'task-42',
      'review-gate',
      'Rejected via runtime channel (no reason provided)',
      { approver: { source: 'channel', id: 'owner-1', displayName: 'Owner' } },
    ])
  })

  it('uses the typed comment as the reject reason when provided', async () => {
    const capture: { handler?: (event: ApprovalResolveEvent) => Promise<void> | void } = {}
    await wireChannelApprovals(makeCtx(capture))

    await capture.handler!(rejectEvent('Needs a stronger hook'))

    expect(rejectGate).toHaveBeenCalledTimes(1)
    expect(rejectGate.mock.calls[0]?.[2]).toBe('Needs a stronger hook')
  })

  it('approves gates from channel approve responses', async () => {
    const capture: { handler?: (event: ApprovalResolveEvent) => Promise<void> | void } = {}
    await wireChannelApprovals(makeCtx(capture))

    await capture.handler!({
      approvalId: 'workflow-gate:task-42:review-gate',
      channelId: 'discord:channel-1',
      response: {
        selectedOption: 'approve',
        respondedAt: '2026-04-11T10:05:00Z',
        actor: { type: 'human', id: 'owner-1', displayName: 'Owner' },
      },
    })

    expect(approveGate).toHaveBeenCalledTimes(1)
    expect(rejectGate).not.toHaveBeenCalled()
  })
})
