/**
 * Raw retirement of pending LEGACY Health approvals (self-healing 1.6,
 * plan R3 N3 / R4 R4.1). The three-outcomes cutover (1.7) replaces the
 * health-repair / health-navigate approvals the old escalation raised; the
 * pending ones written by that engine cannot be resolved by the new one, so
 * they are retired RAW — read without the schema, cancelled, their Discord
 * cards edited — exactly once, and never silently:
 *
 *   intent receipt (`retiring`) → cancel the record → edit every card → `done`
 *                                                     └─ any failed → `edit-failed` (+ lastError, attempts)
 *
 * The receipt is written BEFORE anything changes, so a crash anywhere
 * between intent and done is recovered on the next boot or bridge reconnect
 * (`resumeRetirementReceipts`), regardless of what the record says by then.
 * Every delivered card is tracked on its own inside the receipt: a receipt
 * is `done` only when every card is, and a later pass retries only the cards
 * that are not. Receipts live in `~/.bakin/health/retirement-receipts.jsonl`
 * (append-only, last line per approval wins); the repair engine's
 * notification outbox (PR5) imports the open ones.
 *
 * The reader is BOUNDED without ever forgetting work: records are read one
 * file at a time (never the whole directory into memory), a file above
 * `MAX_APPROVAL_FILE_BYTES` is counted unreadable and left alone, a pass
 * retires in batches of `MAX_RETIREMENTS_PER_BATCH` and yields to the event
 * loop between batches until the selection is empty (bounded burst, complete
 * drain — no record waits for another restart), and the receipt journal is
 * STREAMED line by line (memory bounded by the number of distinct approvals,
 * not the file size — an unfinished receipt is never dropped behind a long
 * tail of finished ones).
 * Records the adapted engine writes carry `schemaVersion: 2` and are never
 * selected. The old engine's REVIEW TASKS (every legacy health record's
 * `owner.taskId`, whatever the record's status) are completed when still
 * open — nothing from the retired engine lingers on the board.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'fs'
import { dirname, join } from 'path'
import type { RuntimeChannelSurface } from '@bakin/core/adapters/runtime/channels'
import { approvalPath, approvalsDir, type ApprovalRecord } from '@bakin/core/approvals'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import { appendAudit } from '../audit'
import { getContentDir } from '../content-dir'
import { maybeGetAppServices } from '../app-services-store'
import { createLogger } from '../logger'
import { cancelApproval } from './service'

const log = createLogger('approvals-legacy-retire')

/** The marker the adapted engine stamps on every approval it writes; legacy records lack it. */
export const APPROVAL_SCHEMA_VERSION = 2
export const LEGACY_RETIRE_REASON = 'Retired by the Health upgrade: decisions now live on the subject card in Health.'
export const LEGACY_RETIRE_AUDIT_EVENT = 'approvals.legacy_retired'
/** An approval record is a few KB; anything past this is not one Bakin wrote and is left alone. */
export const MAX_APPROVAL_FILE_BYTES = 256 * 1024
/** Records retired per batch; a pass drains batch after batch (yielding between them) until none is left. */
export const MAX_RETIREMENTS_PER_BATCH = 200
/** Journal read chunk; a single receipt line longer than this is malformed and skipped with a warning. */
export const RECEIPT_JOURNAL_CHUNK_BYTES = 256 * 1024
const LEGACY_KINDS = new Set(['health-repair', 'health-navigate'])

export type RetirementReceiptState = 'retiring' | 'done' | 'edit-failed'
export type RetirementDeliveryState = 'pending' | 'done' | 'edit-failed'

/** One delivered card and where its edit stands. */
export interface RetirementDelivery {
  channelId: string
  messageId: string
  state: RetirementDeliveryState
  /** Edit attempts on THIS card so far. */
  attempts: number
  lastError?: string
}

export interface RetirementReceipt {
  approvalId: string
  /** The cards to edit; empty when the approval never reached a channel (then `done` follows the cancel). */
  deliveries: RetirementDelivery[]
  state: RetirementReceiptState
  reason: string
  startedAt: string
  updatedAt: string
  /** Edit rounds so far (one round edits every card that is not done yet). */
  attempts: number
  /** The last card error of the latest round. */
  lastError?: string
}

