/**
 * Sync receipts (layered-context spec, C5).
 *
 * One JSON per agent at ~/.bakin/packages/receipts/<agentId>.json holding
 * the LATEST sync receipt only — the audit trail (audit.jsonl) is the
 * historical record. The receipt is the user-facing proof of what a sync
 * actually did: blocks recomposed, projections written, skips with
 * reasons, and the post-sync verification result.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../content-dir'
import type { SyncFinding } from './sync-scanner'

export interface ReceiptBlock {
  file: string
  action: 'recomposed' | 'unchanged' | 'removed'
  /** Section labels inside the composed block (global, role:…, team:…, package, lessons). */
  sections: string[]
  bytes: number
}

export interface ReceiptProjection {
  target: string
  kind: 'skill' | 'asset'
  action: 'written' | 'skipped' | 'reclaimed'
  reason?: string
}

export interface SyncReceipt {
  agentId: string
  syncedAt: string
  state: 'managed' | 'unmanaged'
  /** True when this receipt came from a --check run (nothing was written). */
  checkOnly: boolean
  package?: {
    id: string
    versionBefore: string
    versionAfter: string
    commitBefore: string
    commitAfter: string
    /** Whether the upstream source was fetched during this sync. */
    fetched: boolean
    /** Whether the installed source actually changed. */
    changed: boolean
  }
  blocks: ReceiptBlock[]
  projections: ReceiptProjection[]
  skipped: Array<{ target: string; reason: string; hint?: string }>
  verification: {
    status: 'ok' | 'issues'
    findings: SyncFinding[]
  }
}

export function getReceiptsDir(): string {
  return join(getContentDir(), 'packages', 'receipts')
}

export function receiptPath(agentId: string): string {
  return join(getReceiptsDir(), `${agentId}.json`)
}

export function writeReceipt(receipt: SyncReceipt): void {
  mkdirSync(getReceiptsDir(), { recursive: true })
  writeFileSync(receiptPath(receipt.agentId), JSON.stringify(receipt, null, 2), 'utf-8')
}

export function readReceipt(agentId: string): SyncReceipt | null {
  const path = receiptPath(agentId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SyncReceipt
  } catch {
    return null
  }
}
