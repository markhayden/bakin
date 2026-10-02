/**
 * Approvals service (plan PR 2 T3): request → record + event (+ channel
 * render when alerts are on); resolve → typed refusals, kind handler, CAS,
 * channel notify, event; cancel → record + channel + event. Simultaneous
 * resolvers: one wins, the other gets 409 and the handler runs once (R1).
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-approvals-service-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

let channelAlerts = false
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({ approvals: { channelAlerts, channel: 'general', requireRejectReason: true } }),
  resetSettingsCache: () => {},
}))

const broadcasts: Array<Record<string, unknown>> = []
mock.module('../../../src/core/sse', () => ({ broadcast: (d: Record<string, unknown>) => { broadcasts.push(d) } }))

mock.module('../../../src/core/channel-aliases', () => ({
  resolveRuntimeChannelRef: async (_runtime: unknown, channel: string) => ({ resolved: `resolved:${channel}` }),
}))

const createApproval = mock(async (args: { approvalId: string; channels: string[] }) => ({ deliveries: [{ channelId: args.channels[0], ref: `card-${args.approvalId}`, renderedAt: '2026-10-02T00:00:00.000Z' }] }))
const resolveApprovalOnChannel = mock(async () => {})
const cancelApprovalOnChannel = mock(async () => {})
let channelsPresent = true
const runtime = {
  get channels() {
    return channelsPresent
      ? { createApproval, resolveApproval: resolveApprovalOnChannel, cancelApproval: cancelApprovalOnChannel, list: async () => [], subscribeApprovalResponses: () => () => {} }
      : undefined
  },
}
mock.module('../../../src/core/app-services-store', () => ({ maybeGetAppServices: () => ({ runtime }), getAppServices: () => ({ runtime }) }))

import { requestApproval, resolveApproval, cancelApproval, listPendingApprovals } from '../../../src/core/approvals/service'
import { registerApprovalKind, clearApprovalKinds, type ApprovalKindHandler } from '../../../src/core/approvals/kinds'
import { ApprovalKindUnavailableError, ApprovalNotFoundError, ApprovalNotPendingError, ApprovalResolveError } from '../../../src/core/approvals/errors'
import { getApprovalRecord } from '../../../packages/core/src/approvals'
import { settleFor } from '../../helpers/wait'

const gateOwner = { kind: 'workflow-gate' as const, taskId: 't-1', workflowId: 'publish', runId: 'inst-1', stepId: 'review' }
const request = { title: 'Gate: review', body: 'Look', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }] }
const web = { source: 'web' as const, id: 'mark' }

const onResolve = mock(async (_record: unknown, _decision: unknown) => {})
function registerGateKind(overrides: Partial<ApprovalKindHandler<'workflow-gate'>> = {}): void {
  registerApprovalKind<'workflow-gate'>({ kind: 'workflow-gate', ownerState: async () => 'live', onResolve, ...overrides })
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  broadcasts.length = 0
  createApproval.mockClear()
  resolveApprovalOnChannel.mockClear()
  cancelApprovalOnChannel.mockClear()
  onResolve.mockClear()
  onResolve.mockImplementation(async () => {})
  channelAlerts = false
  channelsPresent = true
  clearApprovalKinds()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('requestApproval', () => {
  it('creates the record and publishes approval.pending with kind + taskId; no channel render while alerts are off', () => {
    registerGateKind()
    const record = requestApproval({ approvalId: 'a1', owner: gateOwner, request })
    expect(record.status).toBe('pending')
    expect(broadcasts).toEqual([expect.objectContaining({ type: 'plugin-event', event: 'approval.pending', approvalId: 'a1', kind: 'workflow-gate', taskId: 't-1', title: 'Gate: review' })])
    expect(createApproval).not.toHaveBeenCalled()
    expect(listPendingApprovals({ taskIds: ['t-1'] }).map((r) => r.approvalId)).toEqual(['a1'])
  })

  it('renders a card on the resolved channel when alerts are on and stores the deliveries', async () => {
    registerGateKind()
    channelAlerts = true
    requestApproval({ approvalId: 'a2', owner: gateOwner, request })
    await settleFor(20, 'channel render is fire-and-forget; give it a tick')
    expect(createApproval).toHaveBeenCalledWith({ approvalId: 'a2', channels: ['resolved:general'], request })
    expect(getApprovalRecord('a2')?.deliveries).toEqual([{ channelId: 'resolved:general', ref: 'card-a2', renderedAt: '2026-10-02T00:00:00.000Z' }])
  })

  it('a kind with its own render owns the deliveries', async () => {
    registerGateKind({ render: async () => [{ channelId: 'custom', ref: 'thread-root', renderedAt: 'now' }] })
    channelAlerts = true
    requestApproval({ approvalId: 'a3', owner: gateOwner, request })
    await settleFor(20, 'channel render is fire-and-forget; give it a tick')
    expect(createApproval).not.toHaveBeenCalled()
    expect(getApprovalRecord('a3')?.deliveries).toEqual([{ channelId: 'custom', ref: 'thread-root', renderedAt: 'now' }])
  })

  it('a channel render failure leaves the record pending and board-only', async () => {
    registerGateKind()
    channelAlerts = true
    createApproval.mockRejectedValueOnce(new Error('discord down'))
    requestApproval({ approvalId: 'a4', owner: gateOwner, request })
    await settleFor(20, 'channel render is fire-and-forget; give it a tick')
    expect(getApprovalRecord('a4')).toMatchObject({ status: 'pending', deliveries: [] })
  })

  it('re-requesting a resolved id returns it untouched and publishes nothing', async () => {
    registerGateKind()
    requestApproval({ approvalId: 'a5', owner: gateOwner, request })
    await resolveApproval('a5', { option: 'approve', actor: web })
    broadcasts.length = 0
    expect(requestApproval({ approvalId: 'a5', owner: gateOwner, request }).status).toBe('approved')
    expect(broadcasts).toEqual([])
  })
})

describe('resolveApproval', () => {
  it('runs the kind handler, resolves the record, notifies the channel deliveries and publishes approval.resolved', async () => {
    registerGateKind()
    channelAlerts = true
    requestApproval({ approvalId: 'r1', owner: gateOwner, request })
    await settleFor(20, 'let the card render so deliveries exist')
    broadcasts.length = 0

    const resolved = await resolveApproval('r1', { option: 'approve', comment: 'ship it', actor: { source: 'web', id: 'mark', displayName: 'Mark' } })

    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve.mock.calls[0]?.[1]).toMatchObject({ option: 'approve', comment: 'ship it', actor: { source: 'web', id: 'mark' } })
    expect(resolved.status).toBe('approved')
    expect(resolved.response).toMatchObject({ selectedOption: 'approve', comment: 'ship it', actor: { type: 'human', id: 'mark', displayName: 'Mark' } })
    expect(resolveApprovalOnChannel).toHaveBeenCalledWith(expect.objectContaining({ approvalId: 'r1', deliveries: resolved.deliveries }))
    expect(broadcasts).toEqual([expect.objectContaining({ event: 'approval.resolved', approvalId: 'r1', kind: 'workflow-gate', taskId: 't-1', status: 'approved', option: 'approve' })])
  })

  it('refuses an unknown id (404 class) and a non-pending record (409 class)', async () => {
    registerGateKind()
    await expect(resolveApproval('ghost', { option: 'approve', actor: web })).rejects.toBeInstanceOf(ApprovalNotFoundError)
    requestApproval({ approvalId: 'r2', owner: gateOwner, request })
    await resolveApproval('r2', { option: 'reject', comment: 'no', actor: web })
    await expect(resolveApproval('r2', { option: 'approve', actor: web })).rejects.toBeInstanceOf(ApprovalNotPendingError)
    expect(onResolve).toHaveBeenCalledTimes(1)
  })

  it('a handler throw leaves the record pending and surfaces the typed error', async () => {
    registerGateKind({ onResolve: async () => { throw new ApprovalResolveError('gate is not pending any more', 409) } })
    requestApproval({ approvalId: 'r3', owner: gateOwner, request })
    await expect(resolveApproval('r3', { option: 'approve', actor: web })).rejects.toMatchObject({ status: 409 })
    expect(getApprovalRecord('r3')?.status).toBe('pending')
    expect(broadcasts.filter((b) => b.event === 'approval.resolved')).toEqual([])
  })

  it('simultaneous resolvers: the handler runs once, one wins, the other is refused as not pending', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    registerGateKind({ onResolve: async (record, decision) => { onResolve(record, decision); await gate } })
    requestApproval({ approvalId: 'race', owner: gateOwner, request })

    const first = resolveApproval('race', { option: 'approve', actor: web })
    const second = resolveApproval('race', { option: 'reject', actor: { source: 'channel', id: 'discord-user' } })
    release()
    const [a, b] = await Promise.allSettled([first, second])

    expect(a.status).toBe('fulfilled')
    expect(b.status).toBe('rejected')
    if (b.status === 'rejected') expect(b.reason).toBeInstanceOf(ApprovalNotPendingError)
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(getApprovalRecord('race')?.response?.selectedOption).toBe('approve')
  })

  it('refuses a record whose kind has no handler without touching it', async () => {
    requestApproval({ approvalId: 'r4', owner: gateOwner, request })
    await expect(resolveApproval('r4', { option: 'approve', actor: web })).rejects.toBeInstanceOf(ApprovalKindUnavailableError)
    expect(getApprovalRecord('r4')?.status).toBe('pending')
  })

  it('a channel notify failure never fails the decision', async () => {
    registerGateKind()
    channelAlerts = true
    requestApproval({ approvalId: 'r5', owner: gateOwner, request })
    await settleFor(20, 'let the card render so deliveries exist')
    resolveApprovalOnChannel.mockRejectedValueOnce(new Error('discord down'))
    const resolved = await resolveApproval('r5', { option: 'approve', actor: web })
    expect(resolved.status).toBe('approved')
  })
})

describe('cancelApproval', () => {
  it('cancels a pending record, tells the channel when there are deliveries, and publishes cancelled; idempotent afterwards', async () => {
    registerGateKind()
    channelAlerts = true
    requestApproval({ approvalId: 'c1', owner: gateOwner, request })
    await settleFor(20, 'let the card render so deliveries exist')
    broadcasts.length = 0

    const cancelled = await cancelApproval('c1', 'plan-changed')
    expect(cancelled?.status).toBe('cancelled')
    expect(cancelApprovalOnChannel).toHaveBeenCalledWith(expect.objectContaining({ approvalId: 'c1', reason: 'plan-changed' }))
    expect(broadcasts).toEqual([expect.objectContaining({ event: 'approval.resolved', approvalId: 'c1', status: 'cancelled' })])

    broadcasts.length = 0
    cancelApprovalOnChannel.mockClear()
    expect((await cancelApproval('c1', 'again'))?.status).toBe('cancelled')
    expect(cancelApprovalOnChannel).not.toHaveBeenCalled()
    expect(broadcasts).toEqual([])
    expect(await cancelApproval('missing', 'x')).toBeNull()
  })
})
