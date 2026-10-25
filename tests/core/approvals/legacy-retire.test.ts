/**
 * Raw retirement of pending legacy Health approvals (self-healing 1.6, plan
 * R3 N3 / R4 R4.1): rc.42-shaped files on disk, intent receipt BEFORE the
 * cancel, record cancelled through the store or raw, Discord card edited,
 * receipts resumed on the next boot/reconnect regardless of record status,
 * one audit row with counts, idempotent.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-legacy-retire-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, audit: join(testDir, 'audit.jsonl'), db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
mock.module('../../../src/core/sse', () => ({ broadcast: () => {} }))
mock.module('../../../src/core/app-services-store', () => ({ maybeGetAppServices: () => undefined, getAppServices: () => { throw new Error('no services') } }))

import { getApprovalRecord } from '../../../packages/core/src/approvals'
import {
  LEGACY_RETIRE_AUDIT_EVENT,
  LEGACY_RETIRE_REASON,
  MAX_APPROVAL_FILE_BYTES,
  MAX_RETIREMENTS_PER_BATCH,
  RECEIPT_JOURNAL_CHUNK_BYTES,
  legacyApprovalArchiveRoot,
  openRetirementReceipts,
  readRetirementReceipts,
  resumeRetirementReceipts,
  retireLegacyHealthApprovals,
  retirementReceiptsPath,
  type LegacyRetireDeps,
} from '../../../src/core/approvals/legacy-retire'

const approvalsDir = join(testDir, 'approvals')
const delivery = { channelId: 'discord:1', ref: 'msg-1', renderedAt: '2026-10-23T10:00:00.000Z' }

/** rc.42-shaped records: no schemaVersion, repair proposals still carry `safety`. */
function legacyNavigate(approvalId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    approvalId,
    owner: { kind: 'health-navigate', taskId: 't-nav', requestId: 'repair-nav', incidentIds: ['team:routing:runtime-credentials'], href: '/runtime?tab=overview' },
    status: 'pending',
    request: { title: 'Review runtime credentials', body: 'The runtime has no usable LLM credentials.', options: [{ id: 'approve', label: 'Reviewed' }, { id: 'dismiss', label: 'Dismiss' }] },
    deliveries: [delivery],
    createdAt: '2026-10-23T10:00:00.000Z',
    updatedAt: '2026-10-23T10:00:00.000Z',
    ...over,
  }
}

function legacyRepair(approvalId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    approvalId,
    owner: {
      kind: 'health-repair', taskId: 't-rep', requestId: 'repair-1', incidentIds: ['health:search:unclaimed-tables'],
      proposal: { reportId: 'r1', observationIds: ['health.search-consistency:unclaimed'], items: [{ actionId: 'search-drop-unclaimed-tables', itemId: 'drop:bakin_tasks_v1', safety: 'destructive', changes: [{ kind: 'other', target: 'bakin_tasks_v1', action: 'delete', description: 'Drop the table.' }] }] },
    },
    status: 'pending',
    request: { title: 'Drop unclaimed tables', body: 'Approve the drop.', options: [{ id: 'approve', label: 'Apply' }, { id: 'reject', label: 'Keep' }] },
    deliveries: [{ ...delivery, ref: 'msg-2' }],
    createdAt: '2026-10-23T10:00:00.000Z',
    updatedAt: '2026-10-23T10:00:00.000Z',
    ...over,
  }
}

function writeApproval(record: Record<string, unknown>): void {
  mkdirSync(approvalsDir, { recursive: true })
  writeFileSync(join(approvalsDir, `${encodeURIComponent(String(record.approvalId))}.json`), JSON.stringify(record))
}

/** A settled legacy record lives in the archive after the pass that settled it. */
function readSettled(approvalId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(legacyApprovalArchiveRoot(testDir), `${encodeURIComponent(approvalId)}.json`), 'utf-8')) as Record<string, unknown>
}

function readRaw(approvalId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(approvalsDir, `${encodeURIComponent(approvalId)}.json`), 'utf-8')) as Record<string, unknown>
}

