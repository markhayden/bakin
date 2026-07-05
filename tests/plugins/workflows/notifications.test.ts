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

const logInfo = mock()
const logWarn = mock()
const logError = mock()
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: logInfo,
    warn: logWarn,
    error: logError,
    debug: mock(),
  }),
}))

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

let mockAssetResolution: { found?: boolean; absPath?: string; mimeType?: string } | null = null
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: async (name: string) => {
      if (name === 'assets.resolveServe' && mockAssetResolution) return mockAssetResolution
      throw new Error(`no hook: ${name}`)
    },
  }),
}))

mock.module('@bakin/workflows/lib/gate-audit', () => ({
  buildGateAuditPayload: () => ({}),
  getGateDescription: () => 'Owner reviews the draft before publishing',
}))

import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import type { WorkflowInstance } from '@bakin/workflows/types'
import type { GateNotificationSettings } from '@bakin/workflows/lib/notifications'

// Dynamic imports so the mock.module overlays above apply before the modules
// capture their logger/settings references at evaluation time.
const {
  buildGateApprovalId,
  parseGateApprovalId,
  resolveGateApproval,
  sendGateApprovalRequest,
  sendGateDecisionSummary,
  setGateNotificationSettings,
  setNotificationRuntime,
} = await import('@bakin/workflows/lib/notifications')
const { createApprovalRecord, getApprovalRecord } = await import('@bakin/workflows/lib/approval-store')

