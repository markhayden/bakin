/** zod at the boundary for the public record types (file reads, HTTP bodies). Mirrors `@makinbakin/sdk/types` `updates.ts`. */
import { z } from 'zod'
import {
  UPDATE_GROUPS,
  UPDATE_IMPACTS,
  UPDATE_OUTCOMES,
  UPDATE_REASONS,
  UPDATE_SUBJECT_KINDS,
  type UpdateRecord,
} from '@makinbakin/sdk/types'

export const UpdateIdentitySchema = z.object({
  version: z.string().optional(),
  sha: z.string().optional(),
  digest: z.string().optional(),
  display: z.string(),
})

export const UpdateSkipTargetSchema = z.object({
  version: z.string().optional(),
  sha: z.string().optional(),
  digest: z.string().optional(),
})

export const UpdateSubjectSchema = z.object({
  kind: z.enum(UPDATE_SUBJECT_KINDS),
  id: z.string().min(1),
  label: z.string(),
})

export const UpdateSourceRefSchema = z.object({
  kind: z.string().min(1),
  endpoint: z.string().min(1),
  ref: z.string().optional(),
})

export const UpdateActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('operation'),
    start: z.object({ route: z.string().min(1), body: z.record(z.string(), z.unknown()).optional() }),
    impact: z.array(z.enum(UPDATE_IMPACTS)),
    downloadBytes: z.number().int().nonnegative().optional(),
  }),
  z.object({ kind: z.literal('manual'), pointer: z.string().min(1) }),
])

export const UpdateRecordSchema = z.object({
  id: z.string().min(1),
  group: z.enum(UPDATE_GROUPS),
  subject: UpdateSubjectSchema,
  installed: UpdateIdentitySchema.optional(),
  available: UpdateIdentitySchema.optional(),
  reason: z.enum(UPDATE_REASONS).optional(),
  outcome: z.enum(UPDATE_OUTCOMES),
  source: UpdateSourceRefSchema,
  observedAt: z.string().datetime().optional(),
  attempt: z.object({ at: z.string().datetime(), error: z.string().optional() }).optional(),
  fingerprint: z.string().min(1),
  action: UpdateActionSchema.optional(),
  blockedReason: z.string().optional(),
  notesUrl: z.string().optional(),
  skipped: UpdateSkipTargetSchema.optional(),
}) satisfies z.ZodType<UpdateRecord>
