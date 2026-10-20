/**
 * Zod shape for approval records — validated on every read so a hand-edited
 * or truncated file is skipped with a warning, never trusted (CLAUDE.md:
 * zod at the file boundary).
 */
import { z } from 'zod'
import type { ApprovalRecord } from './types'

const approvalOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  variant: z.enum(['primary', 'destructive', 'neutral']).optional(),
})

const approvalDeliverySchema = z.object({
  channelId: z.string(),
  ref: z.string(),
  renderedAt: z.string(),
})

export const approvalProvenanceSchema = z.object({
  channel: z.enum(['ui', 'cli', 'discord', 'mcp', 'runtime', 'hook']),
  actor: z.object({
    kind: z.enum(['operator-declared', 'agent', 'channel-user', 'unknown']),
    id: z.string().optional(),
    displayName: z.string().optional(),
  }),
  evidence: z.enum(['declared', 'runtime-context', 'provider']),
})

/**
 * A decision. Records written before provenance (#898) carry an `actor`
 * that claimed `type: 'human'` for whoever clicked — it is dropped on read,
 * never translated: such a record shows "Provenance unavailable — legacy
 * record" (D-H7), and its status/decision/timestamps stay intact so an
 * idempotent create can never reopen it.
 */
const approvalResponseSchema = z.object({
  selectedOption: z.string(),
  respondedAt: z.string(),
  provenance: approvalProvenanceSchema.optional(),
  comment: z.string().optional(),
}).transform(({ selectedOption, respondedAt, provenance, comment }) => ({
  selectedOption,
  respondedAt,
  ...(provenance ? { provenance } : {}),
  ...(comment !== undefined ? { comment } : {}),
}))

const proposedChangeSchema = z.object({
  kind: z.string(),
  target: z.string(),
  action: z.string(),
  description: z.string(),
})

export const repairFailureSchema = z.object({
  operationId: z.string(),
  stage: z.string(),
  error: z.string(),
  at: z.string(),
})

export const repairProposalSchema = z.object({
  reportId: z.string(),
  observationIds: z.array(z.string()),
  failure: repairFailureSchema.optional(),
  items: z.array(z.object({
    actionId: z.string(),
    itemId: z.string(),
    safety: z.enum(['safe', 'manual', 'destructive']),
    changes: z.array(proposedChangeSchema),
  })),
})

const ownerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workflow-gate'), taskId: z.string(), workflowId: z.string(), runId: z.string(), stepId: z.string() }),
  z.object({ kind: z.literal('health-repair'), taskId: z.string(), requestId: z.string(), incidentIds: z.array(z.string()), proposal: repairProposalSchema }),
  z.object({ kind: z.literal('health-navigate'), taskId: z.string(), requestId: z.string(), incidentIds: z.array(z.string()), href: z.string() }),
])

export const approvalRecordSchema = z.object({
  approvalId: z.string().min(1),
  owner: ownerSchema,
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'expired']),
  request: z.object({
    title: z.string(),
    body: z.string(),
    options: z.array(approvalOptionSchema),
    expiresAt: z.string().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  }),
  deliveries: z.array(approvalDeliverySchema),
  response: approvalResponseSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().optional(),
})

export function parseApprovalRecord(raw: unknown): ApprovalRecord | null {
  const parsed = approvalRecordSchema.safeParse(raw)
  return parsed.success ? (parsed.data as ApprovalRecord) : null
}
