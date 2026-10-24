/**
 * Raw retirement of pending LEGACY Health approvals (self-healing 1.6,
 * plan R3 N3 / R4 R4.1). The three-outcomes cutover (1.7) replaces the
 * health-repair / health-navigate approvals the old escalation raised; the
 * pending ones written by that engine cannot be resolved by the new one, so
 * they are retired RAW — read without the schema, cancelled, their Discord
 * cards edited — exactly once, and never silently:
 *
 *   intent receipt (`retiring`) → cancel the record → edit the card → `done`
 *                                                      └─ failed → `edit-failed` (+ lastError, attempts)
 *
 * The receipt is written BEFORE anything changes, so a crash anywhere
 * between intent and done is recovered on the next boot or bridge reconnect
 * (`resumeRetirementReceipts`), regardless of what the record says by then.
 * Receipts live in `~/.bakin/health/retirement-receipts.jsonl` (append-only,
 * last line per approval wins); the repair engine's notification outbox
 * (PR5) imports the open ones. Records the adapted engine writes carry
 * `schemaVersion: 2` and are never selected. Nothing calls this module until
 * the cutover wires it into startup recovery.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import type { RuntimeChannelSurface } from '@bakin/core/adapters/runtime/channels'
import { approvalsDir, cancelApprovalRecord, type ApprovalRecord } from '@bakin/core/approvals'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import { appendAudit } from '../audit'
import { getContentDir } from '../content-dir'
import { maybeGetAppServices } from '../app-services-store'
import { createLogger } from '../logger'

const log = createLogger('approvals-legacy-retire')

/** The marker the adapted engine stamps on every approval it writes; legacy records lack it. */
export const APPROVAL_SCHEMA_VERSION = 2
export const LEGACY_RETIRE_REASON = 'Retired by the Health upgrade: decisions now live on the subject card in Health.'
export const LEGACY_RETIRE_AUDIT_EVENT = 'approvals.legacy_retired'
const LEGACY_KINDS = new Set(['health-repair', 'health-navigate'])

export type RetirementReceiptState = 'retiring' | 'done' | 'edit-failed'

export interface RetirementReceipt {
  approvalId: string
  /** The card to edit; null when the approval never reached a channel (then `done` follows the cancel). */
  channelId: string | null
  messageId: string | null
  state: RetirementReceiptState
  reason: string
  startedAt: string
  updatedAt: string
  /** Channel-edit attempts so far. */
  attempts: number
  lastError?: string
}

export interface LegacyRetireSummary {
  /** Legacy pending records found by this pass. */
  selected: number
  /** Cancelled through the record store (the record parsed under the current schema). */
  cancelledViaStore: number
  /** Cancelled by a raw write (the record did not parse). */
  cancelledRaw: number
  /** Receipts carried to `done` (card edited, or no card to edit). */
  done: number
  /** Receipts left `edit-failed` (the bridge was down or refused the edit). */
  editFailed: number
  /** Open receipts from an earlier pass that this pass resumed. */
  resumed: number
  /** Files that could not be read as JSON (left untouched). */
  unreadable: number
}

export interface LegacyRetireDeps {
  channels?: () => Pick<RuntimeChannelSurface, 'cancelApproval'> | undefined
  now?: () => string
}

export function retirementReceiptsPath(contentDir = getContentDir()): string {
  return join(contentDir, 'health', 'retirement-receipts.jsonl')
}

/** Every receipt, last line per approval winning. */
export function readRetirementReceipts(contentDir = getContentDir()): Map<string, RetirementReceipt> {
  const path = retirementReceiptsPath(contentDir)
  const receipts = new Map<string, RetirementReceipt>()
  if (!existsSync(path)) return receipts
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line) as Partial<RetirementReceipt>
      if (typeof parsed.approvalId !== 'string' || typeof parsed.state !== 'string') continue
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

function readRawApprovals(contentDir: string): { records: RawApproval[]; unreadable: number } {
  const dir = approvalsDir(contentDir)
  if (!existsSync(dir)) return { records: [], unreadable: 0 }
  const records: RawApproval[] = []
  let unreadable = 0
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const path = join(dir, name)
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) records.push({ path, raw: raw as Record<string, unknown> })
      else unreadable += 1
    } catch (err) {
      unreadable += 1
      log.warn('Approval file is not readable JSON — left untouched', { path, err: err instanceof Error ? err.message : String(err) })
    }
  }
  return { records, unreadable }
}

function isLegacyPending(raw: Record<string, unknown>): boolean {
  const owner = raw.owner
  const kind = owner && typeof owner === 'object' ? (owner as { kind?: unknown }).kind : undefined
  return typeof kind === 'string' && LEGACY_KINDS.has(kind) && raw.status === 'pending' && raw.schemaVersion !== APPROVAL_SCHEMA_VERSION
}

function firstDelivery(raw: Record<string, unknown>): { channelId: string; messageId: string } | null {
  const deliveries = raw.deliveries
  if (!Array.isArray(deliveries)) return null
  for (const entry of deliveries) {
    if (entry && typeof entry === 'object') {
      const { channelId, ref } = entry as { channelId?: unknown; ref?: unknown }
      if (typeof channelId === 'string' && typeof ref === 'string') return { channelId, messageId: ref }
    }
  }
  return null
}

