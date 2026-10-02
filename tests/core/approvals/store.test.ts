/**
 * Core approval record store (spec D6/D7, plan PR 2 T1): ONE durable record
 * per approval under <contentDir>/approvals/, with a typed owner union
 * (workflow-gate | health-repair | health-navigate), zod-validated on read,
 * and a compare-and-set resolve so a second resolver gets a typed error
 * instead of a double resolution (plan review R1: simultaneous clicks).
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-approvals-store-${Date.now()}-${randomUUID()}`)
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

import {
  createApprovalRecord,
  getApprovalRecord,
  listApprovalRecords,
  updateApprovalDeliveries,
  resolveApprovalRecord,
  cancelApprovalRecord,
  deleteApprovalRecord,
  pruneResolvedApprovalRecords,
  findPendingApproval,
  approvalRefFromRecord,
  ApprovalNotPendingError,
  type ApprovalOwner,
  type ApprovalRecord,
} from '../../../packages/core/src/approvals'

const gateOwner: ApprovalOwner = { kind: 'workflow-gate', taskId: 't-1', workflowId: 'publish', runId: 'inst-1', stepId: 'review' }
const repairOwner: ApprovalOwner = {
  kind: 'health-repair',
  taskId: 't-2',
  requestId: 'repair-1',
  incidentIds: ['health:search:search-dark'],
  proposal: {
    reportId: 'health-report-1',
    observationIds: ['health.search:engine'],
    items: [{ actionId: 'search-rebuild', itemId: 'search-rebuild:bakin_tasks', safety: 'destructive', changes: [{ kind: 'search', target: 'bakin_tasks', action: 'rebuild', description: 'Drop and rebuild the table' }] }],
  },
}
const navigateOwner: ApprovalOwner = { kind: 'health-navigate', taskId: 't-3', requestId: 'repair-2', incidentIds: ['tasks:tasks:order-invalid'], href: '/tasks' }

const request = (title = 'Approve?') => ({
  title,
  body: 'Details',
  options: [{ id: 'approve', label: 'Approve', variant: 'primary' as const }, { id: 'reject', label: 'Reject', variant: 'destructive' as const }],
})
const human = { type: 'human' as const, id: 'mark' }

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('create / get / list', () => {
  it('creates a pending record under <contentDir>/approvals with a URL-safe filename', () => {
    const record = createApprovalRecord({ approvalId: 'gate:t-1:review', owner: gateOwner, request: request() })
    expect(record.status).toBe('pending')
    expect(record.deliveries).toEqual([])
    expect(record.owner).toEqual(gateOwner)
    expect(existsSync(join(testDir, 'approvals', `${encodeURIComponent('gate:t-1:review')}.json`))).toBe(true)
    expect(getApprovalRecord('gate:t-1:review')?.request.title).toBe('Approve?')
  })

  it('is idempotent: a second create for a pending id refreshes owner + request; a resolved id is returned untouched', () => {
    createApprovalRecord({ approvalId: 'a', owner: gateOwner, request: request('v1') })
    const refreshed = createApprovalRecord({ approvalId: 'a', owner: gateOwner, request: request('v2') })
    expect(refreshed.request.title).toBe('v2')
    resolveApprovalRecord('a', { selectedOption: 'approve', respondedAt: new Date().toISOString(), actor: human })
    const again = createApprovalRecord({ approvalId: 'a', owner: gateOwner, request: request('v3') })
    expect(again.status).toBe('approved')
    expect(again.request.title).toBe('v2')
  })

  it('lists with status, taskIds and kind filters', () => {
    createApprovalRecord({ approvalId: 'g', owner: gateOwner, request: request() })
    createApprovalRecord({ approvalId: 'r', owner: repairOwner, request: request() })
    createApprovalRecord({ approvalId: 'n', owner: navigateOwner, request: request() })
    resolveApprovalRecord('n', { selectedOption: 'dismiss', respondedAt: new Date().toISOString(), actor: human })

    expect(listApprovalRecords().map((r) => r.approvalId).sort()).toEqual(['g', 'n', 'r'])
    expect(listApprovalRecords({ status: 'pending' }).map((r) => r.approvalId).sort()).toEqual(['g', 'r'])
    expect(listApprovalRecords({ taskIds: ['t-2', 't-3'] }).map((r) => r.approvalId).sort()).toEqual(['n', 'r'])
    expect(listApprovalRecords({ kind: 'health-repair' }).map((r) => r.approvalId)).toEqual(['r'])
    expect(listApprovalRecords({ status: 'pending', taskIds: ['t-3'] })).toEqual([])
  })

  it('skips an unreadable or schema-invalid file instead of failing the listing, and never deletes it', () => {
    createApprovalRecord({ approvalId: 'good', owner: gateOwner, request: request() })
    const dir = join(testDir, 'approvals')
    writeFileSync(join(dir, 'broken.json'), '{ not json', 'utf-8')
    writeFileSync(join(dir, 'wrong-shape.json'), JSON.stringify({ approvalId: 'wrong-shape', owner: { kind: 'mystery' }, status: 'pending' }), 'utf-8')
    expect(listApprovalRecords().map((r) => r.approvalId)).toEqual(['good'])
    expect(getApprovalRecord('wrong-shape')).toBeNull()
    expect(readdirSync(dir)).toHaveLength(3) // nothing deleted — the operator can inspect the bad file
  })
})

describe('deliveries', () => {
  it('replaces deliveries while pending and refuses once resolved', () => {
    createApprovalRecord({ approvalId: 'd', owner: gateOwner, request: request() })
    const delivery = { channelId: 'discord:1', ref: 'msg-1', renderedAt: new Date().toISOString() }
    expect(updateApprovalDeliveries('d', [delivery])?.deliveries).toEqual([delivery])
    resolveApprovalRecord('d', { selectedOption: 'approve', respondedAt: new Date().toISOString(), actor: human })
    expect(updateApprovalDeliveries('d', [])?.deliveries).toEqual([delivery])
    expect(updateApprovalDeliveries('missing', [])).toBeNull()
  })
})

describe('resolve (compare-and-set)', () => {
  it('maps approve/apply to approved and reject/dismiss to rejected, keeping the raw option on the response', () => {
    for (const [option, status] of [['approve', 'approved'], ['apply', 'approved'], ['reject', 'rejected'], ['dismiss', 'rejected'], ['acknowledge', 'approved']] as const) {
      createApprovalRecord({ approvalId: `opt-${option}`, owner: repairOwner, request: request() })
      const resolved = resolveApprovalRecord(`opt-${option}`, { selectedOption: option, respondedAt: '2026-10-02T00:00:00.000Z', actor: human, comment: 'why' })
      expect(resolved.status).toBe(status)
      expect(resolved.response?.selectedOption).toBe(option)
      expect(resolved.response?.comment).toBe('why')
      expect(resolved.resolvedAt).toBe('2026-10-02T00:00:00.000Z')
    }
  })

  it('a second resolver is refused with ApprovalNotPendingError and the first decision stands', () => {
    createApprovalRecord({ approvalId: 'race', owner: repairOwner, request: request() })
    resolveApprovalRecord('race', { selectedOption: 'apply', respondedAt: new Date().toISOString(), actor: human })
    expect(() => resolveApprovalRecord('race', { selectedOption: 'dismiss', respondedAt: new Date().toISOString(), actor: { type: 'human', id: 'discord-user' } }))
      .toThrow(ApprovalNotPendingError)
    expect(getApprovalRecord('race')?.response?.selectedOption).toBe('apply')
    expect(getApprovalRecord('race')?.response?.actor.id).toBe('mark')
  })

  it('resolving an unknown id throws ApprovalNotFoundError', async () => {
    const { ApprovalNotFoundError } = await import('../../../packages/core/src/approvals')
    expect(() => resolveApprovalRecord('nope', { selectedOption: 'approve', respondedAt: new Date().toISOString(), actor: human })).toThrow(ApprovalNotFoundError)
  })
})

describe('cancel / delete / prune', () => {
  it('cancel records the reason as a system response; cancelling a resolved record is a no-op', () => {
    createApprovalRecord({ approvalId: 'c', owner: gateOwner, request: request() })
    const cancelled = cancelApprovalRecord('c', 'plan-changed')
    expect(cancelled?.status).toBe('cancelled')
    expect(cancelled?.response).toMatchObject({ selectedOption: 'cancel', comment: 'plan-changed', actor: { id: 'system' } })
    expect(cancelApprovalRecord('c', 'again')?.response?.comment).toBe('plan-changed')
    expect(cancelApprovalRecord('missing')).toBeNull()
  })

  it('delete removes the file; prune drops only resolved records older than the cutoff', () => {
    createApprovalRecord({ approvalId: 'old-pending', owner: gateOwner, request: request(), createdAt: '2026-01-01T00:00:00.000Z' })
    createApprovalRecord({ approvalId: 'old-resolved', owner: gateOwner, request: request(), createdAt: '2026-01-01T00:00:00.000Z' })
    resolveApprovalRecord('old-resolved', { selectedOption: 'approve', respondedAt: '2026-01-02T00:00:00.000Z', actor: human })
    createApprovalRecord({ approvalId: 'fresh-resolved', owner: gateOwner, request: request() })
    resolveApprovalRecord('fresh-resolved', { selectedOption: 'reject', respondedAt: new Date().toISOString(), actor: human })

    expect(pruneResolvedApprovalRecords(7 * 24 * 3_600_000)).toBe(1)
    expect(listApprovalRecords().map((r) => r.approvalId).sort()).toEqual(['fresh-resolved', 'old-pending'])
    expect(deleteApprovalRecord('old-pending')).toBe(true)
    expect(deleteApprovalRecord('old-pending')).toBe(false)
  })
})

describe('lookup helpers', () => {
  it('findPendingApproval returns the newest pending match for a predicate', () => {
    createApprovalRecord({ approvalId: 'first', owner: gateOwner, request: request(), createdAt: '2026-10-01T00:00:00.000Z' })
    createApprovalRecord({ approvalId: 'second', owner: gateOwner, request: request(), createdAt: '2026-10-02T00:00:00.000Z' })
    createApprovalRecord({ approvalId: 'other-task', owner: { ...gateOwner, taskId: 'elsewhere' }, request: request(), createdAt: '2026-10-03T00:00:00.000Z' })
    const found = findPendingApproval((r: ApprovalRecord) => r.owner.kind === 'workflow-gate' && r.owner.taskId === 't-1')
    expect(found?.approvalId).toBe('second')
    resolveApprovalRecord('second', { selectedOption: 'approve', respondedAt: new Date().toISOString(), actor: human })
    expect(findPendingApproval((r) => r.owner.taskId === 't-1')?.approvalId).toBe('first')
  })

  it('approvalRefFromRecord carries id + deliveries, undefined for nothing', () => {
    const record = createApprovalRecord({ approvalId: 'ref', owner: navigateOwner, request: request() })
    expect(approvalRefFromRecord(record)).toEqual({ approvalId: 'ref', deliveries: [] })
    expect(approvalRefFromRecord(null)).toBeUndefined()
  })
})
