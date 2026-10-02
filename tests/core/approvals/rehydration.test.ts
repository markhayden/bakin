/**
 * Approval rehydration (plan PR 2 T3): prune old resolved records, cancel
 * orphans per the kind's ownerState, skip 'unknown' (never cancel), leave
 * unknown kinds alone, and re-render delivery-less records only when
 * channel alerts are on.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-approvals-rehydration-${Date.now()}-${randomUUID()}`)
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
const createApproval = mock(async (args: { approvalId: string; channels: string[] }) => ({ deliveries: [{ channelId: args.channels[0], ref: `card-${args.approvalId}`, renderedAt: 'now' }] }))
const cancelApprovalOnChannel = mock(async () => {})
const runtime = { channels: { createApproval, resolveApproval: async () => {}, cancelApproval: cancelApprovalOnChannel, list: async () => [], subscribeApprovalResponses: () => () => {} } }
mock.module('../../../src/core/app-services-store', () => ({ maybeGetAppServices: () => ({ runtime }), getAppServices: () => ({ runtime }) }))

import { rehydratePendingApprovals } from '../../../src/core/approvals/rehydration'
import { registerApprovalKind, clearApprovalKinds, type ApprovalOwnerState } from '../../../src/core/approvals/kinds'
import { createApprovalRecord, getApprovalRecord, resolveApprovalRecord, updateApprovalDeliveries } from '../../../packages/core/src/approvals'

const owner = (taskId: string) => ({ kind: 'workflow-gate' as const, taskId, workflowId: 'publish', runId: 'inst', stepId: 'review' })
const request = { title: 'Gate', body: '', options: [{ id: 'approve', label: 'Approve' }] }
const states = new Map<string, ApprovalOwnerState>()

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  broadcasts.length = 0
  createApproval.mockClear()
  cancelApprovalOnChannel.mockClear()
  channelAlerts = false
  states.clear()
  clearApprovalKinds()
  registerApprovalKind<'workflow-gate'>({
    kind: 'workflow-gate',
    ownerState: async (record) => {
      const state = states.get(record.approvalId)
      if (state === undefined) throw new Error('state lookup exploded')
      return state
    },
    onResolve: async () => {},
  })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('rehydratePendingApprovals', () => {
  it('prunes old resolved records, cancels orphans, skips unknown owners and unreadable states, never cancels those', async () => {
    createApprovalRecord({ approvalId: 'old', owner: owner('t-old'), request, createdAt: '2026-01-01T00:00:00.000Z' })
    resolveApprovalRecord('old', { selectedOption: 'approve', respondedAt: '2026-01-02T00:00:00.000Z', actor: { type: 'human', id: 'mark' } })
    createApprovalRecord({ approvalId: 'orphan', owner: owner('t-orphan'), request })
    updateApprovalDeliveries('orphan', [{ channelId: 'c', ref: 'm', renderedAt: 'now' }])
    createApprovalRecord({ approvalId: 'unknown', owner: owner('t-unknown'), request })
    createApprovalRecord({ approvalId: 'exploding', owner: owner('t-boom'), request })
    createApprovalRecord({ approvalId: 'live', owner: owner('t-live'), request })
    states.set('orphan', 'orphaned')
    states.set('unknown', 'unknown')
    states.set('live', 'live')

    const summary = await rehydratePendingApprovals()

    expect(summary).toEqual({ pending: 4, rerendered: 0, skipped: 3, failed: 0, pruned: 1, cancelled: 1, unknownKind: 0 })
    expect(getApprovalRecord('old')).toBeNull()
    expect(getApprovalRecord('orphan')?.status).toBe('cancelled')
    expect(cancelApprovalOnChannel).toHaveBeenCalledWith(expect.objectContaining({ approvalId: 'orphan' }))
    expect(getApprovalRecord('unknown')?.status).toBe('pending')
    expect(getApprovalRecord('exploding')?.status).toBe('pending')
    expect(getApprovalRecord('live')?.status).toBe('pending')
    expect(createApproval).not.toHaveBeenCalled() // alerts off: no re-render
  })

  it('re-renders delivery-less live records only when channel alerts are on, and counts a failed render honestly', async () => {
    channelAlerts = true
    createApprovalRecord({ approvalId: 'bare', owner: owner('t-1'), request })
    createApprovalRecord({ approvalId: 'has-card', owner: owner('t-2'), request })
    updateApprovalDeliveries('has-card', [{ channelId: 'c', ref: 'm', renderedAt: 'now' }])
    createApprovalRecord({ approvalId: 'bare-fails', owner: owner('t-3'), request })
    states.set('bare', 'live')
    states.set('has-card', 'live')
    states.set('bare-fails', 'live')
    createApproval.mockImplementation(async (args) => {
      if (args.approvalId === 'bare-fails') throw new Error('discord down')
      return { deliveries: [{ channelId: args.channels[0], ref: `card-${args.approvalId}`, renderedAt: 'now' }] }
    })

    const summary = await rehydratePendingApprovals()

    expect(summary).toMatchObject({ pending: 3, rerendered: 1, failed: 1, skipped: 1, cancelled: 0 })
    expect(getApprovalRecord('bare')?.deliveries).toEqual([{ channelId: 'resolved:general', ref: 'card-bare', renderedAt: 'now' }])
    expect(getApprovalRecord('bare-fails')?.deliveries).toEqual([])
  })

  it('leaves records of an unregistered kind untouched', async () => {
    clearApprovalKinds()
    createApprovalRecord({ approvalId: 'no-kind', owner: owner('t-1'), request })
    const summary = await rehydratePendingApprovals()
    expect(summary).toMatchObject({ pending: 1, unknownKind: 1, cancelled: 0 })
    expect(getApprovalRecord('no-kind')?.status).toBe('pending')
  })
})
