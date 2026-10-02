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

const approvalResponseSchema = z.object({
  selectedOption: z.string(),
  respondedAt: z.string(),
  actor: z.object({
    type: z.enum(['agent', 'human']),
    id: z.string(),
    displayName: z.string().optional(),
  }),
  comment: z.string().optional(),
})

const proposedChangeSchema = z.object({
  kind: z.string(),
  target: z.string(),
  action: z.string(),
  description: z.string(),
})

const repairProposalSchema = z.object({
  reportId: z.string(),
  observationIds: z.array(z.string()),
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
