import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import fs from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-delivery-approvals-${Date.now()}`)
const auditEvents: Array<{ event: string; data: Record<string, unknown> }> = []

mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../src/core/audit', () => ({
  appendAudit: (_dir: string, event: string, _agent: string, data: Record<string, unknown>) => {
    auditEvents.push({ event, data })
  },
}))

import type { ApprovalResolveEvent } from '../../../packages/core/src/adapters/runtime/channels'
import {
  createApprovalSurface,
  type ApprovalApi,
  type ApprovalSendApi,
} from '../../../src/core/delivery/discord/approvals'

const APPROVAL_ID = 'workflow-gate:task-1:step-approve:instance-9:2026-07-26T00%3A00%3A00.000Z'

function makeDeps(opts: { approvers?: string[] } = {}) {
  const posted: Array<{ channelId: string; payload: Record<string, unknown> }> = []
  const replies: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const modals: Array<Record<string, unknown>> = []
  const edits: Array<{ channelId: string; messageId: string; payload: Record<string, unknown> }> = []
  const events: ApprovalResolveEvent[] = []

  let counter = 0
  const sendApi: ApprovalSendApi = {
    createMessage: async (channelId, payload) => {
      posted.push({ channelId, payload: payload as Record<string, unknown> })
      counter += 1
      return { id: `card-${counter}` }
    },
  }
  const api: ApprovalApi = {
    replyEphemeral: async (_id, _token, content) => { replies.push({ content }) },
    updateComponentMessage: async (_id, _token, payload) => { updates.push(payload as Record<string, unknown>) },
    openModal: async (_id, _token, modal) => { modals.push(modal as Record<string, unknown>) },
    editMessage: async (channelId, messageId, payload) => {
      edits.push({ channelId, messageId, payload: payload as Record<string, unknown> })
    },
  }
  const surface = createApprovalSurface({
    api,
    sendApi,
    approvers: () => opts.approvers ?? ['owner-1'],
    resolveChannelId: async (ref) => ref.split(':').pop()!,
  })
  surface.subscribe(event => { events.push(event) })
  return { surface, posted, replies, updates, modals, edits, events }
}

async function renderCard(deps: ReturnType<typeof makeDeps>, requireRejectReason = true) {
  return deps.surface.createApproval({
    approvalId: APPROVAL_ID,
    channels: ['discord:channel:777'],
    request: {
      title: 'Approve step?',
      body: 'Workflow gate needs a decision',
      options: [
        { id: 'approve', label: 'Approve', variant: 'primary' },
        { id: 'reject', label: 'Reject', variant: 'destructive' },
      ],
      context: { requireRejectReason, approvalUrl: 'http://localhost:3737/tasks?taskId=task-1' },
    },
  })
}

function buttonInteraction(customId: string, userId: string, message: Record<string, unknown>) {
  return {
    id: 'int-1',
    token: 'tok',
    type: 3,
    data: { custom_id: customId, component_type: 2 },
    message,
    member: { user: { id: userId, username: 'mark' } },
    channel_id: '777',
  }
}

function cardMessage(approvalId = APPROVAL_ID): Record<string, unknown> {
  return {
    id: 'card-1',
    channel_id: '777',
    embeds: [{ title: 'Approve step?', description: 'body', footer: { text: `approval:${approvalId}` } }],
    components: [],
  }
}

describe('discord approval surface', () => {
  beforeEach(() => {
    auditEvents.length = 0
    fs.rmSync(testDir, { recursive: true, force: true })
    fs.mkdirSync(testDir, { recursive: true })
  })
  afterAll(() => fs.rmSync(testDir, { recursive: true, force: true }))

  it('renders a buttoned card with footer approvalId and a Bakin link', async () => {
    const deps = makeDeps()
    const result = await renderCard(deps)
    expect(result.deliveries).toEqual([
      { channelId: 'discord:channel:777', ref: 'message:card-1', renderedAt: expect.any(String) },
    ])
    const payload = deps.posted[0].payload
    const embed = (payload.embeds as Array<Record<string, unknown>>)[0]
    expect((embed.footer as { text: string }).text).toBe(`approval:${APPROVAL_ID}`)
    const rows = payload.components as Array<{ components: Array<Record<string, unknown>> }>
    const buttons = rows.flatMap(row => row.components)
    expect(buttons.map(b => b.custom_id ?? b.url)).toEqual([
      'bkap:approve:',
      'bkap:reject:dr',
      'http://localhost:3737/tasks?taskId=task-1',
    ])
    expect(auditEvents.some(e => e.event === 'delivery.approval_rendered')).toBe(true)
  })

  it('denies unauthorized clickers ephemerally, audits, and never emits', async () => {
    const deps = makeDeps({ approvers: ['owner-1'] })
    await deps.surface.handleInteraction(buttonInteraction('bkap:approve:', 'stranger-2', cardMessage()))
    expect(deps.replies).toHaveLength(1)
    expect(String(deps.replies[0].content)).toContain('not authorized')
    expect(deps.events).toHaveLength(0)
    expect(auditEvents.some(e => e.event === 'delivery.approval_denied')).toBe(true)
  })

  it('fails closed when the approvers list is empty', async () => {
    const deps = makeDeps({ approvers: [] })
    await deps.surface.handleInteraction(buttonInteraction('bkap:approve:', 'owner-1', cardMessage()))
    expect(deps.events).toHaveLength(0)
    expect(deps.replies).toHaveLength(1)
  })

  it('approve click emits the resolve event and disables the card buttons', async () => {
    const deps = makeDeps()
    await deps.surface.handleInteraction(buttonInteraction('bkap:approve:', 'owner-1', cardMessage()))
    expect(deps.events).toHaveLength(1)
    const event = deps.events[0]
    expect(event.approvalId).toBe(APPROVAL_ID)
    expect(event.response.selectedOption).toBe('approve')
    expect(event.response.actor).toEqual({ type: 'human', id: 'owner-1', displayName: 'mark' })
    expect(event.channelId).toBe('discord:channel:777')
    expect(deps.updates).toHaveLength(1)
  })

  it('reject click opens a reason modal (required when flagged)', async () => {
    const deps = makeDeps()
    await deps.surface.handleInteraction(buttonInteraction('bkap:reject:dr', 'owner-1', cardMessage()))
    expect(deps.events).toHaveLength(0)
    expect(deps.modals).toHaveLength(1)
    const modal = deps.modals[0]
    expect(modal.custom_id).toBe('bkapm:reject')
    const input = (modal.components as Array<{ components: Array<Record<string, unknown>> }>)[0].components[0]
    expect(input.required).toBe(true)
  })

  it('modal submit emits the resolve event with the typed reason', async () => {
    const deps = makeDeps()
    await deps.surface.handleInteraction({
      id: 'int-2',
      token: 'tok',
      type: 5,
      data: {
        custom_id: 'bkapm:reject',
        components: [{ components: [{ custom_id: 'reason', value: 'wrong direction' }] }],
      },
      message: cardMessage(),
      member: { user: { id: 'owner-1', username: 'mark' } },
      channel_id: '777',
    })
    expect(deps.events).toHaveLength(1)
    expect(deps.events[0].response.selectedOption).toBe('reject')
    expect(deps.events[0].response.comment).toBe('wrong direction')
  })

  it('ignores interactions without an approval footer', async () => {
    const deps = makeDeps()
    await deps.surface.handleInteraction(buttonInteraction('bkap:approve:', 'owner-1', {
      id: 'x', channel_id: '777', embeds: [{ title: 'not ours' }], components: [],
    }))
    expect(deps.events).toHaveLength(0)
    expect(deps.replies).toHaveLength(0)
  })

  it('resolveApproval strips buttons and appends the decision', async () => {
    const deps = makeDeps()
    await deps.surface.resolveApproval({
      approvalId: APPROVAL_ID,
      deliveries: [{ channelId: 'discord:channel:777', ref: 'message:card-1', renderedAt: 'now' }],
      response: {
        selectedOption: 'approve',
        respondedAt: '2026-07-26T01:00:00.000Z',
        actor: { type: 'human', id: 'owner-1', displayName: 'mark' },
      },
    })
    expect(deps.edits).toHaveLength(1)
    expect(deps.edits[0].messageId).toBe('card-1')
    expect(deps.edits[0].payload.components).toEqual([])
    expect(String(deps.edits[0].payload.content)).toContain('Approve')
  })

  it('cancelApproval strips buttons with a cancellation note', async () => {
    const deps = makeDeps()
    await deps.surface.cancelApproval({
      approvalId: APPROVAL_ID,
      deliveries: [{ channelId: 'discord:channel:777', ref: 'message:card-1', renderedAt: 'now' }],
      reason: 'superseded',
    })
    expect(deps.edits).toHaveLength(1)
    expect(String(deps.edits[0].payload.content)).toContain('superseded')
  })

  it('unsubscribe stops event delivery', async () => {
    const deps = makeDeps()
    const received: ApprovalResolveEvent[] = []
    const unsubscribe = deps.surface.subscribe(event => received.push(event))
    unsubscribe()
    await deps.surface.handleInteraction(buttonInteraction('bkap:approve:', 'owner-1', cardMessage()))
    expect(received).toHaveLength(0)
    expect(deps.events).toHaveLength(1)
  })
})
