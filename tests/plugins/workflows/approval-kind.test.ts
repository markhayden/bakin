/**
 * The `workflow-gate` approval kind (plan PR 2 T5): the engine records ONE
 * pending approval per gate through core; boot reconcile backfills records;
 * ownerState drives rehydration; decideGate approves/rejects through the
 * record (audits, dispatch kick, reject-reason rule); render posts the
 * context card + thread and routes the button card into the thread.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  taskStoreMock,
  taskServiceMock,
  resetRuntimeHarness,
  seedWorkflowFixtures,
} from './helpers/runtime-harness'

const testDir = join(tmpdir(), `bakin-test-workflow-approval-kind-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/task-store', () => taskStoreMock)
mock.module('@/core/task-store', () => taskStoreMock)
mock.module('../../../src/core/task-service', taskServiceMock)
mock.module('@/core/task-service', taskServiceMock)
mock.module('../../../src/core/audit', () => ({ appendAudit: mock() }))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => testDir,
  getOpenClawPath: (...parts: string[]) => join(testDir, ...parts),
  resetOpenClawHome: mock(),
}))

const approvalsSettings = { channelAlerts: false, channel: 'approvals', requireRejectReason: true }
const settingsMock = () => ({
  getSettings: () => ({ approvals: approvalsSettings, notifications: { channelAliases: { approvals: 'discord:123' } } }),
  resetSettingsCache: () => {},
})
mock.module('../../../src/core/settings', settingsMock)
mock.module('@/core/settings', settingsMock)

const broadcasts: Array<Record<string, unknown>> = []
mock.module('../../../src/core/sse', () => ({ broadcast: (d: Record<string, unknown>) => { broadcasts.push(d) } }))
mock.module('../../../src/core/channel-aliases', () => ({
  resolveRuntimeChannelRef: async (_runtime: unknown, channel: string) => ({ resolved: channel === 'approvals' ? 'discord:123' : channel }),
}))
const triggerDispatch = mock()
mock.module('@bakin/workflows/lib/trigger-dispatch', () => ({ triggerDispatch }))
const indexInstance = mock(async () => {})
mock.module('@bakin/workflows/lib/search-sync', () => ({ indexInstance, registerWorkflowSearch: mock() }))
// No app services: core never auto-renders at request time; render is driven
// directly below with explicit channel fakes.
mock.module('../../../src/core/app-services-store', () => ({ maybeGetAppServices: () => undefined, getAppServices: () => { throw new Error('no services') } }))

import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import type { RuntimeChannelSurface } from '@bakin/core/adapters/runtime/channels'
import { createApprovalRecord, deleteApprovalRecord, getApprovalRecord, listApprovalRecords } from '@bakin/core/approvals'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { clearApprovalKinds } from '../../../src/core/approvals/kinds'
import { ApprovalNotPendingError, ApprovalResolveError } from '../../../src/core/approvals/errors'
import { createInstance, completeStep, loadInstance, approveGate } from '@bakin/workflows/lib/runtime'
import { invalidateSkillCache } from '@bakin/workflows/lib/skill-loader'
import { buildGateApprovalId, setEventBus, setNotificationRuntime } from '@bakin/workflows/lib/notifications'
import { setWorkflowPluginContext } from '@bakin/workflows/lib/plugin-context'
import {
  CHANNEL_REJECT_DEFAULT_REASON,
  decideGate,
  ensurePendingGateApprovals,
  registerWorkflowGateApprovalKind,
  workflowGateApprovalKind,
} from '@bakin/workflows/lib/approval-kind'
import { waitUntil } from '../../helpers/wait'

const audit = mock()
const activityLog = mock()
const web = { source: 'web' as const, id: 'mark' }
const channelActor = { source: 'channel' as const, id: 'u-1', displayName: 'Owner' }

function reachGate(taskId: string, output: Record<string, unknown> = { text: 'hello' }) {
  createInstance(taskId, 'gate', testDir)
  const result = completeStep(taskId, 'write-copy', output, undefined, testDir)
  expect(result.success).toBe(true)
  const instance = loadInstance(taskId, testDir)!
  expect(instance.status).toBe('pending_approval')
  return instance
}

function pendingRecordFor(taskId: string) {
  const records = listApprovalRecords({ status: 'pending', taskIds: [taskId] })
  expect(records).toHaveLength(1)
  return records[0]!
}

function channelFakes(opts: { threads: boolean }) {
  const createApproval = mock(async () => ({ deliveries: [{ channelId: 'discord:123', ref: 'message:1', renderedAt: '2026-04-11T10:00:00Z' }] }))
  const deliverContent = mock(async (..._args: unknown[]) => ({ deliveries: [{ channelId: 'discord:123', ref: 'message:42', renderedAt: '2026-04-11T10:00:00Z' }] }))
  const createThread = mock(async (..._args: unknown[]) => ({ threadId: '777', channelRef: 'discord:channel:777' }))
  const editMessage = mock(async (..._args: unknown[]) => {})
  const sendNotification = mock(async () => ({ deliveries: [] }))
  const channels = {
    createApproval,
    deliverContent,
    sendNotification,
    resolveApproval: mock(async () => {}),
    list: mock(async () => []),
    ...(opts.threads ? { createThread, editMessage } : {}),
  } as unknown as RuntimeChannelSurface
  return { channels, createApproval, deliverContent, createThread, editMessage, sendNotification }
}

describe('workflow-gate approval kind', () => {
  beforeEach(() => {
    invalidateSkillCache()
    resetRuntimeHarness()
    seedWorkflowFixtures(testDir)
    clearApprovalKinds()
    registerWorkflowGateApprovalKind()
    broadcasts.length = 0
    audit.mockClear()
    activityLog.mockClear()
    triggerDispatch.mockClear()
    approvalsSettings.channelAlerts = false
    approvalsSettings.requireRejectReason = true
    setWorkflowPluginContext({ activity: { audit, log: activityLog } } as never)
    setNotificationRuntime({} as AgentRuntimeAdapter)
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    getHookRegistry().clearAll()
    setEventBus({ emit: () => {} } as never)
  })

  it('records ONE pending approval when the engine reaches a gate and announces it', () => {
    const instance = reachGate('t-1')
    const record = pendingRecordFor('t-1')
    const requestedAt = instance.stepStates['review-gate']!.requestedAt!
    expect(record.approvalId).toBe(buildGateApprovalId('t-1', 'review-gate', instance.instanceId, requestedAt))
    expect(record.owner).toEqual({ kind: 'workflow-gate', taskId: 't-1', workflowId: 'gate', runId: instance.instanceId, stepId: 'review-gate' })
    expect(record.request.title).toBe('Gate: Review')
    expect(record.request.options.map((o) => o.id)).toEqual(['approve', 'reject'])
    expect(String(record.request.context?.approvalUrl)).toContain('/api/plugins/workflows/gates/t-1/decision?stepId=review-gate')
    expect(record.request.context?.requireRejectReason).toBe(true)
    expect(broadcasts.filter((b) => b.event === 'approval.pending').map((b) => b.taskId)).toEqual(['t-1'])
  })

  it('ensurePendingGateApprovals is idempotent and backfills a waiting gate that lost its record', () => {
    reachGate('t-2')
    const { approvalId } = pendingRecordFor('t-2')
    expect(ensurePendingGateApprovals()).toEqual({ checked: 1, created: 0 })
    deleteApprovalRecord(approvalId)
    expect(ensurePendingGateApprovals()).toEqual({ checked: 1, created: 1 })
    expect(getApprovalRecord(approvalId)?.status).toBe('pending')
  })

  it('ownerState: live while waiting, orphaned once decided or re-run, unknown without an instance file', async () => {
    const instance = reachGate('t-3')
    const record = pendingRecordFor('t-3') as never
    expect(await workflowGateApprovalKind.ownerState(record)).toBe('live')

    const stale = createApprovalRecord({ approvalId: 'stale-run', owner: { kind: 'workflow-gate', taskId: 't-3', workflowId: 'gate', runId: 'older-run', stepId: 'review-gate' }, request: pendingRecordFor('t-3').request }) as never
    expect(await workflowGateApprovalKind.ownerState(stale)).toBe('orphaned')

    approveGate('t-3', 'review-gate', { contentDir: testDir })
    expect(loadInstance('t-3', testDir)!.currentStepId).toBe('publish')
    expect(await workflowGateApprovalKind.ownerState(record)).toBe('orphaned')

    const ghost = createApprovalRecord({ approvalId: 'ghost', owner: { kind: 'workflow-gate', taskId: 'ghost-task', workflowId: 'gate', runId: instance.instanceId, stepId: 'review-gate' }, request: getApprovalRecord('stale-run')!.request }) as never
    expect(await workflowGateApprovalKind.ownerState(ghost)).toBe('unknown')
  })

  it('approve through decideGate advances the gate, resolves the record, audits the actor source and kicks dispatch', async () => {
    reachGate('t-4')
    const resolved = await decideGate('t-4', 'review-gate', 'approve', web)
    expect(resolved.status).toBe('approved')
    expect(resolved.response?.actor).toEqual({ type: 'human', id: 'mark' })
    expect(loadInstance('t-4', testDir)!.currentStepId).toBe('publish')
    expect(audit.mock.calls[0]?.[0]).toBe('gate.approved')
    expect(audit.mock.calls[0]?.[1]).toBe('web')
    expect(audit.mock.calls[0]?.[2]).toMatchObject({ taskId: 't-4', stepId: 'review-gate', gateLabel: 'Review' })
    expect(triggerDispatch).toHaveBeenCalledTimes(1)
    expect(broadcasts.filter((b) => b.event === 'approval.resolved')).toHaveLength(1)
    expect(listApprovalRecords({ status: 'pending' })).toHaveLength(0)
  })

  it('a web reject without a reason is refused (400) while requireRejectReason is on; the gate and record stay pending', async () => {
    reachGate('t-5')
    const err = await decideGate('t-5', 'review-gate', 'reject', web).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApprovalResolveError)
    expect((err as ApprovalResolveError).status).toBe(400)
    expect(loadInstance('t-5', testDir)!.status).toBe('pending_approval')
    expect(pendingRecordFor('t-5').status).toBe('pending')
    expect(audit).not.toHaveBeenCalled()

    const resolved = await decideGate('t-5', 'review-gate', 'reject', web, 'Needs work')
    expect(resolved.status).toBe('rejected')
    expect(resolved.response?.comment).toBe('Needs work')
    const instance = loadInstance('t-5', testDir)!
    expect(instance.currentStepId).toBe('write-copy')
    expect(audit.mock.calls[0]?.[0]).toBe('gate.rejected')
    expect(audit.mock.calls[0]?.[2]).toMatchObject({ reason: 'Needs work' })
    expect(triggerDispatch).not.toHaveBeenCalled()
  })

  it('a channel reject with no (or a blank) comment records the default reason instead of refusing', async () => {
    reachGate('t-6')
    await decideGate('t-6', 'review-gate', 'reject', channelActor, '   ')
    expect(loadInstance('t-6', testDir)!.currentStepId).toBe('write-copy')
    expect(audit.mock.calls[0]?.[1]).toBe('channel')
    expect(audit.mock.calls[0]?.[2]).toMatchObject({ reason: CHANNEL_REJECT_DEFAULT_REASON })
  })

  it('web rejects without a reason fall back to a default when requireRejectReason is off', async () => {
    approvalsSettings.requireRejectReason = false
    reachGate('t-6b')
    const resolved = await decideGate('t-6b', 'review-gate', 'reject', web)
    expect(resolved.status).toBe('rejected')
    expect(loadInstance('t-6b', testDir)!.currentStepId).toBe('write-copy')
  })

  it('refuses a decision whose gate already moved on and leaves the record pending for rehydration to cancel', async () => {
    reachGate('t-7')
    approveGate('t-7', 'review-gate', { contentDir: testDir })
    const err = await decideGate('t-7', 'review-gate', 'approve', web).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApprovalResolveError)
    expect((err as ApprovalResolveError).status).toBe(400)
    expect(pendingRecordFor('t-7').status).toBe('pending')
  })

  it('decideGate with no pending record is a typed 400, never a throw into the route', async () => {
    const err = await decideGate('nobody', 'review-gate', 'approve', web).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApprovalResolveError)
    expect((err as ApprovalResolveError).status).toBe(400)
  })

  it('simultaneous web + channel decisions: one wins, the other is refused, the gate advances once', async () => {
    reachGate('t-8')
    const outcomes = await Promise.allSettled([
      decideGate('t-8', 'review-gate', 'approve', web),
      decideGate('t-8', 'review-gate', 'reject', channelActor, 'no'),
    ])
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    const refused = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult
    expect(refused.reason).toBeInstanceOf(ApprovalNotPendingError)
    expect(audit).toHaveBeenCalledTimes(1)
    expect(['publish', 'write-copy']).toContain(loadInstance('t-8', testDir)!.currentStepId)
  })

  it('render (threads): compact root card, full output in the thread, button card routed into the thread, context deliveries persisted first', async () => {
    reachGate('t-9')
    const record = pendingRecordFor('t-9')
    const rt = channelFakes({ threads: true })

    const deliveries = await workflowGateApprovalKind.render!(record as never, rt.channels, 'discord:123')

    const [rootCall] = rt.deliverContent.mock.calls[0] as unknown as [{ channels: string[]; content: { body: string; files?: unknown[] } }]
    expect(rootCall.channels).toEqual(['discord:123'])
    expect(rootCall.content.body).toContain('🚦 **Task Needs Review**\n\n**Review** — `gate`\nTask `t-9` | Step `review-gate`')
    expect(rootCall.content.body).toContain('_Full output & decision buttons in the thread ↓_')
    expect(rootCall.content.body).not.toContain('hello')
    expect(rootCall.content.body).toMatch(/\*\*\[Review & Approve in Bakin\]\(http.*\/gates\/t-9\/decision\?stepId=review-gate\)\*\* · \[View Task\]\(http.*\/tasks\?taskId=t-9\)/)
    expect(rt.createThread).toHaveBeenCalledWith({ channel: 'discord:123', messageRef: 'message:42', name: 'gate — Review' })
    const [threadCall] = rt.deliverContent.mock.calls[1] as unknown as [{ channels: string[]; content: { body: string } }]
    expect(threadCall.channels).toEqual(['discord:channel:777'])
    expect(threadCall.content.body).toContain('hello')
    const [approvalCall] = rt.createApproval.mock.calls[0] as unknown as [{ approvalId: string; channels: string[]; request: { context: { threadId?: string } } }]
    expect(approvalCall.approvalId).toBe(record.approvalId)
    expect(approvalCall.channels).toEqual(['discord:123'])
    expect(approvalCall.request.context.threadId).toBe('777')
    expect(deliveries.map((d) => d.ref)).toEqual(['message:42', 'thread:777', 'message:1'])
    // Persisted BEFORE the button card: a createApproval failure never leaves
    // the already-posted root card off the record (duplicate-card guard).
    expect(getApprovalRecord(record.approvalId)!.deliveries.map((d) => d.ref)).toEqual(['message:42', 'thread:777'])
  })

  it('render (flat): one message with header, labeled output, links and divider; a failed context post still creates the card', async () => {
    reachGate('t-10', { caption: 'Hello world', hashtags: ['#a', '#b'] })
    const record = pendingRecordFor('t-10')
    const rt = channelFakes({ threads: false })

    const deliveries = await workflowGateApprovalKind.render!(record as never, rt.channels, 'discord:123')
    expect(rt.deliverContent).toHaveBeenCalledTimes(1)
    const [call] = rt.deliverContent.mock.calls[0] as unknown as [{ content: { title: string; body: string; files?: unknown[] } }]
    expect(call.content.title).toBe('')
    expect(call.content.body).toContain('**Caption:** Hello world')
    expect(call.content.body).toContain('**Hashtags:** #a, #b')
    expect(call.content.body).toContain('─'.repeat(30))
    expect(call.content.files).toBeUndefined()
    const [approvalCall] = rt.createApproval.mock.calls[0] as unknown as [{ request: { context: { threadId?: string } } }]
    expect(approvalCall.request.context.threadId).toBeUndefined()
    expect(deliveries.map((d) => d.ref)).toEqual(['message:42', 'message:1'])

    rt.deliverContent.mockImplementationOnce(async () => { throw new Error('channel hiccup') })
    const again = await workflowGateApprovalKind.render!(record as never, rt.channels, 'discord:123')
    expect(again.map((d) => d.ref)).toEqual(['message:1'])
  })

  it('render attaches resolvable asset files from the prior output', async () => {
    getHookRegistry().register('assets.resolveServe', async () => ({ found: true, absPath: '/tmp/generated.png', mimeType: 'image/png' }))
    reachGate('t-11', { image: { assetId: 'asset-abc123' } })
    const rt = channelFakes({ threads: false })
    await workflowGateApprovalKind.render!(pendingRecordFor('t-11') as never, rt.channels, 'discord:123')
    const [call] = rt.deliverContent.mock.calls[0] as unknown as [{ content: { files?: unknown[] } }]
    expect(call.content.files).toEqual([{ name: 'asset-abc123', path: '/tmp/generated.png', contentType: 'image/png' }])
  })

  it('posts the decision receipt on the approvals channel only while channel alerts are on', async () => {
    reachGate('t-12')
    const rt = channelFakes({ threads: false })
    setNotificationRuntime({ channels: rt.channels } as unknown as AgentRuntimeAdapter)

    await decideGate('t-12', 'review-gate', 'approve', web)
    await Promise.resolve()
    expect(rt.sendNotification).not.toHaveBeenCalled()

    approvalsSettings.channelAlerts = true
    reachGate('t-13')
    await decideGate('t-13', 'review-gate', 'approve', web)
    await waitUntil(() => rt.sendNotification.mock.calls.length === 1, { label: 'decision receipt posted' })
    const [call] = rt.sendNotification.mock.calls[0] as unknown as [{ channels: string[]; notification: { severity: string; body: string } }]
    expect(call.channels).toEqual(['discord:123'])
    expect(call.notification.severity).toBe('success')
    expect(call.notification.body).toContain('✅ **Approval Gate: Review** — Approved')
  })
})
