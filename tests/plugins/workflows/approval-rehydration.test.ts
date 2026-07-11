import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
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

import { createMockRuntimeAdapter, mockChannels } from '@bakin/core/adapters/runtime/testing'
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

function rewriteRecord(
  approvalId: string,
  transform: (record: Record<string, unknown>) => Record<string, unknown>,
): void {
  const path = join(testDir, 'workflows', 'approvals', `${encodeURIComponent(approvalId)}.json`)
  const record = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  writeFileSync(path, JSON.stringify(transform(record)), 'utf-8')
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

    const runtime = createMockRuntimeAdapter({ channels: mockChannels() })
    const createApproval = mock(async () => ({ deliveries: [] }))
    runtime.channels!.createApproval = createApproval

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

    const runtime = createMockRuntimeAdapter({ channels: mockChannels() }) as AgentRuntimeAdapter
    const createApproval = mock(async () => ({ deliveries: [delivery] }))
    runtime.channels!.createApproval = createApproval

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

    const runtime = createMockRuntimeAdapter({ channels: mockChannels() }) as AgentRuntimeAdapter
    const createApproval = mock(async () => ({ deliveries: [delivery] }))
    runtime.channels!.createApproval = createApproval
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

  it('skips (never cancels) pending records whose instance file is missing', async () => {
    // Missing is ambiguous — a transiently unreadable instance at boot must
    // not permanently kill a live gate's buttons and decision link.
    createPendingRecord()

    const summary = await rehydratePendingApprovals({
      runtime: createMockRuntimeAdapter() as AgentRuntimeAdapter,
      channel: 'approvals',
      renderMissingDeliveries: true,
      contentDir: testDir,
    })

    expect(summary).toEqual(expect.objectContaining({ pending: 1, cancelled: 0, skipped: 1 }))
    expect(getApprovalRecord('workflow-gate:task-42:review-gate', testDir)?.status).toBe('pending')
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

  it('cancels pending records whose owner has no task/step identity', async () => {
    createApprovalRecord({
      approvalId: 'workflow-gate:malformed',
      owner: { workflowId: 'content-pipeline', runId: 'wf_abc123', stepId: 'review-gate' },
      request: { title: 'Gate', body: 'Review', options: [] },
      createdAt: '2026-04-11T10:00:00Z',
    }, testDir)

    const summary = await rehydratePendingApprovals({
      runtime: createMockRuntimeAdapter() as AgentRuntimeAdapter,
      channel: 'approvals',
      renderMissingDeliveries: true,
      contentDir: testDir,
    })

    expect(summary).toEqual(expect.objectContaining({ pending: 1, cancelled: 1 }))
    expect(getApprovalRecord('workflow-gate:malformed', testDir)).toEqual(expect.objectContaining({
      status: 'cancelled',
      response: expect.objectContaining({ comment: expect.stringContaining('orphaned') }),
    }))
  })

  it('cancels only the stale run\'s record when a workflow was re-run at the same gate', async () => {
    saveInstance(pendingInstance(), testDir) // live run: instanceId wf_abc123
    // Stale record from a previous run of the same task/step.
    createApprovalRecord({
      approvalId: 'workflow-gate:task-42:review-gate:wf_previous',
      owner: {
        workflowId: 'content-pipeline',
        runId: 'wf_previous',
        taskId: 'task-42',
        stepId: 'review-gate',
      },
      request: { title: 'Gate', body: 'Review', options: [] },
      createdAt: '2026-04-10T10:00:00Z',
    }, testDir)
    createPendingRecord() // current run's record (runId wf_abc123)
    updateApprovalDeliveries('workflow-gate:task-42:review-gate', [delivery], testDir)

    const summary = await rehydratePendingApprovals({
      runtime: createMockRuntimeAdapter() as AgentRuntimeAdapter,
      channel: 'approvals',
      renderMissingDeliveries: true,
      contentDir: testDir,
    })

    expect(summary).toEqual(expect.objectContaining({ pending: 2, cancelled: 1, reattached: 1 }))
    expect(getApprovalRecord('workflow-gate:task-42:review-gate:wf_previous', testDir)?.status).toBe('cancelled')
    expect(getApprovalRecord('workflow-gate:task-42:review-gate', testDir)?.status).toBe('pending')
  })

  it('counts every delivery-less record as failed but resolves the channel only once', async () => {
    mockChannelAliases = {}
    saveInstance(pendingInstance(), testDir)
    createPendingRecord()
    const second = pendingInstance()
    second.taskId = 'task-43'
    second.instanceId = 'wf_def456'
    saveInstance(second, testDir)
    createApprovalRecord({
      approvalId: 'workflow-gate:task-43:review-gate',
      owner: {
        workflowId: 'content-pipeline',
        runId: 'wf_def456',
        taskId: 'task-43',
        stepId: 'review-gate',
      },
      request: { title: 'Gate', body: 'Review', options: [] },
      createdAt: '2026-04-11T10:00:00Z',
    }, testDir)

    const logError = mock()
    const summary = await rehydratePendingApprovals({
      runtime: createMockRuntimeAdapter() as AgentRuntimeAdapter,
      channel: 'approvals',
      renderMissingDeliveries: true,
      contentDir: testDir,
      log: { error: logError },
    })

    expect(summary).toEqual(expect.objectContaining({ pending: 2, failed: 2 }))
    expect(logError).toHaveBeenCalledTimes(1)
  })

  it('prunes aged cancelled orphans and tolerates malformed timestamps', async () => {
    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString()

    // Orphan cancelled 31 days ago -> pruned (GC composes with orphan-cancel).
    createPendingRecord('workflow-gate:task-cancelled:review-gate')
    resolveApprovalRecord('workflow-gate:task-cancelled:review-gate', {
      selectedOption: 'reject',
      respondedAt: old,
      actor: { type: 'human', id: 'system' },
    }, testDir)
    rewriteRecord('workflow-gate:task-cancelled:review-gate', r => ({ ...r, status: 'cancelled', updatedAt: old }))

    // Old record with a garbage resolvedAt -> kept forever rather than mis-pruned.
    createPendingRecord('workflow-gate:task-garbage:review-gate')
    rewriteRecord('workflow-gate:task-garbage:review-gate', r => ({
      ...r, status: 'approved', resolvedAt: 'not-a-date', updatedAt: 'not-a-date',
    }))

    // No resolvedAt at all -> updatedAt fallback governs the age.
    createPendingRecord('workflow-gate:task-fallback:review-gate')
    rewriteRecord('workflow-gate:task-fallback:review-gate', r => {
      const { resolvedAt: _drop, ...rest } = r as Record<string, unknown> & { resolvedAt?: string }
      return { ...rest, status: 'approved', updatedAt: old }
    })

    const summary = await rehydratePendingApprovals({
      runtime: createMockRuntimeAdapter() as AgentRuntimeAdapter,
      channel: 'approvals',
      renderMissingDeliveries: false,
      contentDir: testDir,
    })

    expect(summary).toEqual(expect.objectContaining({ pruned: 2 }))
    expect(getApprovalRecord('workflow-gate:task-cancelled:review-gate', testDir)).toBeNull()
    expect(getApprovalRecord('workflow-gate:task-fallback:review-gate', testDir)).toBeNull()
    expect(getApprovalRecord('workflow-gate:task-garbage:review-gate', testDir)?.status).toBe('approved')
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