describe('runtime gate notifications', () => {
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
    deliveries: [{ channelId: 'discord:123', ref: 'message:1', renderedAt: '2026-04-11T10:00:00Z' }],
  }))
  const resolveApproval = mock(async () => {})
  const sendNotification = mock(async () => ({ deliveries: [] }))
  const deliverContent = mock(async (..._args: unknown[]) => ({ deliveries: [] }))
  const listChannels = mock(async () => [] as Array<{ id: string }>)

  beforeEach(() => {
    rmSync(testHome, { recursive: true, force: true })
    mkdirSync(testHome, { recursive: true })
    process.env.BAKIN_HOME = testHome
    mockChannelAliases = { approvals: 'discord:123' }
    createApproval.mockClear()
    resolveApproval.mockClear()
    sendNotification.mockClear()
    deliverContent.mockClear()
    deliverContent.mockImplementation(async (..._args: unknown[]) => ({ deliveries: [] }))
    listChannels.mockClear()
    logError.mockClear()
    mockAssetResolution = null
    const runtime = {
      channels: {
        createApproval,
        resolveApproval,
        sendNotification,
        deliverContent,
        list: listChannels,
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

  function threadedRuntime() {
    const createThread = mock(async (..._args: unknown[]) => ({ threadId: '777', channelRef: 'discord:channel:777' }))
    const editMessage = mock(async (..._args: unknown[]) => {})
    const threadedDeliver = mock(async (..._args: unknown[]) => ({
      deliveries: [{ channelId: 'discord:123', ref: 'message:42', renderedAt: '2026-04-11T10:00:00Z' }],
    }))
    setNotificationRuntime({
      channels: {
        createApproval,
        resolveApproval,
        sendNotification,
        deliverContent: threadedDeliver,
        list: listChannels,
        createThread,
        editMessage,
      },
    } as unknown as AgentRuntimeAdapter)
    return { createThread, editMessage, deliverContent: threadedDeliver }
  }

  it('threads the gate: compact root card, full output in thread, buttons routed to the thread', async () => {
    const rt = threadedRuntime()

    const ref = await sendGateApprovalRequest(
      mockInstance,
      'review-gate',
      'Review Draft',
      { draft: { caption: 'Hello world' } },
      enabledSettings,
    )

    // Root card: pure header + links, no Details body, no files.
    const [rootCall] = rt.deliverContent.mock.calls[0] as unknown as [{ channels: string[]; content: { body: string; files?: unknown[] } }]
    expect(rootCall.channels).toEqual(['discord:123'])
    expect(rootCall.content.body).toContain('_Full output & decision buttons in the thread ↓_')
    expect(rootCall.content.body).not.toContain('Details:')
    expect(rootCall.content.body).not.toContain('Hello world')
    expect(rootCall.content.files).toBeUndefined()

    // Thread anchored to the root message.
    expect(rt.createThread).toHaveBeenCalledWith({
      channel: 'discord:123',
      messageRef: 'message:42',
      name: 'content-pipeline — Review Draft',
    })

    // Full output posted in the thread, links not repeated there.
    const [threadCall] = rt.deliverContent.mock.calls[1] as unknown as [{ channels: string[]; content: { body: string } }]
    expect(threadCall.channels).toEqual(['discord:channel:777'])
    expect(threadCall.content.body).toContain('`Task Review Details`\n\n')
    expect(threadCall.content.body).not.toContain('Details:\n')
    expect(threadCall.content.body).toContain('Hello world')
    expect(threadCall.content.body).not.toContain('[Review & Approve in Bakin]')

    // Button card routed into the thread via context.threadId.
    const [approvalCall] = createApproval.mock.calls[0] as unknown as [{ request: { context: { threadId?: string } } }]
    expect(approvalCall.request.context.threadId).toBe('777')

    // Durable deliveries carry root + thread marker + native refs.
    const refs = ref!.deliveries.map(d => d.ref)
    expect(refs).toContain('message:42')
    expect(refs).toContain('thread:777')
    expect(refs).toContain('message:1')
  })

  it('omits the Details section entirely when the step output is empty', async () => {
    const rt = threadedRuntime()

    await sendGateApprovalRequest(mockInstance, 'review-gate', 'Review Draft', {}, enabledSettings)

    const [rootCall] = rt.deliverContent.mock.calls[0] as unknown as [{ content: { body: string } }]
    expect(rootCall.content.body).not.toContain('Details:')
    expect(rootCall.content.body).not.toContain('{}')
    expect(rt.deliverContent.mock.calls).toHaveLength(1)
  })

  it('uses the buttons-only pointer when there is no output to post', async () => {
    const rt = threadedRuntime()

    await sendGateApprovalRequest(mockInstance, 'review-gate', 'Review Draft', {}, enabledSettings)

    const [rootCall] = rt.deliverContent.mock.calls[0] as unknown as [{ content: { body: string } }]
    expect(rootCall.content.body).toContain('_Decision buttons in the thread ↓_')
  })

  it('falls back to a flat channel message when thread creation fails', async () => {
    const rt = threadedRuntime()
    rt.createThread.mockImplementationOnce(async () => { throw new Error('threads unavailable') })

    const ref = await sendGateApprovalRequest(
      mockInstance,
      'review-gate',
      'Review Draft',
      { draft: { caption: 'Hello world' } },
      enabledSettings,
    )

    expect(ref).not.toBeNull()
    expect(createApproval).toHaveBeenCalledTimes(1)
    const [approvalCall] = createApproval.mock.calls[0] as unknown as [{ request: { context: { threadId?: string } } }]
    expect(approvalCall.request.context.threadId).toBeUndefined()
    expect(ref!.deliveries.map(d => d.ref)).not.toContainEqual(expect.stringContaining('thread:'))

    // The root card promised details — they MUST still be delivered, flat,
    // to the channel when the thread cannot be created.
    expect(rt.deliverContent.mock.calls).toHaveLength(2)
    const [fallbackCall] = rt.deliverContent.mock.calls[1] as unknown as [{ channels: string[]; content: { body: string } }]
    expect(fallbackCall.channels).toEqual(['discord:123'])
    expect(fallbackCall.content.body).toContain('Hello world')
  })

  it('edits the root card into a receipt and posts the summary inside the thread', async () => {
    const rt = threadedRuntime()

    await sendGateDecisionSummary(
      mockInstance,
      'review-gate',
      'Review Draft',
      'approved',
      { source: 'channel', id: 'owner-1', displayName: 'Owner' },
      '2026-04-11T10:00:00Z',
      '2026-04-11T10:05:00Z',
      undefined,
      enabledSettings,
      {
        approvalId: 'workflow-gate:task-42:review-gate',
        deliveries: [
          { channelId: 'discord:123', ref: 'message:42', renderedAt: '2026-04-11T10:00:00Z' },
          { channelId: 'discord:channel:777', ref: 'thread:777', renderedAt: '2026-04-11T10:00:00Z' },
          { channelId: 'discord:123', ref: 'openclaw-plugin-approval:plugin:x', renderedAt: '2026-04-11T10:00:00Z' },
        ],
      },
    )

    expect(rt.editMessage).toHaveBeenCalledTimes(1)
    const [editCall] = rt.editMessage.mock.calls[0] as unknown as [{ channel: string; messageRef: string; body: string }]
    expect(editCall.messageRef).toBe('message:42')
    expect(editCall.body).toContain('🚦 **Review Draft** — `content-pipeline`')
    expect(editCall.body).toContain('✅ **Approved** by Owner (channel) · took 5m')

    const [summaryCall] = sendNotification.mock.calls[0] as unknown as [{ channels: string[] }]
    expect(summaryCall.channels).toEqual(['discord:channel:777'])
  })

  it('builds parseable gate approval IDs', () => {
    const id = buildGateApprovalId('task:42', 'review gate', 'wf 1', '2026-04-11T10:00:00Z')
    expect(parseGateApprovalId(id)).toEqual({ taskId: 'task:42', stepId: 'review gate' })
    expect(parseGateApprovalId('not-a-gate')).toBeNull()
  })

  it('creates approvals through the runtime channel adapter with the resolved channel', async () => {
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
      deliveries: [{ channelId: 'discord:123', ref: 'message:1', renderedAt: '2026-04-11T10:00:00Z' }],
    })
    expect(getApprovalRecord(expectedApprovalId, testHome)).toEqual(expect.objectContaining({
      approvalId: expectedApprovalId,
      status: 'pending',
      deliveries: [{ channelId: 'discord:123', ref: 'message:1', renderedAt: '2026-04-11T10:00:00Z' }],
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
      channels: ['discord:123'],
    }))
    expect(call.request.options).toEqual([
      { id: 'approve', label: 'Approve', variant: 'primary' },
      { id: 'reject', label: 'Reject', variant: 'destructive' },
    ])
    const contextValue = call.request.context as { approvalUrl: string }
    expect(contextValue.approvalUrl).toContain('/api/plugins/workflows/gates/task-42/decision?stepId=review-gate')
    expect(contextValue.approvalUrl).not.toContain('approvalId')
  })

  it('posts a rich context message to the channel before creating the approval', async () => {
    const callOrder: string[] = []
    deliverContent.mockImplementation(async (..._args: unknown[]) => { callOrder.push('context'); return { deliveries: [] } })
    createApproval.mockImplementationOnce(async () => { callOrder.push('approval'); return { deliveries: [] } })

    await sendGateApprovalRequest(
      mockInstance,
      'review-gate',
      'Review Draft',
      { draft: { caption: 'Hello world' } },
      enabledSettings,
    )

    expect(callOrder).toEqual(['context', 'approval'])
    const [call] = deliverContent.mock.calls[0] as unknown as [{ channels: string[]; content: { title: string; body: string; files?: unknown[] } }]
    expect(call.channels).toEqual(['discord:123'])
    // Header lives in the body — a title would force a blank line before it.
    expect(call.content.title).toBe('')
    const body = call.content.body
    // Tight header block: gate label, identity line, and the workflow
    // author's gate description quoted — single newlines between them.
    expect(body).toContain('🚦 **Task Needs Review**\n\n**Review Draft** — `content-pipeline`\nTask `task-42` | Step `review-gate`')
    expect(body).not.toContain('Owner reviews the draft before publishing')
    expect(body).toContain('Hello world')
    expect(body).toMatch(/\*\*\[Review & Approve in Bakin\]\(http.*\/gates\/task-42\/decision\?stepId=review-gate\)\*\* · \[View Task\]\(http.*\/\?taskId=task-42\)/)
    // Divider separates the context message from the provider's button card.
    expect(body).toContain('─'.repeat(30))
    expect(call.content.files).toBeUndefined()
  })

  it('renders prior output as labeled fields instead of a JSON blob', async () => {
    await sendGateApprovalRequest(
      mockInstance,
      'review-gate',
      'Review Draft',
      {
        caption: 'Testing automation turns the slow, repetitive parts of quality work into fast feedback for the whole team.',
        targetPlatform: 'LinkedIn',
        hashtags: ['#TestingAutomation', '#DevOps'],
        image_brief: { mood: 'calm', palette: 'warm pastels' },
      },
      enabledSettings,
    )

    const [call] = deliverContent.mock.calls[0] as unknown as [{ content: { body: string } }]
    const body = call.content.body
    expect(body).toContain('**Details:**')
    expect(body).toContain('**Caption:**')
    expect(body).toContain('Testing automation turns the slow')
    expect(body).toContain('**Target platform:** LinkedIn')
    expect(body).toContain('**Hashtags:** #TestingAutomation, #DevOps')
    expect(body).toContain('**Image brief:**')
    expect(body).toContain('**Mood:** calm')
    expect(body).not.toContain('{')
    expect(body).not.toContain('"caption"')
  })

  it('attaches resolvable asset files from prior output to the context message', async () => {
    mockAssetResolution = { found: true, absPath: '/tmp/generated.png', mimeType: 'image/png' }

    await sendGateApprovalRequest(
      mockInstance,
      'review-gate',
      'Review Draft',
      { image: { assetId: 'asset-abc123' } },
      enabledSettings,
    )

    const [call] = deliverContent.mock.calls[0] as unknown as [{ content: { files?: Array<{ name: string; path: string; contentType?: string }> } }]
    expect(call.content.files).toEqual([
      { name: 'asset-abc123', path: '/tmp/generated.png', contentType: 'image/png' },
    ])
  })

  it('still creates the approval when the context message fails', async () => {
    deliverContent.mockImplementationOnce(async () => { throw new Error('channel hiccup') })

    const ref = await sendGateApprovalRequest(
      mockInstance,
      'review-gate',
      'Review Draft',
      undefined,
      enabledSettings,
    )

    expect(ref).not.toBeNull()
    expect(createApproval).toHaveBeenCalledTimes(1)
  })

  it('accepts a bare channel that the runtime lists', async () => {
    mockChannelAliases = {}
    listChannels.mockImplementationOnce(async () => [{ id: 'approvals' }])

    await sendGateApprovalRequest(mockInstance, 'review-gate', 'Review Draft', undefined, enabledSettings)

    expect(createApproval).toHaveBeenCalledTimes(1)
    const [call] = createApproval.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(call).toEqual(expect.objectContaining({ channels: ['approvals'] }))
  })

  it('returns null, keeps the durable record, and logs an error when the channel cannot be resolved', async () => {
    mockChannelAliases = {}

    const ref = await sendGateApprovalRequest(
      mockInstance,
      'review-gate',
      'Review Draft',
      undefined,
      enabledSettings,
    )

    expect(ref).toBeNull()
    expect(createApproval).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledTimes(1)

    const expectedApprovalId = buildGateApprovalId(
      'task-42',
      'review-gate',
      'wf_abc123',
      '2026-04-11T10:00:00Z',
    )
    expect(getApprovalRecord(expectedApprovalId, testHome)).toEqual(expect.objectContaining({
      approvalId: expectedApprovalId,
      status: 'pending',
      deliveries: [],
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
        deliveries: [{ channelId: 'discord:123', ref: 'message:1', renderedAt: '2026-04-11T10:00:00Z' }],
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

  it('sends decision summaries through the resolved channel', async () => {
    await sendGateDecisionSummary(
      mockInstance,
      'review-gate',
      'Review Draft',
      'approved',
      { source: 'web', id: 'main-operator', displayName: 'main-operator' },
      '2026-04-11T10:00:00Z',
      '2026-04-11T10:05:00Z',
      undefined,
      enabledSettings,
    )

    expect(sendNotification).toHaveBeenCalledTimes(1)
    const [call] = sendNotification.mock.calls[0] as unknown as [{ channels: string[]; notification: { severity: string; title: string; body: string } }]
    expect(call.channels).toEqual(['discord:123'])
    expect(call.notification.severity).toBe('success')
    expect(call.notification.title).toBe('')
    // Tight receipt: headline, actor + duration, identity — no gate description.
    expect(call.notification.body).toContain('✅ **Approval Gate: Review Draft** — Approved\nBy main-operator (web) · took 5m')
    expect(call.notification.body).toContain('Task `task-42` · `content-pipeline`')
    expect(call.notification.body).not.toContain('Approve the draft')
  })

  it('includes the reject reason as a quote in the decision summary', async () => {
    await sendGateDecisionSummary(
      mockInstance,
      'review-gate',
      'Review Draft',
      'rejected',
      { source: 'channel', id: 'owner-1', displayName: 'Owner' },
      undefined,
      '2026-04-11T10:05:00Z',
      'Needs a stronger hook',
      enabledSettings,
    )

    const [call] = sendNotification.mock.calls[0] as unknown as [{ notification: { severity: string; body: string } }]
    expect(call.notification.severity).toBe('warn')
    expect(call.notification.body).toContain('❌ **Approval Gate: Review Draft** — Rejected')
    expect(call.notification.body).toContain('> Needs a stronger hook')
  })

  it('skips the decision summary and logs an error when the channel cannot be resolved', async () => {
    mockChannelAliases = {}

    await sendGateDecisionSummary(
      mockInstance,
      'review-gate',
      'Review Draft',
      'approved',
      { source: 'web', id: 'main-operator' },
      undefined,
      '2026-04-11T10:05:00Z',
      undefined,
      enabledSettings,
    )

    expect(sendNotification).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledTimes(1)
  })
})
