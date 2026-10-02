/**
 * ONE-SHOT, idempotent move of the workflows plugin's approval records
 * (<contentDir>/workflows/approvals/*.json, gate-only owner) into the core
 * store (<contentDir>/approvals/, owner kind 'workflow-gate') with status,
 * deliveries and response intact — a live Discord card keeps resolving
 * (plan review R5a). Files that cannot be mapped are left in place and the
 * old directory survives until it is empty of them.
 *
 * Deletable once the operator's box has booted on it (with settings-upgrade).
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { importApprovalRecord, type ApprovalRecord } from '@bakin/core/approvals'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'

const log = createLogger('approvals:records-upgrade')

const legacyRecordSchema = z.object({
  approvalId: z.string().min(1),
  owner: z.object({
    workflowId: z.string(),
    runId: z.string(),
    stepId: z.string(),
    taskId: z.string().min(1),
  }),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'expired']),
  request: z.object({
    title: z.string(),
    body: z.string(),
    options: z.array(z.object({ id: z.string(), label: z.string(), variant: z.enum(['primary', 'destructive', 'neutral']).optional() })),
    expiresAt: z.string().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  }),
  deliveries: z.array(z.object({ channelId: z.string(), ref: z.string(), renderedAt: z.string() })),
  response: z.object({
    selectedOption: z.string(),
    respondedAt: z.string(),
    actor: z.object({ type: z.enum(['agent', 'human']), id: z.string(), displayName: z.string().optional() }),
    comment: z.string().optional(),
  }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().optional(),
})

export interface ApprovalRecordsUpgradeResult {
  status: 'noop' | 'migrated'
  migrated: number
  /** Destination already held the id — the old file is dropped. */
  alreadyPresent: number
  /** Unparseable or unmappable files left behind (the old dir is kept for them). */
  left: number
}

export function legacyApprovalsDir(contentDir = getContentDir()): string {
  return join(contentDir, 'workflows', 'approvals')
}

export function upgradeApprovalRecords(contentDir = getContentDir()): ApprovalRecordsUpgradeResult {
  const dir = legacyApprovalsDir(contentDir)
  if (!existsSync(dir)) return { status: 'noop', migrated: 0, alreadyPresent: 0, left: 0 }

  let migrated = 0
  let alreadyPresent = 0
  let left = 0
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) {
      left += 1
      continue
    }
    const path = join(dir, name)
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'))
    } catch (err) {
      log.warn('Legacy approval record is not readable JSON — left in place', { path, err: err instanceof Error ? err.message : String(err) })
      left += 1
      continue
    }
    const parsed = legacyRecordSchema.safeParse(raw)
    if (!parsed.success) {
      log.warn('Legacy approval record could not be mapped — left in place', { path })
      left += 1
      continue
    }
    const legacy = parsed.data
    const record: ApprovalRecord = {
      approvalId: legacy.approvalId,
      owner: { kind: 'workflow-gate', taskId: legacy.owner.taskId, workflowId: legacy.owner.workflowId, runId: legacy.owner.runId, stepId: legacy.owner.stepId },
      status: legacy.status,
      request: legacy.request,
      deliveries: legacy.deliveries,
      ...(legacy.response ? { response: legacy.response } : {}),
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      ...(legacy.resolvedAt ? { resolvedAt: legacy.resolvedAt } : {}),
    }
    if (importApprovalRecord(record, contentDir)) migrated += 1
    else alreadyPresent += 1
    rmSync(path, { force: true })
  }

  if (left === 0) rmSync(dir, { recursive: true, force: true })
  log.info('Legacy approval records upgraded', { migrated, alreadyPresent, left })
  return { status: 'migrated', migrated, alreadyPresent, left }
}
