/**
 * Workflow gate notifications: the approval request a gate records (through
 * core), the rich channel context message (flat + threaded), and the decision
 * receipt. Rendering a whole gate (context → card) is the kind's job and is
 * covered in approval-kind.test.ts.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = join(tmpdir(), `bakin-workflow-notifications-${Date.now()}`)

const contentDirMock = {
  getContentDir: () => testHome,
  getBakinPaths: () => ({ db: join(testHome, 'bakin.db') }),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}
mock.module('../../../src/core/content-dir', () => contentDirMock)
mock.module('../../../packages/core/src/content-dir', () => contentDirMock)
mock.module('@/core/content-dir', () => contentDirMock)

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

const logError = mock()
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: logError, debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

let mockChannelAliases: Record<string, string> = {}
const approvals = { channelAlerts: true, channel: 'approvals', requireRejectReason: true }
const settingsMock = {
  resetSettingsCache: () => {},
  getSettings: () => ({
    approvals,
    notifications: { channel: '', target: '', gateAlerts: true, channelAliases: mockChannelAliases },
  }),
}
mock.module('@/core/settings', () => settingsMock)
mock.module('../../../src/core/settings', () => settingsMock)

const broadcasts: Array<Record<string, unknown>> = []
mock.module('../../../src/core/sse', () => ({ broadcast: (d: Record<string, unknown>) => { broadcasts.push(d) } }))
mock.module('../../../src/core/app-services-store', () => ({ maybeGetAppServices: () => undefined, getAppServices: () => { throw new Error('no services') } }))

let mockAssetResolution: { found?: boolean; absPath?: string; mimeType?: string } | null = null
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: async (name: string) => {
      if (name === 'assets.resolveServe' && mockAssetResolution) return mockAssetResolution
      throw new Error(`no hook: ${name}`)
    },
  }),
}))

import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import type { RuntimeChannelSurface } from '@bakin/core/adapters/runtime/channels'
import type { WorkflowInstance } from '@bakin/workflows/types'
import { getApprovalRecord, listApprovalRecords } from '@bakin/core/approvals'

// Dynamic imports so the mock.module overlays above apply before the modules
// capture their logger/settings references at evaluation time.
const {
  buildGateApprovalId,
  buildGateApprovalRequest,
  requestGateApproval,
  sendGateContextMessage,
  sendGateDecisionSummary,
  setNotificationRuntime,
} = await import('@bakin/workflows/lib/notifications')

describe('workflow gate notifications', () => {
  const previousBakinHome = process.env.BAKIN_HOME

  const mockInstance: WorkflowInstance = {
    instanceId: 'wf_abc123',
    workflowId: 'content-pipeline',
    taskId: 'task-42',
    currentStepId: 'review-gate',
    status: 'pending_approval',
    stepStates: {
      'review-gate': { status: 'pending_approval', requestedAt: '2026-04-11T10:00:00Z' },
    },
    history: [],
    createdAt: '2026-04-11T10:00:00Z',
    updatedAt: '2026-04-11T10:00:00Z',
  }

  const sendNotification = mock(async () => ({ deliveries: [] }))
  const deliverContent = mock(async (..._args: unknown[]) => ({ deliveries: [] }))
  const listChannels = mock(async () => [] as Array<{ id: string }>)

  function flatChannels(): RuntimeChannelSurface {
    return { sendNotification, deliverContent, list: listChannels } as unknown as RuntimeChannelSurface
  }

  function threadedChannels() {
    const createThread = mock(async (..._args: unknown[]) => ({ threadId: '777', channelRef: 'discord:channel:777' }))
    const editMessage = mock(async (..._args: unknown[]) => {})
    const threadedDeliver = mock(async (..._args: unknown[]) => ({
      deliveries: [{ channelId: 'discord:123', ref: 'message:42', renderedAt: '2026-04-11T10:00:00Z' }],
    }))
    const channels = { sendNotification, deliverContent: threadedDeliver, list: listChannels, createThread, editMessage } as unknown as RuntimeChannelSurface
    return { channels, createThread, editMessage, deliverContent: threadedDeliver }
  }

  beforeEach(() => {
    rmSync(testHome, { recursive: true, force: true })
    mkdirSync(testHome, { recursive: true })
    process.env.BAKIN_HOME = testHome
    mockChannelAliases = { approvals: 'discord:123' }
    approvals.channelAlerts = true
    sendNotification.mockClear()
    deliverContent.mockClear()
    deliverContent.mockImplementation(async (..._args: unknown[]) => ({ deliveries: [] }))
    listChannels.mockClear()
    logError.mockClear()
    broadcasts.length = 0
    mockAssetResolution = null
    setNotificationRuntime({ channels: flatChannels() } as unknown as AgentRuntimeAdapter)
  })

  afterAll(() => {
    rmSync(testHome, { recursive: true, force: true })
    if (previousBakinHome === undefined) delete process.env.BAKIN_HOME
    else process.env.BAKIN_HOME = previousBakinHome
  })

  it('builds deterministic, URL-safe gate approval ids from task + step + run + requestedAt', () => {
    expect(buildGateApprovalId('task:42', 'review gate', 'wf 1', '2026-04-11T10:00:00Z'))
      .toBe('workflow-gate:task%3A42:review%20gate:wf%201:2026-04-11T10%3A00%3A00Z')
  })

  it('builds the gate approval request: title, rendered prior output, approve/reject options, short decision link', () => {
    const request = buildGateApprovalRequest(mockInstance, 'review-gate', 'Review Draft', { draft: { caption: 'Hello world' } })
    expect(request.title).toBe('Gate: Review Draft')
    expect(request.body).toContain('Workflow content-pipeline has reached a gate and needs approval.')
    expect(request.body).toContain('Hello world')
    expect(request.options).toEqual([
      { id: 'approve', label: 'Approve', variant: 'primary' },
      { id: 'reject', label: 'Reject', variant: 'destructive' },
    ])
    const context = request.context as { approvalUrl: string; requireRejectReason: boolean; taskId: string }
    expect(context.taskId).toBe('task-42')
    expect(context.requireRejectReason).toBe(true)
    expect(context.approvalUrl).toContain('/api/plugins/workflows/gates/task-42/decision?stepId=review-gate')
    expect(context.approvalUrl).not.toContain('approvalId')
  })

  it('requestGateApproval records ONE typed pending approval through core and announces it; re-requesting is idempotent', () => {
    const first = requestGateApproval(mockInstance, 'review-gate', 'Review Draft', undefined)
    const expectedId = buildGateApprovalId('task-42', 'review-gate', 'wf_abc123', '2026-04-11T10:00:00Z')
    expect(first.approvalId).toBe(expectedId)
    expect(first.owner).toEqual({ kind: 'workflow-gate', taskId: 'task-42', workflowId: 'content-pipeline', runId: 'wf_abc123', stepId: 'review-gate' })
    expect(first.createdAt).toBe('2026-04-11T10:00:00Z')
    expect(broadcasts.filter((b) => b.event === 'approval.pending')).toHaveLength(1)

    requestGateApproval(mockInstance, 'review-gate', 'Review Draft', undefined)
    expect(listApprovalRecords({ status: 'pending' })).toHaveLength(1)
    expect(getApprovalRecord(expectedId)?.status).toBe('pending')
  })

  describe('context message', () => {
    it('flat: header, labeled output, links to the decision page and the task, divider, no files', async () => {
      const result = await sendGateContextMessage(flatChannels(), mockInstance, 'review-gate', 'Review Draft', { draft: { caption: 'Hello world' } }, 'discord:123', undefined)
      expect(result).toEqual({ deliveries: [] })
      const [call] = deliverContent.mock.calls[0] as unknown as [{ channels: string[]; content: { title: string; body: string; files?: unknown[] } }]
      expect(call.channels).toEqual(['discord:123'])
      // Header lives in the body — a title would force a blank line before it.
      expect(call.content.title).toBe('')
      const body = call.content.body
      expect(body).toContain('🚦 **Task Needs Review**\n\n**Review Draft** — `content-pipeline`\nTask `task-42` | Step `review-gate`')
      expect(body).toContain('Hello world')
      // The task link must target /tasks — the `/` route redirects to /tasks and
      // DROPS the search string, so `/?taskId=` never opened the task.
      expect(body).toMatch(/\*\*\[Review & Approve in Bakin\]\(http.*\/gates\/task-42\/decision\?stepId=review-gate\)\*\* · \[View Task\]\(http.*\/tasks\?taskId=task-42\)/)
      expect(body).toContain('─'.repeat(30))
      expect(call.content.files).toBeUndefined()
    })

    it('renders prior output as labeled fields instead of a JSON blob', async () => {
      await sendGateContextMessage(flatChannels(), mockInstance, 'review-gate', 'Review Draft', {
        caption: 'Testing automation turns the slow, repetitive parts of quality work into fast feedback for the whole team.',
        targetPlatform: 'LinkedIn',
        hashtags: ['#TestingAutomation', '#DevOps'],
        image_brief: { mood: 'calm', palette: 'warm pastels' },
      }, 'discord:123', undefined)
      const [call] = deliverContent.mock.calls[0] as unknown as [{ content: { body: string } }]
      const body = call.content.body
      expect(body).toContain('**Details:**')
      expect(body).toContain('**Caption:**')
      expect(body).toContain('**Target platform:** LinkedIn')
      expect(body).toContain('**Hashtags:** #TestingAutomation, #DevOps')
      expect(body).toContain('**Image brief:**')
      expect(body).toContain('**Mood:** calm')
      expect(body).not.toContain('{')
      expect(body).not.toContain('"caption"')
    })

    it('attaches resolvable asset files from prior output', async () => {
      mockAssetResolution = { found: true, absPath: '/tmp/generated.png', mimeType: 'image/png' }
      await sendGateContextMessage(flatChannels(), mockInstance, 'review-gate', 'Review Draft', { image: { assetId: 'asset-abc123' } }, 'discord:123', undefined)
      const [call] = deliverContent.mock.calls[0] as unknown as [{ content: { files?: unknown[] } }]
      expect(call.content.files).toEqual([{ name: 'asset-abc123', path: '/tmp/generated.png', contentType: 'image/png' }])
    })

    it('returns null (never throws) when the channel post fails', async () => {
      deliverContent.mockImplementationOnce(async () => { throw new Error('channel hiccup') })
      expect(await sendGateContextMessage(flatChannels(), mockInstance, 'review-gate', 'Review Draft', undefined, 'discord:123', undefined)).toBeNull()
    })

    it('threaded: compact root card, full output in the thread, thread marker in the deliveries', async () => {
      const rt = threadedChannels()
      const result = await sendGateContextMessage(rt.channels, mockInstance, 'review-gate', 'Review Draft', { draft: { caption: 'Hello world' } }, 'discord:123', undefined)

      const [rootCall] = rt.deliverContent.mock.calls[0] as unknown as [{ channels: string[]; content: { body: string; files?: unknown[] } }]
      expect(rootCall.channels).toEqual(['discord:123'])
      expect(rootCall.content.body).toContain('_Full output & decision buttons in the thread ↓_')
      expect(rootCall.content.body).not.toContain('Details:')
      expect(rootCall.content.body).not.toContain('Hello world')
      expect(rootCall.content.files).toBeUndefined()
      expect(rt.createThread).toHaveBeenCalledWith({ channel: 'discord:123', messageRef: 'message:42', name: 'content-pipeline — Review Draft' })
      const [threadCall] = rt.deliverContent.mock.calls[1] as unknown as [{ channels: string[]; content: { body: string } }]
      expect(threadCall.channels).toEqual(['discord:channel:777'])
      expect(threadCall.content.body).toContain('`Task Review Details`\n\n')
      expect(threadCall.content.body).toContain('Hello world')
      expect(threadCall.content.body).not.toContain('[Review & Approve in Bakin]')
      expect(result?.threadId).toBe('777')
      expect(result?.deliveries.map((d) => d.ref)).toEqual(['message:42', 'thread:777'])
    })

    it('threaded with no output: buttons-only pointer and no details post', async () => {
      const rt = threadedChannels()
      await sendGateContextMessage(rt.channels, mockInstance, 'review-gate', 'Review Draft', {}, 'discord:123', undefined)
      const [rootCall] = rt.deliverContent.mock.calls[0] as unknown as [{ content: { body: string } }]
      expect(rootCall.content.body).toContain('_Decision buttons in the thread ↓_')
      expect(rootCall.content.body).not.toContain('{}')
      expect(rt.deliverContent.mock.calls).toHaveLength(1)
    })

    it('posts the promised details flat when thread creation fails', async () => {
      const rt = threadedChannels()
      rt.createThread.mockImplementationOnce(async () => { throw new Error('threads unavailable') })
      const result = await sendGateContextMessage(rt.channels, mockInstance, 'review-gate', 'Review Draft', { draft: { caption: 'Hello world' } }, 'discord:123', undefined)
      expect(result?.threadId).toBeUndefined()
      expect(result?.deliveries.map((d) => d.ref)).toEqual(['message:42'])
      expect(rt.deliverContent.mock.calls).toHaveLength(2)
      const [fallbackCall] = rt.deliverContent.mock.calls[1] as unknown as [{ channels: string[]; content: { body: string } }]
      expect(fallbackCall.channels).toEqual(['discord:123'])
      expect(fallbackCall.content.body).toContain('Hello world')
    })
  })

  describe('decision receipt', () => {
    const approver = { source: 'web' as const, id: 'main-operator', displayName: 'main-operator' }

    it('posts through the configured approvals channel', async () => {
      await sendGateDecisionSummary(mockInstance, 'review-gate', 'Review Draft', 'approved', approver, '2026-04-11T10:00:00Z', '2026-04-11T10:05:00Z', undefined, [])
      expect(sendNotification).toHaveBeenCalledTimes(1)
      const [call] = sendNotification.mock.calls[0] as unknown as [{ channels: string[]; notification: { severity: string; title: string; body: string } }]
      expect(call.channels).toEqual(['discord:123'])
      expect(call.notification.severity).toBe('success')
      expect(call.notification.title).toBe('')
      expect(call.notification.body).toContain('✅ **Approval Gate: Review Draft** — Approved\nBy main-operator (web) · took 5m')
      expect(call.notification.body).toContain('Task `task-42` · `content-pipeline`')
    })

    it('quotes the reject reason', async () => {
      await sendGateDecisionSummary(mockInstance, 'review-gate', 'Review Draft', 'rejected', { source: 'channel', id: 'owner-1', displayName: 'Owner' }, undefined, '2026-04-11T10:05:00Z', 'Needs a stronger hook', [])
      const [call] = sendNotification.mock.calls[0] as unknown as [{ notification: { severity: string; body: string } }]
      expect(call.notification.severity).toBe('warn')
      expect(call.notification.body).toContain('❌ **Approval Gate: Review Draft** — Rejected')
      expect(call.notification.body).toContain('> Needs a stronger hook')
    })

    it('threaded gates: edits the root card into a receipt and posts the summary inside the thread', async () => {
      const rt = threadedChannels()
      setNotificationRuntime({ channels: rt.channels } as unknown as AgentRuntimeAdapter)
      await sendGateDecisionSummary(mockInstance, 'review-gate', 'Review Draft', 'approved', { source: 'channel', id: 'owner-1', displayName: 'Owner' }, '2026-04-11T10:00:00Z', '2026-04-11T10:05:00Z', undefined, [
        { channelId: 'discord:123', ref: 'message:42', renderedAt: '2026-04-11T10:00:00Z' },
        { channelId: 'discord:channel:777', ref: 'thread:777', renderedAt: '2026-04-11T10:00:00Z' },
        { channelId: 'discord:123', ref: 'openclaw-plugin-approval:plugin:x', renderedAt: '2026-04-11T10:00:00Z' },
      ])
      expect(rt.editMessage).toHaveBeenCalledTimes(1)
      const [editCall] = rt.editMessage.mock.calls[0] as unknown as [{ messageRef: string; body: string }]
      expect(editCall.messageRef).toBe('message:42')
      expect(editCall.body).toContain('🚦 **Review Draft** — `content-pipeline`')
      expect(editCall.body).toContain('✅ **Approved** by Owner (channel) · took 5m')
      const [summaryCall] = sendNotification.mock.calls[0] as unknown as [{ channels: string[] }]
      expect(summaryCall.channels).toEqual(['discord:channel:777'])
    })

    it('skips the receipt and logs an error when the channel cannot be resolved', async () => {
      mockChannelAliases = {}
      await sendGateDecisionSummary(mockInstance, 'review-gate', 'Review Draft', 'approved', approver, undefined, '2026-04-11T10:05:00Z', undefined, [])
      expect(sendNotification).not.toHaveBeenCalled()
      expect(logError).toHaveBeenCalledTimes(1)
    })

    it('is silent while channel alerts are off', async () => {
      approvals.channelAlerts = false
      await sendGateDecisionSummary(mockInstance, 'review-gate', 'Review Draft', 'approved', approver, undefined, '2026-04-11T10:05:00Z', undefined, [])
      expect(sendNotification).not.toHaveBeenCalled()
    })
  })
})
