import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-workflow-approval-rehydration-${Date.now()}`)
const previousBakinHome = process.env.BAKIN_HOME

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

let mockChannelAliases: Record<string, string> = {}
const settingsMock = {
  resetSettingsCache: () => {},
  getSettings: () => ({
    notifications: {
      channel: '',
      target: '',
      gateAlerts: true,
      channelAliases: mockChannelAliases,
    },
  }),
}
mock.module('@/core/settings', () => settingsMock)
mock.module('../../../src/core/settings', () => settingsMock)

mock.module('../../../src/core/audit', () => ({
  appendAudit: mock(),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@bakin/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
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

import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import { createApprovalRecord, getApprovalRecord, resolveApprovalRecord, updateApprovalDeliveries } from '@bakin/workflows/lib/approval-store'
import { rehydratePendingApprovals } from '@bakin/workflows/lib/approval-rehydration'
import { loadInstance, saveInstance } from '@bakin/workflows/lib/runtime'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import type { WorkflowInstance } from '@bakin/workflows/types'

const delivery = {
  channelId: 'approvals',
  ref: 'message:1',
  renderedAt: '2026-04-11T10:00:00Z',
}

function pendingInstance(): WorkflowInstance {
  return {
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
}

function createPendingRecord(approvalId = 'workflow-gate:task-42:review-gate') {
  return createApprovalRecord({
    approvalId,
    owner: {
      workflowId: 'content-pipeline',
      runId: 'wf_abc123',
      taskId: 'task-42',
      stepId: 'review-gate',
    },
    request: {
      title: 'Gate: Review Draft',
      body: 'Review the draft',
      options: [
        { id: 'approve', label: 'Approve', variant: 'primary' },
        { id: 'reject', label: 'Reject', variant: 'destructive' },
      ],
    },
    createdAt: '2026-04-11T10:00:00Z',
  }, testDir)
}

describe('workflow approval rehydration', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
    process.env.BAKIN_HOME = testDir
    mockChannelAliases = { approvals: 'discord:123' }
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
    if (previousBakinHome === undefined) {
      delete process.env.BAKIN_HOME
    } else {
      process.env.BAKIN_HOME = previousBakinHome
    }
  })

  it('reattaches stored delivery refs to a pending workflow gate', async () => {
    saveInstance(pendingInstance(), testDir)
    createPendingRecord()
    updateApprovalDeliveries('workflow-gate:task-42:review-gate', [delivery], testDir)

    const runtime = createMockRuntimeAdapter()
    const createApproval = mock(async () => ({ deliveries: [] }))
    runtime.channels.createApproval = createApproval

    const summary = await rehydratePendingApprovals({
      runtime,
      channel: 'approvals',
      renderMissingDeliveries: true,
      contentDir: testDir,
    })

    expect(summary).toEqual({
      pending: 1,
      reattached: 1,
      rerendered: 0,
      skipped: 0,
      failed: 0,
      pruned: 0,
      cancelled: 0,
    })
    expect(createApproval).not.toHaveBeenCalled()
    expect(loadInstance('task-42', testDir)?.stepStates['review-gate'].approvalRef).toEqual({
      approvalId: 'workflow-gate:task-42:review-gate',
      deliveries: [delivery],
    })
  })

  it('re-renders pending approvals that have no stored deliveries', async () => {
    saveInstance(pendingInstance(), testDir)
    createPendingRecord()

    const runtime = createMockRuntimeAdapter() as AgentRuntimeAdapter
    const createApproval = mock(async () => ({ deliveries: [delivery] }))
    runtime.channels.createApproval = createApproval

    const summary = await rehydratePendingApprovals({
      runtime,
      channel: 'approvals',
      renderMissingDeliveries: true,
      contentDir: testDir,
    })

    expect(summary).toEqual({
      pending: 1,
      reattached: 1,
      rerendered: 1,
      skipped: 0,
      failed: 0,
      pruned: 0,
      cancelled: 0,
    })
    expect(createApproval).toHaveBeenCalledWith(expect.objectContaining({
      approvalId: 'workflow-gate:task-42:review-gate',
      channels: ['discord:123'],
    }))
    expect(getApprovalRecord('workflow-gate:task-42:review-gate', testDir)?.deliveries).toEqual([delivery])
    expect(loadInstance('task-42', testDir)?.stepStates['review-gate'].approvalRef).toEqual({
      approvalId: 'workflow-gate:task-42:review-gate',
      deliveries: [delivery],
    })
  })

  it('counts re-renders as failed and logs an error when the channel cannot be resolved', async () => {
    mockChannelAliases = {}
    saveInstance(pendingInstance(), testDir)
    createPendingRecord()

    const runtime = createMockRuntimeAdapter() as AgentRuntimeAdapter
    const createApproval = mock(async () => ({ deliveries: [delivery] }))
    runtime.channels.createApproval = createApproval
    const logError = mock()

    const summary = await rehydratePendingApprovals({
      runtime,
      channel: 'approvals',
      renderMissingDeliveries: true,
      contentDir: testDir,
      log: { error: logError },
    })

    expect(summary).toEqual(expect.objectContaining({
      pending: 1,
      reattached: 0,
      rerendered: 0,
      failed: 1,
    }))
    expect(createApproval).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledTimes(1)
    expect(getApprovalRecord('workflow-gate:task-42:review-gate', testDir)?.status).toBe('pending')
  })

  it('does not resolve the channel when no record needs re-rendering', async () => {
    mockChannelAliases = {}
    saveInstance(pendingInstance(), testDir)
    createPendingRecord()
    updateApprovalDeliveries('workflow-gate:task-42:review-gate', [delivery], testDir)

    const logError = mock()
    const summary = await rehydratePendingApprovals({
      runtime: createMockRuntimeAdapter() as AgentRuntimeAdapter,
      channel: 'approvals',
      renderMissingDeliveries: true,
      contentDir: testDir,
      log: { error: logError },
    })

    expect(summary).toEqual(expect.objectContaining({ pending: 1, reattached: 1, failed: 0 }))
    expect(logError).not.toHaveBeenCalled()
  })

  it('cancels orphaned pending records whose instance moved on', async () => {
    const movedOn = pendingInstance()
    movedOn.currentStepId = 'publish'
    movedOn.status = 'in_progress'
    movedOn.stepStates['review-gate'] = { status: 'complete' }
    saveInstance(movedOn, testDir)
    createPendingRecord()

    const summary = await rehydratePendingApprovals({
      runtime: createMockRuntimeAdapter() as AgentRuntimeAdapter,
      channel: 'approvals',
      renderMissingDeliveries: true,
      contentDir: testDir,
    })

    expect(summary).toEqual(expect.objectContaining({ pending: 1, cancelled: 1, skipped: 0 }))
    expect(getApprovalRecord('workflow-gate:task-42:review-gate', testDir)?.status).toBe('cancelled')
  })

  it('cancels pending records with no matching workflow instance', async () => {
    createPendingRecord()

    const summary = await rehydratePendingApprovals({
      runtime: createMockRuntimeAdapter() as AgentRuntimeAdapter,
      channel: 'approvals',
      renderMissingDeliveries: true,
      contentDir: testDir,
    })

    expect(summary).toEqual(expect.objectContaining({ pending: 1, cancelled: 1 }))
    expect(getApprovalRecord('workflow-gate:task-42:review-gate', testDir)?.status).toBe('cancelled')
  })

  it('keeps live gates pending when deliveries cannot be rendered', async () => {
    saveInstance(pendingInstance(), testDir)
    createPendingRecord()

    const summary = await rehydratePendingApprovals({
      runtime: createMockRuntimeAdapter() as AgentRuntimeAdapter,
      channel: 'approvals',
      renderMissingDeliveries: false,
      contentDir: testDir,
    })

    expect(summary).toEqual(expect.objectContaining({ pending: 1, skipped: 1, cancelled: 0, pruned: 0 }))
    expect(getApprovalRecord('workflow-gate:task-42:review-gate', testDir)?.status).toBe('pending')
  })

  it('prunes resolved records older than 30 days and keeps younger or pending ones', async () => {
    const now = Date.now()
    const oldRespondedAt = new Date(now - 31 * 24 * 3600 * 1000).toISOString()
    const freshRespondedAt = new Date(now - 29 * 24 * 3600 * 1000).toISOString()
    const response = (respondedAt: string) => ({
      selectedOption: 'approve',
      respondedAt,
      actor: { type: 'human' as const, id: 'owner-1' },
    })

    createPendingRecord('workflow-gate:task-old:review-gate')
    resolveApprovalRecord('workflow-gate:task-old:review-gate', response(oldRespondedAt), testDir)
    createPendingRecord('workflow-gate:task-fresh:review-gate')
    resolveApprovalRecord('workflow-gate:task-fresh:review-gate', response(freshRespondedAt), testDir)
    // Ancient but still pending — must never be pruned.
    createApprovalRecord({
      approvalId: 'workflow-gate:task-42:review-gate',
      owner: {
        workflowId: 'content-pipeline',
        runId: 'wf_abc123',
        taskId: 'task-42',
        stepId: 'review-gate',
      },
      request: { title: 'Gate', body: 'Review', options: [] },
      createdAt: '2020-01-01T00:00:00Z',
    }, testDir)
    saveInstance(pendingInstance(), testDir)
    updateApprovalDeliveries('workflow-gate:task-42:review-gate', [delivery], testDir)

    const summary = await rehydratePendingApprovals({
      runtime: createMockRuntimeAdapter() as AgentRuntimeAdapter,
      channel: 'approvals',
      renderMissingDeliveries: false,
      contentDir: testDir,
    })

    expect(summary).toEqual(expect.objectContaining({ pruned: 1, pending: 1 }))
    expect(getApprovalRecord('workflow-gate:task-old:review-gate', testDir)).toBeNull()
    expect(getApprovalRecord('workflow-gate:task-fresh:review-gate', testDir)?.status).toBe('approved')
    expect(getApprovalRecord('workflow-gate:task-42:review-gate', testDir)?.status).toBe('pending')
  })
})
