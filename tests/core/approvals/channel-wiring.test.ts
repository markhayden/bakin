/**
 * bootApprovals: rehydrate, then ONE channel decision subscription for every
 * kind; stale buttons (resolved / unknown records) are ignored with a warn,
 * handler refusals are refused quietly, and a runtime without channels is
 * board-only.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-approvals-wiring-${Date.now()}-${randomUUID()}`)
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
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({ approvals: { channelAlerts: false, channel: 'general', requireRejectReason: true } }),
  resetSettingsCache: () => {},
}))
mock.module('../../../src/core/sse', () => ({ broadcast: () => {} }))
mock.module('../../../src/core/channel-aliases', () => ({
  resolveRuntimeChannelRef: async (_runtime: unknown, channel: string) => ({ resolved: channel }),
}))

type Listener = (event: { approvalId: string; channelId: string; response: { selectedOption: string; respondedAt: string; actor: { type: 'human'; id: string; displayName?: string }; comment?: string } }) => Promise<void> | void
let listener: Listener | null = null
const unsubscribe = mock(() => {})
const channels = {
  createApproval: async () => ({ deliveries: [] }),
  resolveApproval: async () => {},
  cancelApproval: async () => {},
  list: async () => [],
  subscribeApprovalResponses: (fn: Listener) => { listener = fn; return unsubscribe },
}
const runtime = { channels } as unknown as { channels: RuntimeChannelSurface }
mock.module('../../../src/core/app-services-store', () => ({ maybeGetAppServices: () => ({ runtime }), getAppServices: () => ({ runtime }) }))

import type { RuntimeChannelSurface } from '../../../packages/core/src/adapters/runtime/channels'
import { bootApprovals } from '../../../src/core/approvals/channel-wiring'
import { registerApprovalKind, clearApprovalKinds } from '../../../src/core/approvals/kinds'
import { ApprovalResolveError } from '../../../src/core/approvals/errors'
import { requestApproval } from '../../../src/core/approvals/service'
import { getApprovalRecord } from '../../../packages/core/src/approvals'

const owner = { kind: 'workflow-gate' as const, taskId: 't-1', workflowId: 'publish', runId: 'inst', stepId: 'review' }
const request = { title: 'Gate', body: '', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }] }
const onResolve = mock(async (_record: unknown, _decision: unknown) => {})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  listener = null
  onResolve.mockClear()
  onResolve.mockImplementation(async () => {})
  clearApprovalKinds()
  registerApprovalKind<'workflow-gate'>({ kind: 'workflow-gate', ownerState: async () => 'live', onResolve })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

const click = (approvalId: string, option: string, comment?: string) => listener!({
  approvalId,
  channelId: 'discord:1',
  response: { selectedOption: option, respondedAt: '2026-10-02T00:00:00.000Z', actor: { type: 'human', id: 'discord-mark', displayName: 'Mark' }, ...(comment ? { comment } : {}) },
})

describe('bootApprovals', () => {
  it('subscribes once and resolves a pending record from a channel decision with a channel actor', async () => {
    requestApproval({ approvalId: 'g1', owner, request })
    const off = await bootApprovals(runtime)
    expect(listener).toBeInstanceOf(Function)

    await click('g1', 'reject', 'needs work')

    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve.mock.calls[0]?.[1]).toMatchObject({ option: 'reject', comment: 'needs work', actor: { source: 'channel', id: 'discord-mark', displayName: 'Mark' } })
    expect(getApprovalRecord('g1')?.status).toBe('rejected')
    off()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('ignores stale buttons: an already-resolved record and an unknown id never throw and never re-run the handler', async () => {
    requestApproval({ approvalId: 'g2', owner, request })
    await bootApprovals(runtime)
    await click('g2', 'approve')
    await expect(click('g2', 'reject')).resolves.toBeUndefined()
    await expect(click('never-existed', 'approve')).resolves.toBeUndefined()
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(getApprovalRecord('g2')?.response?.selectedOption).toBe('approve')
  })

  it('a handler refusal is swallowed by the listener and the record stays pending', async () => {
    onResolve.mockImplementation(async () => { throw new ApprovalResolveError('gate moved on', 409) })
    requestApproval({ approvalId: 'g3', owner, request })
    await bootApprovals(runtime)
    await expect(click('g3', 'approve')).resolves.toBeUndefined()
    expect(getApprovalRecord('g3')?.status).toBe('pending')
  })

  it('a runtime without a channel layer is board-only: no subscription, a no-op unsubscribe', async () => {
    const off = await bootApprovals({ channels: undefined })
    expect(listener).toBeNull()
    expect(() => off()).not.toThrow()
  })
})