export interface LegacyRetireSummary {
  /** Legacy pending records retired by this pass (every batch summed). */
  selected: number
  /** Batches the pass needed (`MAX_RETIREMENTS_PER_BATCH` each). */
  batches: number
  /** Cancelled through the approvals service (the record parsed under the current schema). */
  cancelledViaStore: number
  /** Cancelled by a raw write (the record did not parse). */
  cancelledRaw: number
  /** Receipts carried to `done` (every card edited, or no card to edit). */
  done: number
  /** Receipts left `edit-failed` (the bridge was down or refused an edit). */
  editFailed: number
  /** Open receipts from an earlier pass that this pass resumed. */
  resumed: number
  /** Files that could not be read as JSON or were oversized (left untouched). */
  unreadable: number
  /** The old engine's review tasks completed (every legacy health record's task that was still open). */
  tasksCompleted: number
}

export interface LegacyRetireDeps {
  channels?: () => Pick<RuntimeChannelSurface, 'cancelApproval'> | undefined
  now?: () => string
  /** Completes the old engine's review task for a retired record; the default reads the task store and moves health-sourced open tasks to done. */
  tasks?: { complete(taskId: string): Promise<'completed' | 'skipped'> }
}

/**
 * The review task the old escalation opened for a legacy record (any status —
 * a record cancelled before this release still left its task in Review) is
 * completed when it is still open and health-sourced; anything else is left
 * alone. Idempotent: a done task is skipped.
 */
async function defaultCompleteLegacyTask(taskId: string): Promise<'completed' | 'skipped'> {
  const { getTask } = await import('../task-store')
  const { getTaskDetails, moveTaskWithEffects } = await import('../task-service')
  const task = getTask(taskId)
  if (!task || task.source?.pluginId !== 'health') return 'skipped'
  const details = await getTaskDetails(taskId).catch(() => null)
  if (!details || details.column === 'done' || details.column === 'archived') return 'skipped'
  await moveTaskWithEffects(taskId, 'done', 'system', { skipDoneGuard: true, channel: 'system' })
  return 'completed'
}

export function retirementReceiptsPath(contentDir = getContentDir()): string {
  return join(contentDir, 'health', 'retirement-receipts.jsonl')
}

/** Stream the journal's lines with bounded memory (one chunk at a time); an over-long line is skipped, never buffered. */
function* journalLines(path: string): Generator<string> {
  const fd = openSync(path, 'r')
  try {
    const chunk = Buffer.alloc(RECEIPT_JOURNAL_CHUNK_BYTES)
    let carry = ''
    let overlong = false
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, null)
      if (read === 0) break
      const text = carry + chunk.subarray(0, read).toString('utf-8')
      const lines = text.split('\n')
      carry = lines.pop() ?? ''
      for (const line of lines) {
        if (overlong) { overlong = false; continue } // the tail of a skipped over-long line
        if (line.length > RECEIPT_JOURNAL_CHUNK_BYTES) {
          log.warn('Retirement receipt line exceeds the chunk bound — skipped', { path, bound: RECEIPT_JOURNAL_CHUNK_BYTES })
          continue
        }
        yield line
      }
      if (carry.length > RECEIPT_JOURNAL_CHUNK_BYTES) {
        log.warn('Retirement receipt line exceeds the chunk bound — skipped', { path, bound: RECEIPT_JOURNAL_CHUNK_BYTES })
        carry = ''
        overlong = true
      }
    }
    if (carry !== '' && !overlong) yield carry
  } finally {
    closeSync(fd)
  }
}

function isDelivery(value: unknown): value is RetirementDelivery {
  if (!value || typeof value !== 'object') return false
  const { channelId, messageId, state } = value as Record<string, unknown>
  return typeof channelId === 'string' && typeof messageId === 'string' && (state === 'pending' || state === 'done' || state === 'edit-failed')
}

