import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-workflow-gate-decision-${Date.now()}`)

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
  updateTask: mock(() => Promise.resolve()),
  readTaskboard: mock(() => ({
    columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] },
  })),
  getTask: mock(() => null),
  getTaskWithColumn: mock(() => null),
}))

mock.module('@bakin/workflows/lib/runtime', () => ({
  loadInstance: mock(() => null),
  listInstances: mock(() => []),
  approveGate: mock(() => ({ success: true })),
  rejectGate: mock(() => ({ success: true })),
}))
mock.module('@bakin/workflows/lib/parser', () => ({
  loadDefinition: mock(() => null),
}))
mock.module('@bakin/workflows/lib/trigger-dispatch', () => ({
  triggerDispatch: mock(),
}))
mock.module('@bakin/workflows/lib/search-sync', () => ({
  indexInstance: mock(async () => {}),
}))
mock.module('@bakin/workflows/lib/gate-audit', () => ({
  buildGateAuditPayload: mock(() => ({})),
  getGateDescription: mock(() => undefined),
}))
mock.module('@bakin/workflows/lib/notifications', () => ({
  resolveGateApproval: mock(async () => {}),
  sendGateDecisionSummary: mock(async () => {}),
}))
mock.module('@bakin/workflows/lib/gate-settings', () => ({
  activeGateSettings: () => ({
    approvalChannelAlerts: false,
    approvalChannel: 'approvals',
    requireRejectReason: true,
  }),
}))

const { gateRoutes } = await import('@bakin/workflows/lib/routes/gates')
const { createApprovalRecord } = await import('@bakin/workflows/lib/approval-store')

const pageRoute = gateRoutes.find(r => r.path === '/gates/:taskId/decision' && r.method === 'GET')!
const statusRoute = gateRoutes.find(r => r.path === '/gates/status' && r.method === 'GET')!
const ctx = {} as never

function pageRequest(query: string): Request {
  // The plugin catch-all merges path params into query params before dispatch.
  return new Request(`http://localhost:3737/api/plugins/workflows/gates/task-42/decision?taskId=task-42&${query}`)
}

function seedPendingRecord(
  approvalId = 'workflow-gate:task-42:review-gate:wf_abc123:t1',
  createdAt = '2026-04-11T10:00:00Z',
): void {
  createApprovalRecord({
    approvalId,
    owner: {
      workflowId: 'content-pipeline',
      runId: 'wf_abc123',
      taskId: 'task-42',
      stepId: 'review-gate',
    },
    request: {
      title: 'Gate: Review Draft',
      body: 'Review the draft before publishing',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'reject', label: 'Reject' },
      ],
    },
    createdAt,
  }, testDir)
}

describe('gate decision page', () => {
  it('classifies the gate-status poll as routine activity', () => {
    expect(statusRoute.activityClass).toBe('routine')
  })

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
    process.env.BAKIN_HOME = testDir
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
    delete process.env.BAKIN_HOME
  })

  it('resolves the pending approval from task + step when approvalId is omitted', async () => {
    seedPendingRecord()

    const res = await pageRoute.handler(pageRequest('stepId=review-gate'), ctx, { params: { taskId: 'task-42' } } as never)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('Gate: Review Draft')
    expect(html).toContain('Review the draft before publishing')
    // The form binds the POST to the exact record that was resolved.
    expect(html).toContain('workflow-gate:task-42:review-gate:wf_abc123:t1')
  })

  it('still honors explicit approvalId links', async () => {
    seedPendingRecord()

    const res = await pageRoute.handler(
      pageRequest(`stepId=review-gate&approvalId=${encodeURIComponent('workflow-gate:task-42:review-gate:wf_abc123:t1')}`),
      ctx,
      { params: { taskId: 'task-42' } } as never,
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Gate: Review Draft')
  })

  it('404s when no pending approval exists for the gate', async () => {
    const res = await pageRoute.handler(pageRequest('stepId=review-gate'), ctx, { params: { taskId: 'task-42' } } as never)
    expect(res.status).toBe(404)
  })

  it('resolves the newest pending record when several exist for the gate', async () => {
    seedPendingRecord('workflow-gate:task-42:review-gate:wf_old:t0', '2026-04-11T09:00:00Z')
    seedPendingRecord('workflow-gate:task-42:review-gate:wf_abc123:t2', '2026-04-11T11:00:00Z')

    const res = await pageRoute.handler(pageRequest('stepId=review-gate'), ctx, { params: { taskId: 'task-42' } } as never)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('workflow-gate:task-42:review-gate:wf_abc123:t2')
  })
})