/**
 * Cancel the record: through the store when it parses under the current
 * schema (compare-and-set on pending, the same write every resolver uses),
 * otherwise a raw write that keeps every field it had and marks who retired
 * it. Returns how it was cancelled, or null when nothing was pending.
 */
function cancelRaw(contentDir: string, approvalId: string, entry: RawApproval, now: string): 'store' | 'raw' | null {
  const viaStore = cancelApprovalRecord(approvalId, LEGACY_RETIRE_REASON, contentDir)
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

async function editCard(
  contentDir: string,
  receipt: RetirementReceipt,
  channels: Pick<RuntimeChannelSurface, 'cancelApproval'> | undefined,
  now: string,
): Promise<RetirementReceipt> {
  if (receipt.channelId === null || receipt.messageId === null) {
    return appendReceipt(contentDir, { ...receipt, state: 'done', updatedAt: now })
  }
  const attempts = receipt.attempts + 1
  if (!channels) {
    return appendReceipt(contentDir, { ...receipt, state: 'edit-failed', attempts, lastError: 'Delivery channels are unavailable (bridge down or runtime without channels).', updatedAt: now })
  }
  try {
    await channels.cancelApproval({
      approvalId: receipt.approvalId,
      deliveries: [{ channelId: receipt.channelId, ref: receipt.messageId, renderedAt: receipt.startedAt }],
      reason: receipt.reason,
    })
    return appendReceipt(contentDir, { ...receipt, state: 'done', attempts, updatedAt: now })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn('Legacy approval card edit failed — receipt stays open for the next reconnect', { approvalId: receipt.approvalId, attempts, err: message })
    return appendReceipt(contentDir, { ...receipt, state: 'edit-failed', attempts, lastError: message, updatedAt: now })
  }
}

function defaultChannels(): Pick<RuntimeChannelSurface, 'cancelApproval'> | undefined {
  return maybeGetAppServices()?.runtime.channels
}

/**
 * Resume every receipt that is not `done`: make sure the record is cancelled
 * (a crash between intent and cancel left it pending), then edit the card.
 * Runs on every boot and bridge reconnect; a receipt's record status is
 * never a reason to skip it.
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
  if (open.length === 0) return { resumed: 0, done, editFailed }
  const { records } = readRawApprovals(contentDir)
  for (const receipt of open) {
    const entry = records.find((candidate) => candidate.raw.approvalId === receipt.approvalId)
    if (entry && entry.raw.status === 'pending') cancelRaw(contentDir, receipt.approvalId, entry, now())
    const settled = await editCard(contentDir, receipt, channels, now())
    if (settled.state === 'done') done += 1
    else editFailed += 1
  }
  return { resumed: open.length, done, editFailed }
}

/**
 * One idempotent pass: resume open receipts, then retire every legacy
 * pending Health approval that has no receipt yet. One audit row carries the
 * counts whenever the pass did anything; a quiet pass writes nothing.
 */
export async function retireLegacyHealthApprovals(
  options: { contentDir?: string; deps?: LegacyRetireDeps } = {},
): Promise<LegacyRetireSummary> {
  const contentDir = options.contentDir ?? getContentDir()
  const now = options.deps?.now ?? (() => new Date().toISOString())
  const channels = (options.deps?.channels ?? defaultChannels)()
  const resumed = await resumeRetirementReceipts({ contentDir, deps: { channels: () => channels, now } })
  const summary: LegacyRetireSummary = { selected: 0, cancelledViaStore: 0, cancelledRaw: 0, done: resumed.done, editFailed: resumed.editFailed, resumed: resumed.resumed, unreadable: 0 }

  const { records, unreadable } = readRawApprovals(contentDir)
  summary.unreadable = unreadable
  const receipts = readRetirementReceipts(contentDir)
  for (const entry of records) {
    if (!isLegacyPending(entry.raw)) continue
    const approvalId = entry.raw.approvalId
    if (typeof approvalId !== 'string' || approvalId === '') continue
    if (receipts.has(approvalId)) continue // already retired (or being resumed above)
    summary.selected += 1
    const delivery = firstDelivery(entry.raw)
    const startedAt = now()
    // Intent FIRST (R4.1): a crash after this line is recovered by resume.
    const intent = appendReceipt(contentDir, {
      approvalId,
      channelId: delivery?.channelId ?? null,
      messageId: delivery?.messageId ?? null,
      state: 'retiring',
      reason: LEGACY_RETIRE_REASON,
      startedAt,
      updatedAt: startedAt,
      attempts: 0,
    })
    const how = cancelRaw(contentDir, approvalId, entry, now())
    if (how === 'store') summary.cancelledViaStore += 1
    else if (how === 'raw') summary.cancelledRaw += 1
    const settled = await editCard(contentDir, intent, channels, now())
    if (settled.state === 'done') summary.done += 1
    else summary.editFailed += 1
  }

  if (summary.selected > 0 || summary.resumed > 0) {
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
