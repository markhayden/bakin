/**
 * Approvals service (plan PR 2 T3): request → record + event (+ channel
 * render when alerts are on); resolve → typed refusals, kind handler, CAS,
 * channel notify, event; cancel → record + channel + event. Simultaneous
 * resolvers: one wins, the other gets 409 and the handler runs once (R1).
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { UI_OPERATOR, agentActor, discordUser } from '../../helpers/approval-provenance'
import { mkdirSync, readFileSync, rmSync } from 'fs'
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
const postApprovalOutcomeOnChannel = mock(async (_args: unknown) => {})
let outcomeSupported = true
let channelsPresent = true
const runtime = {
  get channels() {
    return channelsPresent
      ? {
          createApproval,
          resolveApproval: resolveApprovalOnChannel,
          cancelApproval: cancelApprovalOnChannel,
          list: async () => [],
          subscribeApprovalResponses: () => () => {},
          ...(outcomeSupported ? { postApprovalOutcome: postApprovalOutcomeOnChannel } : {}),
        }
      : undefined
  },
}
mock.module('../../../src/core/app-services-store', () => ({ maybeGetAppServices: () => ({ runtime }), getAppServices: () => ({ runtime }) }))

import { requestApproval, resolveApproval, cancelApproval, listPendingApprovals, postApprovalOutcome, resolveApprovalWithResult, settleApprovalFollowUps } from '../../../src/core/approvals/service'
import { registerApprovalKind, clearApprovalKinds, type ApprovalKindHandler } from '../../../src/core/approvals/kinds'
import { ApprovalKindUnavailableError, ApprovalNotFoundError, ApprovalNotPendingError, ApprovalRefusedError, ApprovalResolveError } from '../../../src/core/approvals/errors'
import { runAsAgentInvocation } from '../../../src/core/agent-invocation'
import { getApprovalRecord } from '../../../packages/core/src/approvals'
import { settleFor } from '../../helpers/wait'

const gateOwner = { kind: 'workflow-gate' as const, taskId: 't-1', workflowId: 'publish', runId: 'inst-1', stepId: 'review' }
const request = { title: 'Gate: review', body: 'Look', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }] }
const web = UI_OPERATOR

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
  postApprovalOutcomeOnChannel.mockClear()
  outcomeSupported = true
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
    await resolveApproval('a5', { option: 'approve', provenance: web })
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

    const resolved = await resolveApproval('r1', { option: 'approve', comment: 'ship it', provenance: web })

    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve.mock.calls[0]?.[1]).toMatchObject({ option: 'approve', comment: 'ship it', provenance: web })
    expect(resolved.status).toBe('approved')
    expect(resolved.response).toMatchObject({ selectedOption: 'approve', comment: 'ship it', provenance: web })
    expect(resolveApprovalOnChannel).toHaveBeenCalledWith(expect.objectContaining({ approvalId: 'r1', deliveries: resolved.deliveries }))
    expect(broadcasts.filter((b) => b.type === 'plugin-event')).toEqual([expect.objectContaining({ event: 'approval.resolved', approvalId: 'r1', kind: 'workflow-gate', taskId: 't-1', status: 'approved', option: 'approve' })])
  })

  it('refuses an unknown id (404 class) and a non-pending record (409 class)', async () => {
    registerGateKind()
    await expect(resolveApproval('ghost', { option: 'approve', provenance: web })).rejects.toBeInstanceOf(ApprovalNotFoundError)
    requestApproval({ approvalId: 'r2', owner: gateOwner, request })
    await resolveApproval('r2', { option: 'reject', comment: 'no', provenance: web })
    await expect(resolveApproval('r2', { option: 'approve', provenance: web })).rejects.toBeInstanceOf(ApprovalNotPendingError)
    expect(onResolve).toHaveBeenCalledTimes(1)
  })

  it('a handler throw leaves the record pending and surfaces the typed error', async () => {
    registerGateKind({ onResolve: async () => { throw new ApprovalResolveError('gate is not pending any more', 409) } })
    requestApproval({ approvalId: 'r3', owner: gateOwner, request })
    await expect(resolveApproval('r3', { option: 'approve', provenance: web })).rejects.toMatchObject({ status: 409 })
    expect(getApprovalRecord('r3')?.status).toBe('pending')
    expect(broadcasts.filter((b) => b.event === 'approval.resolved')).toEqual([])
  })

  it('simultaneous resolvers: the handler runs once, one wins, the other is refused as not pending', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    registerGateKind({ onResolve: async (record, decision) => { onResolve(record, decision); await gate } })
    requestApproval({ approvalId: 'race', owner: gateOwner, request })

    const first = resolveApproval('race', { option: 'approve', provenance: web })
    const second = resolveApproval('race', { option: 'reject', provenance: discordUser('discord-user') })
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
    await expect(resolveApproval('r4', { option: 'approve', provenance: web })).rejects.toBeInstanceOf(ApprovalKindUnavailableError)
    expect(getApprovalRecord('r4')?.status).toBe('pending')
  })

  it('a channel notify failure never fails the decision', async () => {
    registerGateKind()
    channelAlerts = true
    requestApproval({ approvalId: 'r5', owner: gateOwner, request })
    await settleFor(20, 'let the card render so deliveries exist')
    resolveApprovalOnChannel.mockRejectedValueOnce(new Error('discord down'))
    const resolved = await resolveApproval('r5', { option: 'approve', provenance: web })
    expect(resolved.status).toBe('approved')
  })
})

describe('the decision policy (#898)', () => {
  it('refuses inside an agent tool call, an agent actor, and an undeclared caller — before the record is even read', async () => {
    registerGateKind()
    requestApproval({ approvalId: 'guarded', owner: gateOwner, request })
    const refused = async (run: () => Promise<unknown>, code: ApprovalRefusedError['code']) => {
      const err = await run().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ApprovalRefusedError)
      expect((err as ApprovalRefusedError).code).toBe(code)
    }
    await refused(() => runAsAgentInvocation({ agentId: 'researcher', tool: 'bakin_exec_x' }, async () => await resolveApproval('guarded', { option: 'approve', provenance: web })), 'agent_context')
    await refused(() => resolveApproval('guarded', { option: 'approve', provenance: agentActor('researcher') }), 'agent_actor')
    await refused(() => resolveApproval('guarded', { option: 'approve', provenance: { channel: 'ui', actor: { kind: 'unknown' }, evidence: 'declared' } }), 'undeclared')
    // An unknown id is refused, not 404: a refused caller learns nothing.
    await refused(() => resolveApproval('no-such-id', { option: 'approve', provenance: agentActor('researcher') }), 'agent_actor')
    expect(onResolve).not.toHaveBeenCalled()
    expect(getApprovalRecord('guarded')?.status).toBe('pending')
    // Outside the agent's call, the same caller's declared decision goes through.
    await resolveApproval('guarded', { option: 'approve', provenance: web })
    expect(getApprovalRecord('guarded')?.response?.provenance).toEqual(UI_OPERATOR)
  })

  it('every decision leaves one audit line saying who decided and how Bakin knows (D-H8)', async () => {
    registerGateKind()
    requestApproval({ approvalId: 'audited', owner: gateOwner, request })
    await resolveApproval('audited', { option: 'reject', comment: 'no', provenance: discordUser('u-9', 'mark') })
    const lines = readFileSync(join(testDir, 'audit.jsonl'), 'utf-8').trim().split('\n').map((line) => JSON.parse(line) as { event: string; data: Record<string, unknown> })
    const resolved = lines.filter((line) => line.event === 'approval.resolved')
    expect(resolved).toHaveLength(1)
    expect(resolved[0]!.data).toMatchObject({ approvalId: 'audited', option: 'reject', decidedBy: 'Discord @mark', provenance: discordUser('u-9', 'mark') })
    expect(broadcasts.find((b) => b.event === 'approval.resolved')).toMatchObject({ provenance: discordUser('u-9', 'mark') })
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

describe('afterResolve and the outcome follow-up (#895 D24)', () => {
  it('runs strictly after the decision is saved, the channel told and the resolution published', async () => {
    channelAlerts = true
    const seen: Array<{ status: string; channelResolved: number; published: boolean; result: unknown }> = []
    registerGateKind({
      onResolve: async () => ({ operationId: 'op-42' }),
      afterResolve: async (record, result) => {
        seen.push({
          status: getApprovalRecord(record.approvalId)!.status,
          channelResolved: resolveApprovalOnChannel.mock.calls.length,
          published: broadcasts.some((b) => b.event === 'approval.resolved' && b.approvalId === record.approvalId),
          result,
        })
      },
    })
    requestApproval({ approvalId: 'a-1', owner: gateOwner, request })
    await settleFor(20, 'channel render is fire-and-forget')
    const { result } = await resolveApprovalWithResult('a-1', { option: 'approve', provenance: web })
    expect(result).toEqual({ operationId: 'op-42' })
    await settleApprovalFollowUps()
    expect(seen).toEqual([{ status: 'approved', channelResolved: 1, published: true, result: { operationId: 'op-42' } }])
  })

  it('never delays or fails the resolver: a slow or throwing follow-up is logged', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    registerGateKind({ afterResolve: async () => { await gate; throw new Error('follow-up exploded') } })
    requestApproval({ approvalId: 'a-2', owner: gateOwner, request })
    const record = await resolveApproval('a-2', { option: 'approve', provenance: web })
    expect(record.status).toBe('approved')
    release()
    await settleApprovalFollowUps()
  })

  it('posts an outcome only where the runtime supports it and the card was rendered', async () => {
    channelAlerts = true
    registerGateKind()
    requestApproval({ approvalId: 'a-3', owner: gateOwner, request })
    await settleFor(20, 'channel render is fire-and-forget')
    const resolved = await resolveApproval('a-3', { option: 'approve', provenance: web })
    expect(await postApprovalOutcome(resolved, { status: 'succeeded', title: 'Repair applied' })).toBe(true)
    expect(postApprovalOutcomeOnChannel.mock.calls[0]![0]).toMatchObject({ approvalId: 'a-3', outcome: { status: 'succeeded', title: 'Repair applied' } })

    outcomeSupported = false
    expect(await postApprovalOutcome(resolved, { status: 'failed', title: 'x' })).toBe(false)
    outcomeSupported = true
    expect(await postApprovalOutcome({ ...resolved, deliveries: [] }, { status: 'failed', title: 'x' })).toBe(false)
    expect(postApprovalOutcomeOnChannel).toHaveBeenCalledTimes(1)
  })
})
