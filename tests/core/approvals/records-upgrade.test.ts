/**
 * One-shot legacy approval record migration (plan review R5a): the workflows
 * plugin's gate-only records move into the core store as kind
 * 'workflow-gate' with status, deliveries and response intact.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-approvals-records-upgrade-${Date.now()}-${randomUUID()}`)
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

import { legacyApprovalsDir, upgradeApprovalRecords } from '../../../src/core/approvals/records-upgrade'
import { getApprovalRecord, listApprovalRecords, createApprovalRecord } from '../../../packages/core/src/approvals'

const legacy = (approvalId: string, overrides: Record<string, unknown> = {}) => ({
  approvalId,
  owner: { workflowId: 'publish', runId: 'inst-1', stepId: 'review', taskId: 't-1' },
  status: 'pending',
  request: { title: 'Gate', body: 'Review', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject', variant: 'destructive' }] },
  deliveries: [{ channelId: 'discord:1', ref: 'msg-1', renderedAt: '2026-10-01T00:00:00.000Z' }],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
})

function seed(name: string, value: unknown): void {
  const dir = legacyApprovalsDir(testDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2))
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('upgradeApprovalRecords', () => {
  it('is a noop when the legacy directory does not exist', () => {
    expect(upgradeApprovalRecords(testDir)).toEqual({ status: 'noop', migrated: 0, alreadyPresent: 0, left: 0 })
  })

  it('migrates every record as kind workflow-gate with deliveries and decisions intact, then removes the old dir', () => {
    seed('pending.json', legacy('gate-pending'))
    seed('resolved.json', legacy('gate-resolved', {
      status: 'approved',
      response: { selectedOption: 'approve', respondedAt: '2026-10-01T01:00:00.000Z', actor: { type: 'human', id: 'mark' } },
      resolvedAt: '2026-10-01T01:00:00.000Z',
    }))

    expect(upgradeApprovalRecords(testDir)).toEqual({ status: 'migrated', migrated: 2, alreadyPresent: 0, left: 0 })

    const pending = getApprovalRecord('gate-pending', testDir)
    expect(pending?.owner).toEqual({ kind: 'workflow-gate', taskId: 't-1', workflowId: 'publish', runId: 'inst-1', stepId: 'review' })
    expect(pending?.status).toBe('pending')
    expect(pending?.deliveries).toEqual([{ channelId: 'discord:1', ref: 'msg-1', renderedAt: '2026-10-01T00:00:00.000Z' }])
    const resolved = getApprovalRecord('gate-resolved', testDir)
    expect(resolved?.status).toBe('approved')
    expect(resolved?.response?.actor.id).toBe('mark')
    expect(resolved?.resolvedAt).toBe('2026-10-01T01:00:00.000Z')
    expect(existsSync(legacyApprovalsDir(testDir))).toBe(false)

    // Re-run: nothing to do.
    expect(upgradeApprovalRecords(testDir)).toEqual({ status: 'noop', migrated: 0, alreadyPresent: 0, left: 0 })
  })

  it('never overwrites a record the core store already holds, and leaves unmappable files (and the dir) in place', () => {
    createApprovalRecord({
      approvalId: 'gate-dup',
      owner: { kind: 'workflow-gate', taskId: 't-9', workflowId: 'publish', runId: 'inst-9', stepId: 'review' },
      request: { title: 'Already here', body: '', options: [] },
    }, testDir)
    seed('dup.json', legacy('gate-dup'))
    seed('no-task.json', legacy('gate-no-task', { owner: { workflowId: 'publish', runId: 'inst-2', stepId: 'review' } }))
    seed('broken.json', '{ not json')
    seed('ok.json', legacy('gate-ok'))

    expect(upgradeApprovalRecords(testDir)).toEqual({ status: 'migrated', migrated: 1, alreadyPresent: 1, left: 2 })
    expect(getApprovalRecord('gate-dup', testDir)?.request.title).toBe('Already here')
    expect(listApprovalRecords({}, testDir).map((r) => r.approvalId).sort()).toEqual(['gate-dup', 'gate-ok'])
    expect(readdirSync(legacyApprovalsDir(testDir)).sort()).toEqual(['broken.json', 'no-task.json'])
  })
})