/** Every receipt, last line per approval winning. */
export function readRetirementReceipts(contentDir = getContentDir()): Map<string, RetirementReceipt> {
  const path = retirementReceiptsPath(contentDir)
  const receipts = new Map<string, RetirementReceipt>()
  if (!existsSync(path)) return receipts
  for (const line of journalLines(path)) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line) as Partial<RetirementReceipt>
      if (typeof parsed.approvalId !== 'string' || typeof parsed.state !== 'string' || !Array.isArray(parsed.deliveries) || !parsed.deliveries.every(isDelivery)) continue
      receipts.set(parsed.approvalId, parsed as RetirementReceipt)
    } catch (err) {
      log.warn('Retirement receipt line is not JSON — skipped', { err: err instanceof Error ? err.message : String(err) })
    }
  }
  return receipts
}

/** The receipts a later pass (boot, reconnect, the PR5 outbox) still has to carry to `done`. */
export function openRetirementReceipts(contentDir = getContentDir()): RetirementReceipt[] {
  return [...readRetirementReceipts(contentDir).values()].filter((receipt) => receipt.state !== 'done')
}

function appendReceipt(contentDir: string, receipt: RetirementReceipt): RetirementReceipt {
  const path = retirementReceiptsPath(contentDir)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(receipt)}\n`)
  return receipt
}

interface RawApproval {
  path: string
  raw: Record<string, unknown>
}

/** One record file, read raw. `null` = unreadable (not JSON, not an object, or oversized) — counted and left alone. */
function readRawApproval(path: string): RawApproval | null {
  try {
    const size = statSync(path).size
    if (size > MAX_APPROVAL_FILE_BYTES) {
      log.warn('Approval file is oversized — left untouched', { path, size, bound: MAX_APPROVAL_FILE_BYTES })
      return null
    }
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { path, raw: raw as Record<string, unknown> }
    return null
  } catch (err) {
    log.warn('Approval file is not readable JSON — left untouched', { path, err: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/** Record files, one at a time, in directory order — never the whole directory in memory. */
function* approvalFiles(contentDir: string): Generator<string> {
  const dir = approvalsDir(contentDir)
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.json')) yield join(dir, name)
  }
}

function legacyOwner(raw: Record<string, unknown>): { kind: string; taskId: string | null } | null {
  const owner = raw.owner
  const kind = owner && typeof owner === 'object' ? (owner as { kind?: unknown }).kind : undefined
  if (typeof kind !== 'string' || !LEGACY_KINDS.has(kind) || raw.schemaVersion === APPROVAL_SCHEMA_VERSION) return null
  const taskId = (owner as { taskId?: unknown }).taskId
  return { kind, taskId: typeof taskId === 'string' && taskId !== '' ? taskId : null }
}

function isLegacyPending(raw: Record<string, unknown>): boolean {
  return legacyOwner(raw) !== null && raw.status === 'pending'
}

/** Every delivered card the raw record names, each tracked on its own. */
function pendingDeliveries(raw: Record<string, unknown>): RetirementDelivery[] {
  const deliveries = raw.deliveries
  if (!Array.isArray(deliveries)) return []
  const out: RetirementDelivery[] = []
  for (const entry of deliveries) {
    if (entry && typeof entry === 'object') {
      const { channelId, ref } = entry as { channelId?: unknown; ref?: unknown }
      if (typeof channelId === 'string' && typeof ref === 'string') out.push({ channelId, messageId: ref, state: 'pending', attempts: 0 })
    }
  }
  return out
}

/**
 * Cancel the record: through the approvals service when it parses under the
 * current schema (compare-and-set on pending, the resolved event every board
 * listener expects; the card edit stays with the receipt), otherwise a raw
 * write that keeps every field it had and marks who retired it. Returns how
 * it was cancelled, or null when nothing was pending.
 */
async function cancelRecord(contentDir: string, approvalId: string, entry: RawApproval, now: string): Promise<'store' | 'raw' | null> {
  const viaStore = await cancelApproval(approvalId, LEGACY_RETIRE_REASON, { notifyChannel: false, contentDir })
  if (viaStore) return viaStore.status === 'cancelled' ? 'store' : null
  if (entry.raw.status !== 'pending') return null
  atomicWriteJson(entry.path, {
    ...entry.raw,
    status: 'cancelled',
    retiredBy: 'legacy-retire',
    response: { selectedOption: 'cancel', respondedAt: now, comment: LEGACY_RETIRE_REASON },
    resolvedAt: now,
    updatedAt: now,
  }, { trailingNewline: false })
  return 'raw'
}

/** One edit round: every card that is not done yet, each on its own; the receipt is done only when all of them are. */
async function editCards(
  contentDir: string,
  receipt: RetirementReceipt,
  channels: Pick<RuntimeChannelSurface, 'cancelApproval'> | undefined,
  now: string,
): Promise<RetirementReceipt> {
  const open = receipt.deliveries.filter((delivery) => delivery.state !== 'done')
  if (open.length === 0) {
    return appendReceipt(contentDir, { ...receipt, state: 'done', updatedAt: now })
  }
  const attempts = receipt.attempts + 1
  let lastError: string | undefined
  const deliveries: RetirementDelivery[] = []
  for (const delivery of receipt.deliveries) {
    if (delivery.state === 'done') { deliveries.push(delivery); continue }
    if (!channels) {
      lastError = 'Delivery channels are unavailable (bridge down or runtime without channels).'
      deliveries.push({ ...delivery, state: 'edit-failed', attempts: delivery.attempts + 1, lastError })
      continue
    }
    try {
      await channels.cancelApproval({
        approvalId: receipt.approvalId,
        deliveries: [{ channelId: delivery.channelId, ref: delivery.messageId, renderedAt: receipt.startedAt }],
        reason: receipt.reason,
      })
      const { lastError: _cleared, ...rest } = delivery
      deliveries.push({ ...rest, state: 'done', attempts: delivery.attempts + 1 })
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      log.warn('Legacy approval card edit failed — receipt stays open for the next reconnect', { approvalId: receipt.approvalId, channelId: delivery.channelId, attempts: delivery.attempts + 1, err: lastError })
      deliveries.push({ ...delivery, state: 'edit-failed', attempts: delivery.attempts + 1, lastError })
    }
  }
  const allDone = deliveries.every((delivery) => delivery.state === 'done')
  const { lastError: _previous, ...base } = receipt
  return appendReceipt(contentDir, {
    ...base,
    deliveries,
    state: allDone ? 'done' : 'edit-failed',
    attempts,
    updatedAt: now,
    ...(allDone || lastError === undefined ? {} : { lastError }),
  })
}

function defaultChannels(): Pick<RuntimeChannelSurface, 'cancelApproval'> | undefined {
  return maybeGetAppServices()?.runtime.channels
}

/**
 * Resume every receipt that is not `done`: make sure the record is cancelled
 * (a crash between intent and cancel left it pending), then edit the cards
 * that are still open. Runs on every boot and bridge reconnect; a receipt's
 * record status is never a reason to skip it.
 */
export async function resumeRetirementReceipts(
  options: { contentDir?: string; deps?: LegacyRetireDeps } = {},
): Promise<{ resumed: number; done: number; editFailed: number }> {
  const contentDir = options.contentDir ?? getContentDir()
  const now = options.deps?.now ?? (() => new Date().toISOString())
  const channels = (options.deps?.channels ?? defaultChannels)()
  const open = openRetirementReceipts(contentDir)
  let done = 0
  let editFailed = 0
  for (const receipt of open) {
    const path = approvalPath(receipt.approvalId, contentDir)
    const entry = existsSync(path) ? readRawApproval(path) : null
    if (entry && entry.raw.status === 'pending') await cancelRecord(contentDir, receipt.approvalId, entry, now())
    const settled = await editCards(contentDir, receipt, channels, now())
    if (settled.state === 'done') done += 1
    else editFailed += 1
  }
  return { resumed: open.length, done, editFailed }
}

/**
 * One idempotent pass: resume open receipts, then retire every legacy
 * pending Health approval that has no receipt yet (up to the per-pass
 * bound). One audit row carries the counts whenever the pass did anything;
 * a quiet pass writes nothing.
 */
export async function retireLegacyHealthApprovals(
  options: { contentDir?: string; deps?: LegacyRetireDeps } = {},
): Promise<LegacyRetireSummary> {
  const contentDir = options.contentDir ?? getContentDir()
  const now = options.deps?.now ?? (() => new Date().toISOString())
  const channels = (options.deps?.channels ?? defaultChannels)()
  const completeTask = options.deps?.tasks?.complete ?? defaultCompleteLegacyTask
  const resumed = await resumeRetirementReceipts({ contentDir, deps: { channels: () => channels, now } })
  const summary: LegacyRetireSummary = { selected: 0, batches: 0, cancelledViaStore: 0, cancelledRaw: 0, done: resumed.done, editFailed: resumed.editFailed, resumed: resumed.resumed, unreadable: 0, tasksCompleted: 0 }
  const tasksSeen = new Set<string>()

  // Drain in bounded batches: each batch re-derives the selection from disk
  // (records retired so far carry a receipt and drop out), yields to the
  // event loop, and the loop ends only when a batch selects nothing.
  const retired = new Set<string>()
  for (;;) {
    const receipts = readRetirementReceipts(contentDir)
    let selectedThisBatch = 0
    let unreadable = 0
    for (const path of approvalFiles(contentDir)) {
      if (selectedThisBatch >= MAX_RETIREMENTS_PER_BATCH) break
      const entry = readRawApproval(path)
      if (!entry) { unreadable += 1; continue }
      // Every legacy health record — pending or already cancelled — may still hold the old engine's review task open.
      const owner = legacyOwner(entry.raw)
      if (owner?.taskId && !tasksSeen.has(owner.taskId)) {
        tasksSeen.add(owner.taskId)
        try {
          if (await completeTask(owner.taskId) === 'completed') summary.tasksCompleted += 1
        } catch (err) {
          log.warn('Legacy Health review task could not be completed — left in place', { taskId: owner.taskId, err: err instanceof Error ? err.message : String(err) })
        }
      }
      if (!isLegacyPending(entry.raw)) continue
      const approvalId = entry.raw.approvalId
      if (typeof approvalId !== 'string' || approvalId === '') continue
      if (receipts.has(approvalId) || retired.has(approvalId)) continue // already retired (or resumed above)
      selectedThisBatch += 1
      retired.add(approvalId)
      const startedAt = now()
      // Intent FIRST (R4.1): a crash after this line is recovered by resume.
      const intent = appendReceipt(contentDir, {
        approvalId,
        deliveries: pendingDeliveries(entry.raw),
        state: 'retiring',
        reason: LEGACY_RETIRE_REASON,
        startedAt,
        updatedAt: startedAt,
        attempts: 0,
      })
      const how = await cancelRecord(contentDir, approvalId, entry, now())
      if (how === 'store') summary.cancelledViaStore += 1
      else if (how === 'raw') summary.cancelledRaw += 1
      const settled = await editCards(contentDir, intent, channels, now())
      if (settled.state === 'done') summary.done += 1
      else summary.editFailed += 1
    }
    summary.unreadable = unreadable // the directory is re-read every batch; the last sweep's count is the honest one
    if (selectedThisBatch === 0) break
    summary.selected += selectedThisBatch
    summary.batches += 1
    if (selectedThisBatch < MAX_RETIREMENTS_PER_BATCH) break
    await new Promise<void>((resolve) => setImmediate(resolve))
  }

  if (summary.selected > 0 || summary.resumed > 0 || summary.tasksCompleted > 0) {
    appendAudit(contentDir, LEGACY_RETIRE_AUDIT_EVENT, 'system', { ...summary, reason: LEGACY_RETIRE_REASON })
    log.info('Legacy Health approvals retired', { ...summary })
  }
  return summary
}

/** Test-visible: the shape the resume path treats as "the record is still pending". */
export function isLegacyPendingApproval(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && isLegacyPending(raw as Record<string, unknown>)
}

export type { ApprovalRecord }
