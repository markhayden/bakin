/**
 * plugin-gate approvals (spec D26): ONE core kind handler dispatches each
 * decision to the gate registered for (pluginId, gateKind). Provenance and
 * the one decision path are unchanged; a record whose plugin is not loaded
 * answers 503 on resolve and is skipped — never cancelled — at rehydration.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { UI_OPERATOR, agentActor, discordUser } from '../../helpers/approval-provenance'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-approvals-plugin-gates-${Date.now()}-${randomUUID()}`)
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
let requireRejectReason = true
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({ approvals: { channelAlerts, channel: 'general', requireRejectReason } }),
  resetSettingsCache: () => {},
}))

const broadcasts: Array<Record<string, unknown>> = []
mock.module('../../../src/core/sse', () => ({ broadcast: (d: Record<string, unknown>) => { broadcasts.push(d) } }))

mock.module('../../../src/core/channel-aliases', () => ({
  resolveRuntimeChannelRef: async (_runtime: unknown, channel: string) => ({ resolved: `resolved:${channel}` }),
}))

const runtime = {
  channels: {
    createApproval: async (args: { approvalId: string; channels: string[] }) => ({ deliveries: [{ channelId: args.channels[0], ref: `card-${args.approvalId}`, renderedAt: 'now' }] }),
    resolveApproval: async () => {},
    cancelApproval: async () => {},
    list: async () => [],
    subscribeApprovalResponses: () => () => {},
  },
}
mock.module('../../../src/core/app-services-store', () => ({ maybeGetAppServices: () => ({ runtime }), getAppServices: () => ({ runtime }) }))

import { requestApproval, resolveApproval } from '../../../src/core/approvals/service'
import { clearApprovalKinds, getApprovalKind, type ApprovalDecision, type ApprovalOwnerState } from '../../../src/core/approvals/kinds'
import { clearPluginGates, registerPluginGate, registerPluginGateKind, unregisterPluginGates, type PluginGateHandler, type PluginGateRecord } from '../../../src/core/approvals/plugin-gates'
import { ApprovalKindUnavailableError, ApprovalRefusedError, ApprovalResolveError, approvalErrorStatus } from '../../../src/core/approvals/errors'
import { rehydratePendingApprovals } from '../../../src/core/approvals/rehydration'
import { bootApprovals } from '../../../src/core/approvals/channel-wiring'
import { getApprovalRecord, parseApprovalRecord } from '../../../packages/core/src/approvals'

const request = { title: 'Sign off: Launch', body: 'All steps done.', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }] }
const owner = (gateKind = 'complete', pluginId = 'projects', entityId = 'launch') => ({ kind: 'plugin-gate' as const, taskId: 'steward-1', pluginId, gateKind, entityId })

function gate(overrides: Partial<PluginGateHandler> = {}) {
  const onResolve = mock(async (_record: PluginGateRecord, _decision: ApprovalDecision): Promise<unknown> => 'applied')
  const ownerState = mock(async (_record: PluginGateRecord): Promise<ApprovalOwnerState> => 'live')
  return { handler: { onResolve, ownerState, ...overrides } as PluginGateHandler, onResolve, ownerState }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  broadcasts.length = 0
  channelAlerts = false
  requireRejectReason = true
  clearApprovalKinds()
  clearPluginGates()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('plugin-gate approvals', () => {
  it('dispatches the decision to the (pluginId, gateKind) gate only, then resolves the record', async () => {
    const complete = gate()
    const signoff = gate()
    const other = gate()
    registerPluginGate('projects', 'complete', complete.handler)
    registerPluginGate('projects', 'signoff', signoff.handler)
    registerPluginGate('messaging', 'complete', other.handler)
    requestApproval({ approvalId: 'projects:launch:complete:project:1', owner: owner(), request })

    const resolved = await resolveApproval('projects:launch:complete:project:1', { option: 'approve', provenance: UI_OPERATOR })

    expect(complete.onResolve).toHaveBeenCalledTimes(1)
    expect(complete.onResolve.mock.calls[0]).toEqual([
      expect.objectContaining({ owner: owner() }),
      expect.objectContaining({ option: 'approve', provenance: UI_OPERATOR }),
    ])
    expect(signoff.onResolve).not.toHaveBeenCalled()
    expect(other.onResolve).not.toHaveBeenCalled()
    expect(resolved.status).toBe('approved')
    expect(broadcasts.map((b) => b.event)).toEqual(['approval.pending', 'approval.resolved'])
    expect(broadcasts[1]).toMatchObject({ kind: 'plugin-gate', taskId: 'steward-1' })
  })

  it('no gate loaded for the plugin: resolve is 503 and the record stays pending', async () => {
    registerPluginGateKind()
    requestApproval({ approvalId: 'g1', owner: owner(), request })
    const err = await resolveApproval('g1', { option: 'approve', provenance: UI_OPERATOR }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApprovalKindUnavailableError)
    expect(approvalErrorStatus(err)).toBe(503)
    expect(getApprovalRecord('g1')?.status).toBe('pending')
  })

  it('a gate refusing the decision leaves it pending with its own status', async () => {
    registerPluginGate('projects', 'complete', gate({ onResolve: async () => { throw new ApprovalResolveError('project already completed', 409) } }).handler)
    requestApproval({ approvalId: 'g2', owner: owner(), request })
    await expect(resolveApproval('g2', { option: 'approve', provenance: UI_OPERATOR })).rejects.toMatchObject({ status: 409 })
    expect(getApprovalRecord('g2')?.status).toBe('pending')
  })

  it('agents still cannot decide: refused before the gate runs', async () => {
    const g = gate()
    registerPluginGate('projects', 'complete', g.handler)
    requestApproval({ approvalId: 'g3', owner: owner(), request })
    await expect(resolveApproval('g3', { option: 'approve', provenance: agentActor('lead') })).rejects.toBeInstanceOf(ApprovalRefusedError)
    expect(g.onResolve).not.toHaveBeenCalled()
    expect(getApprovalRecord('g3')?.status).toBe('pending')
  })

  it('rehydration: absent plugin is skipped (never cancelled); the gate decides live vs orphaned', async () => {
    requestApproval({ approvalId: 'absent', owner: owner('complete', 'gone-plugin'), request })
    requestApproval({ approvalId: 'live', owner: owner('complete'), request })
    requestApproval({ approvalId: 'stale', owner: owner('complete', 'projects', 'archived-project'), request })
    registerPluginGate('projects', 'complete', gate({ ownerState: async (record) => (record.owner.entityId === 'archived-project' ? 'orphaned' : 'live') }).handler)

    await bootApprovals({ channels: undefined })

    expect(getApprovalRecord('absent')?.status).toBe('pending')
    expect(getApprovalRecord('live')?.status).toBe('pending')
    expect(getApprovalRecord('stale')?.status).toBe('cancelled')
  })

  it('boot registers the core kind even when no plugin registered a gate', async () => {
    requestApproval({ approvalId: 'early', owner: owner(), request })
    expect(getApprovalKind('plugin-gate')).toBeUndefined()
    await bootApprovals({ channels: undefined })
    expect(getApprovalKind('plugin-gate')).toBeDefined()
    const summary = await rehydratePendingApprovals()
    expect(summary).toMatchObject({ pending: 1, unknownKind: 0, skipped: 1, cancelled: 0 })
  })

  it('unregister removes only its own registration; teardown drops only that plugin', async () => {
    const first = gate()
    const second = gate()
    const keep = gate()
    const dropFirst = registerPluginGate('projects', 'complete', first.handler)
    registerPluginGate('projects', 'complete', second.handler) // hot reload re-registers
    registerPluginGate('messaging', 'complete', keep.handler)
    dropFirst() // the stale registration's teardown must not drop the fresh one
    requestApproval({ approvalId: 'g4', owner: owner(), request })
    await resolveApproval('g4', { option: 'approve', provenance: UI_OPERATOR })
    expect(second.onResolve).toHaveBeenCalledTimes(1)
    expect(first.onResolve).not.toHaveBeenCalled()

    unregisterPluginGates('projects')
    requestApproval({ approvalId: 'g5', owner: owner(), request })
    requestApproval({ approvalId: 'g6', owner: owner('complete', 'messaging'), request })
    await expect(resolveApproval('g5', { option: 'approve', provenance: UI_OPERATOR })).rejects.toBeInstanceOf(ApprovalKindUnavailableError)
    expect((await resolveApproval('g6', { option: 'approve', provenance: UI_OPERATOR })).status).toBe('approved')
  })

  it('the one reject-reason rule: a typed reject needs a reason when required; channel buttons and the off setting do not', async () => {
    const g = gate()
    registerPluginGate('projects', 'complete', g.handler)
    requestApproval({ approvalId: 'r1', owner: owner(), request })
    const err = await resolveApproval('r1', { option: 'reject', provenance: UI_OPERATOR }).catch((e: unknown) => e)
    expect(approvalErrorStatus(err)).toBe(400)
    expect(g.onResolve).not.toHaveBeenCalled()
    expect((await resolveApproval('r1', { option: 'reject', comment: 'Missing changelog', provenance: UI_OPERATOR })).status).toBe('rejected')

    requestApproval({ approvalId: 'r2', owner: owner(), request })
    expect((await resolveApproval('r2', { option: 'reject', provenance: discordUser('u1') })).status).toBe('rejected')

    requireRejectReason = false
    requestApproval({ approvalId: 'r3', owner: owner(), request })
    expect((await resolveApproval('r3', { option: 'reject', provenance: UI_OPERATOR })).status).toBe('rejected')
  })

  it('the record schema requires every plugin-gate owner field, taskId included', () => {
    const base = { approvalId: 'x', owner: owner(), status: 'pending', request, deliveries: [], createdAt: 'now', updatedAt: 'now' }
    expect(parseApprovalRecord(base)?.owner).toEqual(owner())
    const { taskId: _taskId, ...withoutTask } = owner()
    expect(parseApprovalRecord({ ...base, owner: withoutTask })).toBeNull()
    expect(parseApprovalRecord({ ...base, owner: { ...owner(), gateKind: '' } })).toBeNull()
  })
})
