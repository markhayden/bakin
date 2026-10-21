/**
 * Client-side zod boundary for the updates engine's HTTP surface (#1007):
 * `GET /api/updates`, `POST /api/updates/check?wait=1`,
 * `GET /api/updates/:id/apply-preview`. The server's schemas live with the
 * engine (`src/core/updates/schema.ts`); a plugin validates what it renders.
 */
import { z } from 'zod'
import {
  UPDATE_GROUPS,
  UPDATE_IMPACTS,
  UPDATE_OUTCOMES,
  UPDATE_REASONS,
  UPDATE_SUBJECT_KINDS,
  type UpdateRecord,
} from '@makinbakin/sdk/types'

const nonEmptyString = z.string().min(1)

const identitySchema = z.object({
  version: nonEmptyString.optional(),
  sha: nonEmptyString.optional(),
  digest: nonEmptyString.optional(),
  display: z.string(),
})

const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('operation'),
    start: z.object({ route: nonEmptyString, body: z.record(z.string(), z.unknown()).optional() }),
    impact: z.array(z.enum(UPDATE_IMPACTS)),
    downloadBytes: z.number().nonnegative().optional(),
  }),
  z.object({ kind: z.literal('manual'), pointer: z.string() }),
])

export const updateRecordClientSchema = z.object({
  id: nonEmptyString,
  group: z.enum(UPDATE_GROUPS),
  subject: z.object({ kind: z.enum(UPDATE_SUBJECT_KINDS), id: nonEmptyString, label: z.string() }),
  installed: identitySchema.optional(),
  available: identitySchema.optional(),
  reason: z.enum(UPDATE_REASONS).optional(),
  outcome: z.enum(UPDATE_OUTCOMES),
  source: z.object({ kind: z.string(), endpoint: z.string(), ref: z.string().optional() }),
  observedAt: z.string().optional(),
  attempt: z.object({ at: z.string(), error: z.string().optional() }).optional(),
  fingerprint: z.string(),
  action: actionSchema.optional(),
  blockedReason: z.string().optional(),
  notesUrl: z.string().optional(),
  skipped: z.object({ version: nonEmptyString.optional(), sha: nonEmptyString.optional(), digest: nonEmptyString.optional() }).optional(),
})

export const updatesClientSchema = z.object({
  bootId: z.string().optional(),
  records: z.array(updateRecordClientSchema),
  generatedAt: z.string(),
  running: z.boolean(),
})

/** `POST /api/updates/check?wait=1`: the pass's ids and the records after it. */
export const updatesCheckClientSchema = z.object({
  bootId: z.string().optional(),
  ids: z.array(z.string()),
  coalesced: z.boolean(),
  records: z.array(updateRecordClientSchema).optional(),
})

const proposedChangeSchema = z.object({ kind: z.string(), target: z.string(), action: z.string(), description: z.string() })

/** A pending Health approval's full scope — the operator approves ALL of it, never one subject (D7.4). */
export const applyApprovalScopeClientSchema = z.object({
  approvalId: nonEmptyString,
  taskId: z.string(),
  title: z.string(),
  incidentIds: z.array(z.string()),
  observationIds: z.array(z.string()),
  subjectIds: z.array(z.string()),
  items: z.array(z.object({ actionId: z.string(), itemId: z.string(), safety: z.string(), changes: z.array(proposedChangeSchema) })),
  scopeHash: nonEmptyString,
})

export const applyPreviewClientSchema = z.object({
  bootId: z.string().optional(),
  preview: z.object({
    id: nonEmptyString,
    record: updateRecordClientSchema,
    action: actionSchema.optional(),
    approval: applyApprovalScopeClientSchema.optional(),
  }),
})

/** The SDK types ARE the contract; the schemas above mirror them and strip anything else. */
export interface UpdatesData {
  bootId?: string
  records: UpdateRecord[]
  generatedAt: string
  running: boolean
}
export type UpdatesCheckData = z.output<typeof updatesCheckClientSchema>
export type ApplyApprovalScopeData = z.output<typeof applyApprovalScopeClientSchema>
export interface ApplyPreviewData {
  id: string
  record: UpdateRecord
  action?: UpdateRecord['action']
  approval?: ApplyApprovalScopeData
}

/** A parsed record IS an SDK record (the schema mirrors the type); these pin that at compile time. */
export function toUpdateRecord(record: z.output<typeof updateRecordClientSchema>): UpdateRecord {
  return record
}
export function toUpdatesData(data: z.output<typeof updatesClientSchema>): UpdatesData {
  return data
}
export function toApplyPreviewData(preview: z.output<typeof applyPreviewClientSchema>['preview']): ApplyPreviewData {
  return preview
}