function auditRows(): Array<{ event: string; data: Record<string, unknown> }> {
  const path = join(testDir, 'audit.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { event: string; data: Record<string, unknown> })
}

let clock = 0
const completedTasks: string[] = []
// Like the real task store: a task completed once is done from then on.
const tasks: LegacyRetireDeps['tasks'] = { complete: async (taskId) => { if (taskId.startsWith('done-') || completedTasks.includes(taskId)) return 'skipped'; completedTasks.push(taskId); return 'completed' } }
const deps = (channels: LegacyRetireDeps['channels']): LegacyRetireDeps => ({ channels, tasks, now: () => `2026-10-24T00:00:${String(clock++).padStart(2, '0')}.000Z` })
const workingChannels = () => {
  const calls: Array<{ approvalId: string; deliveries: unknown; reason?: string }> = []
  const surface = { cancelApproval: async (args: { approvalId: string; deliveries: unknown; reason?: string }) => { calls.push(args) } }
  return { calls, channels: () => surface }
}
const failingChannels = (message: string) => () => ({ cancelApproval: async () => { throw new Error(message) } })

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  clock = 0
  completedTasks.length = 0
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('retireLegacyHealthApprovals', () => {
  it('retires pending navigate + repair records, edits their cards, leaves everything else untouched, audits once, and is idempotent', async () => {
    writeApproval(legacyNavigate('nav-1'))
    writeApproval(legacyRepair('rep-1'))
    writeApproval(legacyNavigate('nav-done', { status: 'approved', resolvedAt: '2026-10-23T11:00:00.000Z', response: { selectedOption: 'approve', respondedAt: '2026-10-23T11:00:00.000Z' } }))
    writeApproval(legacyRepair('rep-v2', { schemaVersion: 2 }))
    writeApproval({ approvalId: 'gate-1', owner: { kind: 'workflow-gate', taskId: 't-g', workflowId: 'w', runId: 'r', stepId: 's' }, status: 'pending', request: { title: 'Gate', body: 'b', options: [] }, deliveries: [], createdAt: 'x', updatedAt: 'x' })
    const { calls, channels } = workingChannels()

    const summary = await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(channels) })
    // The navigate record still parses → store cancel; the rc.42 repair record (proposal items carry `safety`,
    // not the cutover's effects/mode) no longer parses → raw cancel. Both end cancelled.
    expect(summary).toMatchObject({ selected: 2, cancelledViaStore: 1, cancelledRaw: 1, done: 2, editFailed: 0, resumed: 0, unreadable: 0 })

    // Cancelled through the store: the current schema's cancel write, with the retirement reason as the comment.
    // Settled in this pass → archived (bytes intact): cancelled through the store, or raw, and the long-resolved legacy record.
    expect(readSettled('nav-1')).toMatchObject({ status: 'cancelled', response: { selectedOption: 'cancel', comment: LEGACY_RETIRE_REASON } })
    expect(readSettled('rep-1')).toMatchObject({ status: 'cancelled', retiredBy: 'legacy-retire' })
    expect(readSettled('nav-done').status).toBe('approved')
    expect(getApprovalRecord('nav-1', testDir)).toBeNull() // no longer in the live directory
    // Untouched: schemaVersion 2, and a workflow gate.
    expect(readRaw('rep-v2').status).toBe('pending')
    expect(readRaw('gate-1').status).toBe('pending')
    // The cards were edited with the receipt's delivery and reason.
    expect(calls.map((c) => c.approvalId).sort()).toEqual(['nav-1', 'rep-1'])
    expect(calls.find((c) => c.approvalId === 'rep-1')).toMatchObject({ deliveries: [{ channelId: 'discord:1', ref: 'msg-2' }], reason: LEGACY_RETIRE_REASON })
    // Receipts carried to done; one audit row with the counts.
    const receipts = readRetirementReceipts(testDir)
    expect(receipts.get('nav-1')).toMatchObject({ state: 'done', deliveries: [{ channelId: 'discord:1', messageId: 'msg-1', state: 'done', attempts: 1 }], attempts: 1 })
    expect(openRetirementReceipts(testDir)).toEqual([])
    const rows = auditRows().filter((row) => row.event === LEGACY_RETIRE_AUDIT_EVENT)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.data).toMatchObject({ selected: 2, done: 2 })

    // Idempotent: a second pass selects nothing and stays quiet.
    const again = await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(channels) })
    expect(again).toMatchObject({ selected: 0, resumed: 0, done: 0 })
    expect(calls).toHaveLength(2)
    expect(auditRows().filter((row) => row.event === LEGACY_RETIRE_AUDIT_EVENT)).toHaveLength(1)
  })

  it('a record that does not parse under the current schema is cancelled raw, keeping its fields and marking who retired it', async () => {
    // rc.42 could write a health-repair owner the current schema refuses (no proposal) — the schema skips it, retirement must not.
    writeApproval(legacyRepair('rep-raw', { owner: { kind: 'health-repair', taskId: 't', requestId: 'r', incidentIds: ['x'] } }))
    const { channels } = workingChannels()
    const summary = await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(channels) })
    expect(summary).toMatchObject({ selected: 1, cancelledViaStore: 0, cancelledRaw: 1, done: 1 })
    const raw = readSettled('rep-raw')
    expect(raw).toMatchObject({ status: 'cancelled', retiredBy: 'legacy-retire', owner: { kind: 'health-repair', taskId: 't' }, response: { selectedOption: 'cancel', comment: LEGACY_RETIRE_REASON } })
    expect(typeof raw.resolvedAt).toBe('string')
  })

  it('an approval that never reached a channel is done right after the cancel', async () => {
    writeApproval(legacyNavigate('nav-board-only', { deliveries: [] }))
    const { calls, channels } = workingChannels()
    const summary = await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(channels) })
    expect(summary).toMatchObject({ selected: 1, done: 1, editFailed: 0 })
    expect(calls).toHaveLength(0)
    expect(readRetirementReceipts(testDir).get('nav-board-only')).toMatchObject({ state: 'done', deliveries: [], attempts: 0 })
  })

  it('a failing Discord edit leaves the receipt edit-failed with the error; the next reconnect retries it to done', async () => {
    writeApproval(legacyNavigate('nav-2'))
    const first = await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(failingChannels('Discord 503: gateway unavailable')) })
    expect(first).toMatchObject({ selected: 1, cancelledViaStore: 1, done: 0, editFailed: 1 })
    expect(getApprovalRecord('nav-2', testDir)?.status).toBe('cancelled') // cancelled regardless of the card
    expect(readRetirementReceipts(testDir).get('nav-2')).toMatchObject({ state: 'edit-failed', attempts: 1, lastError: 'Discord 503: gateway unavailable', deliveries: [{ messageId: 'msg-1', state: 'edit-failed', attempts: 1, lastError: 'Discord 503: gateway unavailable' }] })
    expect(openRetirementReceipts(testDir).map((r) => r.approvalId)).toEqual(['nav-2'])

    // Bridge still down: another honest failure, attempts climb.
    const stillDown = await resumeRetirementReceipts({ contentDir: testDir, deps: deps(() => undefined) })
    expect(stillDown).toEqual({ resumed: 1, done: 0, editFailed: 1 })
    expect(readRetirementReceipts(testDir).get('nav-2')).toMatchObject({ state: 'edit-failed', attempts: 2, lastError: expect.stringContaining('unavailable') })

    // Reconnect: the edit lands, the receipt is done, and nothing is re-cancelled.
    const { calls, channels } = workingChannels()
    const back = await resumeRetirementReceipts({ contentDir: testDir, deps: deps(channels) })
    expect(back).toEqual({ resumed: 1, done: 1, editFailed: 0 })
    expect(calls).toEqual([{ approvalId: 'nav-2', deliveries: [{ channelId: 'discord:1', ref: 'msg-1', renderedAt: expect.any(String) }], reason: LEGACY_RETIRE_REASON }])
    expect(readRetirementReceipts(testDir).get('nav-2')).toMatchObject({ state: 'done', attempts: 3 })
    expect(openRetirementReceipts(testDir)).toEqual([])
  })

  it('a crash right after the intent receipt (record still pending, no edit) is recovered by the next boot', async () => {
    writeApproval(legacyNavigate('nav-crash'))
    // The intent line is on disk; the process died before the cancel.
    mkdirSync(join(testDir, 'health'), { recursive: true })
    writeFileSync(retirementReceiptsPath(testDir), `${JSON.stringify({ approvalId: 'nav-crash', deliveries: [{ channelId: 'discord:1', messageId: 'msg-1', state: 'pending', attempts: 0 }], state: 'retiring', reason: LEGACY_RETIRE_REASON, startedAt: '2026-10-23T23:59:59.000Z', updatedAt: '2026-10-23T23:59:59.000Z', attempts: 0 })}\n`)
    const { calls, channels } = workingChannels()

    const summary = await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(channels) })
    expect(summary).toMatchObject({ resumed: 1, done: 1, selected: 0 }) // resumed, never selected twice
    expect(readSettled('nav-crash').status).toBe('cancelled') // cancelled, receipt done, archived in the same pass
    expect(calls).toHaveLength(1)
    expect(readRetirementReceipts(testDir).get('nav-crash')).toMatchObject({ state: 'done', attempts: 1 })
    expect(auditRows().filter((row) => row.event === LEGACY_RETIRE_AUDIT_EVENT)[0]!.data).toMatchObject({ resumed: 1, selected: 0 })
  })

  it('a crash after the cancel but before the edit resumes from the retiring receipt without touching the record again', async () => {
    writeApproval(legacyNavigate('nav-crash-2', { status: 'cancelled', resolvedAt: '2026-10-23T23:59:59.000Z', response: { selectedOption: 'cancel', respondedAt: '2026-10-23T23:59:59.000Z', comment: LEGACY_RETIRE_REASON } }))
    mkdirSync(join(testDir, 'health'), { recursive: true })
    writeFileSync(retirementReceiptsPath(testDir), `${JSON.stringify({ approvalId: 'nav-crash-2', deliveries: [{ channelId: 'discord:1', messageId: 'msg-1', state: 'pending', attempts: 0 }], state: 'retiring', reason: LEGACY_RETIRE_REASON, startedAt: '2026-10-23T23:59:59.000Z', updatedAt: '2026-10-23T23:59:59.000Z', attempts: 0 })}\n`)
    const { calls, channels } = workingChannels()
    const before = readRaw('nav-crash-2')
    const result = await resumeRetirementReceipts({ contentDir: testDir, deps: deps(channels) })
    expect(result).toEqual({ resumed: 1, done: 1, editFailed: 0 })
    expect(calls).toHaveLength(1)
    expect(readRaw('nav-crash-2')).toEqual(before)
  })

  it('an unreadable approval file is counted and left alone; a receipt line that is not JSON is skipped', async () => {
    mkdirSync(approvalsDir, { recursive: true })
    writeFileSync(join(approvalsDir, 'broken.json'), '{ not json')
    writeApproval(legacyNavigate('nav-ok'))
    mkdirSync(join(testDir, 'health'), { recursive: true })
    writeFileSync(retirementReceiptsPath(testDir), 'garbage line\n')
    const { channels } = workingChannels()
    const summary = await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(channels) })
    expect(summary).toMatchObject({ selected: 1, unreadable: 1, done: 1 })
    expect(readFileSync(join(approvalsDir, 'broken.json'), 'utf-8')).toBe('{ not json')
  })

  it('two delivered cards are tracked on their own: one failed edit keeps the receipt open, and the reconnect retries ONLY that card', async () => {
    writeApproval(legacyNavigate('nav-two', { deliveries: [delivery, { ...delivery, channelId: 'discord:2', ref: 'msg-9' }] }))
    const flaky = () => ({ cancelApproval: async (args: { deliveries: Array<{ channelId: string }> }) => { if (args.deliveries[0]!.channelId === 'discord:2') throw new Error('Discord 403: missing access') } })
    const first = await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(flaky) })
    expect(first).toMatchObject({ selected: 1, done: 0, editFailed: 1 })
    expect(readRetirementReceipts(testDir).get('nav-two')).toMatchObject({
      state: 'edit-failed', attempts: 1, lastError: 'Discord 403: missing access',
      deliveries: [{ channelId: 'discord:1', state: 'done', attempts: 1 }, { channelId: 'discord:2', state: 'edit-failed', attempts: 1, lastError: 'Discord 403: missing access' }],
    })

    const { calls, channels } = workingChannels()
    expect(await resumeRetirementReceipts({ contentDir: testDir, deps: deps(channels) })).toEqual({ resumed: 1, done: 1, editFailed: 0 })
    expect(calls).toEqual([{ approvalId: 'nav-two', deliveries: [{ channelId: 'discord:2', ref: 'msg-9', renderedAt: expect.any(String) }], reason: LEGACY_RETIRE_REASON }])
    const settled = readRetirementReceipts(testDir).get('nav-two')!
    expect(settled).toMatchObject({ state: 'done', attempts: 2, deliveries: [{ channelId: 'discord:1', attempts: 1 }, { channelId: 'discord:2', state: 'done', attempts: 2 }] })
    expect(settled.lastError).toBeUndefined()
    expect(settled.deliveries[1]!.lastError).toBeUndefined()
  })

  it('the reader is bounded but complete: an oversized record is unreadable and untouched, and ONE pass drains more than a batch of legacy records in bounded batches (Codex r2 N5)', async () => {
    mkdirSync(approvalsDir, { recursive: true })
    const huge = JSON.stringify(legacyNavigate('nav-huge', { request: { title: 'x'.repeat(MAX_APPROVAL_FILE_BYTES), body: 'b', options: [] } }))
    writeFileSync(join(approvalsDir, 'nav-huge.json'), huge)
    for (let i = 0; i < MAX_RETIREMENTS_PER_BATCH + 1; i += 1) writeApproval(legacyNavigate(`nav-${i}`, { deliveries: [] }))
    const { channels } = workingChannels()

    // The production caller (startup recovery) makes ONE call; nothing waits for another restart.
    const summary = await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(channels) })
    expect(summary).toMatchObject({ selected: MAX_RETIREMENTS_PER_BATCH + 1, batches: 2, unreadable: 1, done: MAX_RETIREMENTS_PER_BATCH + 1 })
    expect(readFileSync(join(approvalsDir, 'nav-huge.json'), 'utf-8')).toBe(huge)
    expect(openRetirementReceipts(testDir)).toEqual([])
    expect(readRetirementReceipts(testDir).size).toBe(MAX_RETIREMENTS_PER_BATCH + 1)
    expect(auditRows().filter((row) => row.event === LEGACY_RETIRE_AUDIT_EVENT)).toHaveLength(1)

    const again = await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(channels) })
    expect(again).toMatchObject({ selected: 0, batches: 0, resumed: 0 })
  })

  it('the journal is streamed, never truncated: an unfinished receipt ahead of a long tail of finished ones is still resumed (Codex r2 N4)', async () => {
    writeApproval(legacyNavigate('nav-early', { status: 'cancelled' }))
    mkdirSync(join(testDir, 'health'), { recursive: true })
    const early = JSON.stringify({ approvalId: 'nav-early', deliveries: [{ channelId: 'discord:1', messageId: 'msg-1', state: 'pending', attempts: 0 }], state: 'retiring', reason: LEGACY_RETIRE_REASON, startedAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z', attempts: 0 })
    const finished = (i: number) => JSON.stringify({ approvalId: `done-${i}`, deliveries: [], state: 'done', reason: LEGACY_RETIRE_REASON, startedAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z', attempts: 0, pad: 'p'.repeat(2_000) })
    const tailLines = Math.ceil((3 * RECEIPT_JOURNAL_CHUNK_BYTES) / 2_050) // well past several read chunks
    const overlong = `{"approvalId":"too-long","state":"retiring","deliveries":[],"pad":"${'z'.repeat(RECEIPT_JOURNAL_CHUNK_BYTES + 10)}"}`
    writeFileSync(retirementReceiptsPath(testDir), [early, overlong, ...Array.from({ length: tailLines }, (_, i) => finished(i))].join('\n') + '\n')

    const receipts = readRetirementReceipts(testDir)
    expect(receipts.size).toBe(tailLines + 1) // the over-long line is skipped, nothing else is lost
    expect(receipts.get('nav-early')).toMatchObject({ state: 'retiring' })
    expect(openRetirementReceipts(testDir).map((r) => r.approvalId)).toEqual(['nav-early'])

    const { calls, channels } = workingChannels()
    expect(await resumeRetirementReceipts({ contentDir: testDir, deps: deps(channels) })).toEqual({ resumed: 1, done: 1, editFailed: 0 })
    expect(calls.map((c) => c.approvalId)).toEqual(['nav-early'])
  })

  it('the old engine\'s review tasks are completed for every legacy health record — pending OR already cancelled — once each, never a v2 task (Mark\'s live test 2026-10-24)', async () => {
    writeApproval(legacyNavigate('nav-open'))
    writeApproval(legacyNavigate('nav-old', { status: 'cancelled', owner: { kind: 'health-navigate', taskId: 't-old', requestId: 'r-old', incidentIds: ['x'], href: '/x' } }))
    writeApproval(legacyNavigate('nav-old-2', { status: 'cancelled', owner: { kind: 'health-navigate', taskId: 't-old', requestId: 'r-old-2', incidentIds: ['x'], href: '/x' } }))
    writeApproval(legacyRepair('rep-done', { status: 'cancelled', owner: { kind: 'health-repair', taskId: 'done-1', requestId: 'r-d', incidentIds: ['x'] } }))
    writeApproval(legacyRepair('rep-v2', { schemaVersion: 2, owner: { kind: 'health-repair', taskId: 't-v2', requestId: 'r-v2', incidentIds: ['x'] } }))
    const { channels } = workingChannels()
    const summary = await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(channels) })
    expect(summary).toMatchObject({ selected: 1, tasksCompleted: 2 })
    expect([...completedTasks].sort()).toEqual(['t-nav', 't-old'])
    const again = await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(channels) })
    expect(again).toMatchObject({ selected: 0, tasksCompleted: 0 })
    expect(auditRows().filter((row) => row.event === LEGACY_RETIRE_AUDIT_EVENT)).toHaveLength(1)
  })

  it('settled legacy records leave the live directory for approvals/legacy-archive (bytes intact); pending ones and open receipts stay; the store never parses them again (live boot warnings 2026-10-24)', async () => {
    writeApproval(legacyNavigate('nav-live'))                                                 // pending → retired, card edited, receipt done → archived in the SAME pass
    writeApproval(legacyRepair('rep-old', { status: 'cancelled', owner: { kind: 'health-repair', taskId: 'done-1', requestId: 'r', incidentIds: ['x'] } })) // settled long ago → archived
    writeApproval(legacyNavigate('nav-stuck'))                                                // its card edit will fail → receipt open → stays
    writeApproval(legacyRepair('rep-v2', { schemaVersion: 2 }))                                // the new engine's → stays
    const raw = readRaw('rep-old')
    const flaky = () => ({ cancelApproval: async (args: { approvalId: string }) => { if (args.approvalId === 'nav-stuck') throw new Error('Discord 503') } })
    const summary = await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(flaky) })
    expect(summary).toMatchObject({ selected: 2, done: 1, editFailed: 1, archived: 2 })
    const archive = legacyApprovalArchiveRoot(testDir)
    expect(JSON.parse(readFileSync(join(archive, 'rep-old.json'), 'utf-8'))).toEqual(raw)
    expect(existsSync(join(archive, 'nav-live.json'))).toBe(true)
    expect(existsSync(join(approvalsDir, 'nav-stuck.json'))).toBe(true)
    expect(existsSync(join(approvalsDir, 'rep-v2.json'))).toBe(true)
    expect(getApprovalRecord('nav-stuck', testDir)?.status).toBe('cancelled') // still live: its receipt is open
    // The reconnect carries the stuck card to done; the next pass archives it too.
    const { channels } = workingChannels()
    await resumeRetirementReceipts({ contentDir: testDir, deps: deps(channels) })
    expect((await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(channels) })).archived).toBe(1)
    expect(existsSync(join(archive, 'nav-stuck.json'))).toBe(true)
  })

  it('a quiet pass (nothing legacy, nothing open) writes no receipt file and no audit row', async () => {
    writeApproval(legacyRepair('rep-v2', { schemaVersion: 2 }))
    const summary = await retireLegacyHealthApprovals({ contentDir: testDir, deps: deps(() => undefined) })
    expect(summary).toMatchObject({ selected: 0, resumed: 0 })
    expect(existsSync(retirementReceiptsPath(testDir))).toBe(false)
    expect(auditRows()).toEqual([])
  })
})
