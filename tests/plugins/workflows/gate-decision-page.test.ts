/**
 * The durable gate decision page: GET resolves the gate's pending core record
 * (by task + step, or an explicit approvalId) and renders it; POST decides
 * through core's resolveApproval and maps typed refusals to HTML statuses.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { taskStoreMock, taskServiceMock } from './helpers/runtime-harness'

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

const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
mock.module('@bakin/core/logger', loggerMock)

// The page's decide path loads the real gate/engine chain; use the engine
// tests' store/service fakes so every export that chain imports exists.
mock.module('../../../src/core/task-store', () => taskStoreMock)
mock.module('@/core/task-store', () => taskStoreMock)
mock.module('../../../src/core/task-service', taskServiceMock)
mock.module('@/core/task-service', taskServiceMock)
mock.module('../../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({ approvals: { channelAlerts: false, channel: 'general', requireRejectReason: true } }),
  resetSettingsCache: () => {},
}))
mock.module('../../../src/core/sse', () => ({ broadcast: () => {} }))
mock.module('../../../src/core/app-services-store', () => ({ maybeGetAppServices: () => undefined, getAppServices: () => { throw new Error('no services') } }))

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('@bakin/workflows/lib/trigger-dispatch', () => ({ triggerDispatch: mock() }))
mock.module('@bakin/workflows/lib/search-sync', () => ({ indexInstance: mock(async () => {}) }))

const { gateRoutes } = await import('@bakin/workflows/lib/routes/gates')
const { createApprovalRecord, getApprovalRecord } = await import('@bakin/core/approvals')
const { registerApprovalKind, clearApprovalKinds } = await import('../../../src/core/approvals/kinds')
const { ApprovalResolveError } = await import('../../../src/core/approvals/errors')

const pageRoute = gateRoutes.find(r => r.path === '/gates/:taskId/decision' && r.method === 'GET')!
const actionRoute = gateRoutes.find(r => r.path === '/gates/:taskId/decision' && r.method === 'POST')!
const statusRoute = gateRoutes.find(r => r.path === '/gates/status' && r.method === 'GET')!
const ctx = {} as never
const routeParams = { params: { taskId: 'task-42' } } as never

function pageRequest(query: string): Request {
  // The plugin catch-all merges path params into query params before dispatch.
  return new Request(`http://localhost:3737/api/plugins/workflows/gates/task-42/decision?taskId=task-42&${query}`)
}

function postRequest(fields: Record<string, string>): Request {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  return new Request('http://localhost:3737/api/plugins/workflows/gates/task-42/decision?taskId=task-42', { method: 'POST', body: form })
}

function seedPendingRecord(
  approvalId = 'workflow-gate:task-42:review-gate:wf_abc123:t1',
  createdAt = '2026-04-11T10:00:00Z',
): void {
  createApprovalRecord({
    approvalId,
    owner: { kind: 'workflow-gate', workflowId: 'content-pipeline', runId: 'wf_abc123', taskId: 'task-42', stepId: 'review-gate' },
    request: {
      title: 'Gate: Review Draft',
      body: 'Review the draft before publishing',
      options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }],
    },
    createdAt,
  })
}

// A stand-in for the workflow-gate kind: the real handler's behavior is pinned
// in approval-kind.test.ts; here only the route ↔ core contract matters.
const onResolve = mock(async (_record: unknown, decision: { option: string; comment?: string }) => {
  if (decision.option === 'reject' && !decision.comment) throw new ApprovalResolveError('A reject reason is required', 400)
})

describe('gate decision page', () => {
  it('classifies the gate-status poll as routine activity', () => {
    expect(statusRoute.activityClass).toBe('routine')
  })

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
    process.env.BAKIN_HOME = testDir
    onResolve.mockClear()
    clearApprovalKinds()
    registerApprovalKind<'workflow-gate'>({ kind: 'workflow-gate', ownerState: async () => 'live', onResolve })
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
    delete process.env.BAKIN_HOME
  })

  it('resolves the pending approval from task + step when approvalId is omitted', async () => {
    seedPendingRecord()

    const res = await pageRoute.handler(pageRequest('stepId=review-gate'), ctx, routeParams)
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
      routeParams,
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Gate: Review Draft')
  })

  it('404s when no pending approval exists for the gate, or the id belongs to another gate', async () => {
    expect((await pageRoute.handler(pageRequest('stepId=review-gate'), ctx, routeParams)).status).toBe(404)
    seedPendingRecord()
    expect((await pageRoute.handler(pageRequest('stepId=other-gate'), ctx, routeParams)).status).toBe(404)
  })

  it('resolves the newest pending record when several exist for the gate', async () => {
    seedPendingRecord('workflow-gate:task-42:review-gate:wf_old:t0', '2026-04-11T09:00:00Z')
    seedPendingRecord('workflow-gate:task-42:review-gate:wf_abc123:t2', '2026-04-11T11:00:00Z')

    const res = await pageRoute.handler(pageRequest('stepId=review-gate'), ctx, routeParams)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('workflow-gate:task-42:review-gate:wf_abc123:t2')
  })

  it('POST approve decides through core with the web actor and renders the receipt page', async () => {
    seedPendingRecord()
    const res = await actionRoute.handler(postRequest({ stepId: 'review-gate', decision: 'approve' }), ctx, routeParams)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Gate Approved')
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve.mock.calls[0]?.[1]).toMatchObject({ option: 'approve', actor: { source: 'web' } })
    const record = getApprovalRecord('workflow-gate:task-42:review-gate:wf_abc123:t1')!
    expect(record.status).toBe('approved')
    expect(record.response?.actor.type).toBe('human')
  })

  it('POST reject passes the typed reason as the decision comment', async () => {
    seedPendingRecord()
    const res = await actionRoute.handler(postRequest({ stepId: 'review-gate', decision: 'reject', reason: '  Needs work  ' }), ctx, routeParams)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Gate Rejected')
    expect(onResolve.mock.calls[0]?.[1]).toMatchObject({ option: 'reject', comment: 'Needs work' })
    expect(getApprovalRecord('workflow-gate:task-42:review-gate:wf_abc123:t1')?.status).toBe('rejected')
  })

  it('POST maps a handler refusal to its status and leaves the record pending', async () => {
    seedPendingRecord()
    const res = await actionRoute.handler(postRequest({ stepId: 'review-gate', decision: 'reject' }), ctx, routeParams)
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('A reject reason is required')
    expect(getApprovalRecord('workflow-gate:task-42:review-gate:wf_abc123:t1')?.status).toBe('pending')
  })

  it('POST decides EXACTLY the submitted record, never the newest pending one for the gate', async () => {
    seedPendingRecord('workflow-gate:task-42:review-gate:wf_old:t0', '2026-04-11T09:00:00Z')
    seedPendingRecord('workflow-gate:task-42:review-gate:wf_abc123:t2', '2026-04-11T11:00:00Z')
    const res = await actionRoute.handler(postRequest({ stepId: 'review-gate', decision: 'approve', approvalId: 'workflow-gate:task-42:review-gate:wf_old:t0' }), ctx, routeParams)
    expect(res.status).toBe(200)
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect((onResolve.mock.calls[0]?.[0] as { approvalId: string }).approvalId).toBe('workflow-gate:task-42:review-gate:wf_old:t0')
    expect(getApprovalRecord('workflow-gate:task-42:review-gate:wf_old:t0')?.status).toBe('approved')
    expect(getApprovalRecord('workflow-gate:task-42:review-gate:wf_abc123:t2')?.status).toBe('pending')
  })

  it('POST on a decided record says so instead of deciding again; bad decisions are 400; missing records 404', async () => {
    seedPendingRecord()
    await actionRoute.handler(postRequest({ stepId: 'review-gate', decision: 'approve' }), ctx, routeParams)
    const again = await actionRoute.handler(postRequest({ stepId: 'review-gate', decision: 'reject', reason: 'late', approvalId: 'workflow-gate:task-42:review-gate:wf_abc123:t1' }), ctx, routeParams)
    expect(await again.text()).toContain('Approval Already Decided')
    expect(onResolve).toHaveBeenCalledTimes(1)

    expect((await actionRoute.handler(postRequest({ stepId: 'review-gate', decision: 'maybe' }), ctx, routeParams)).status).toBe(400)
    expect((await actionRoute.handler(postRequest({ stepId: 'other-gate', decision: 'approve' }), ctx, routeParams)).status).toBe(404)
  })
})
