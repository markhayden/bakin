import { z } from 'zod'

const MAX_FAILURE_GROUPS = 100
const MAX_AGENT_ROWS = 11
const MAX_RECENT_ENTRIES = 50
const MAX_TOP_DESTINATIONS = 10

const nonNegativeInteger = z.number().int().nonnegative()
const nonNegativeNumber = z.number().nonnegative()
const rate = z.number().min(0).max(1)
const timestamp = z.iso.datetime({ offset: true })

export const usageKindSchema = z.enum(['mcp', 'rest', 'agent'])
export const interactionCoverageSchema = z.discriminatedUnion('reason', [
  z.object({
    startsAt: timestamp,
    hasFullWindow: z.literal(true),
    reason: z.literal('full_window'),
  }).strict(),
  z.object({
    startsAt: timestamp,
    hasFullWindow: z.literal(false),
    reason: z.literal('process_restart'),
  }).strict(),
  z.object({
    startsAt: timestamp,
    hasFullWindow: z.literal(false),
    reason: z.literal('buffer_limit'),
  }).strict(),
])

export const interactionTimeBucketSchema = z.object({
  start: timestamp,
  count: nonNegativeInteger,
  failureCount: nonNegativeInteger,
  failureRate: rate,
}).strict().superRefine((bucket, context) => {
  if (bucket.failureCount > bucket.count) {
    context.addIssue({
      code: 'custom',
      path: ['failureCount'],
      message: 'failureCount cannot exceed count',
      input: bucket,
    })
  }
})

export const usageEntrySchema = z.object({
  id: z.string().min(1),
  ts: timestamp,
  kind: usageKindSchema,
  activityClass: z.enum(['user', 'system', 'routine']),
  name: z.string(),
  agent: z.string().nullable(),
  durationMs: nonNegativeNumber.nullable(),
  status: z.enum(['ok', 'error']),
  tokensIn: nonNegativeNumber.optional(),
  tokensOut: nonNegativeNumber.optional(),
  tokensCacheRead: nonNegativeNumber.optional(),
  tokensCacheWrite: nonNegativeNumber.optional(),
  costUsdMicros: nonNegativeNumber.optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
}).strict()

const usageFailureGroupSchema = z.object({
  kind: usageKindSchema,
  name: z.string(),
  destination: z.string(),
  method: z.string().min(1).nullable(),
  attempts: nonNegativeInteger,
  failures: nonNegativeInteger,
  firstFailureAt: timestamp,
  lastFailureAt: timestamp,
  agents: z.array(z.string()),
  unattributedFailures: nonNegativeInteger,
  systemFailures: nonNegativeInteger,
  medianFailureDurationMs: nonNegativeNumber.nullable(),
  latestFailure: usageEntrySchema,
}).strict().superRefine((group, context) => {
  if (group.failures > group.attempts) {
    context.addIssue({
      code: 'custom',
      path: ['failures'],
      message: 'failures cannot exceed attempts',
      input: group,
    })
  }
})

const usageByKindSchema = z.object({
  kind: usageKindSchema,
  total: nonNegativeInteger,
  failures: nonNegativeInteger,
}).strict().superRefine((row, context) => {
  if (row.failures > row.total) {
    context.addIssue({
      code: 'custom',
      path: ['failures'],
      message: 'failures cannot exceed total',
      input: row,
    })
  }
})

const usageByAgentSchema = z.object({
  agent: z.string(),
  attributed: z.boolean(),
  count: nonNegativeInteger,
  errors: nonNegativeInteger,
  lastActivity: usageEntrySchema.nullable(),
}).strict().superRefine((row, context) => {
  if (row.errors > row.count) {
    context.addIssue({
      code: 'custom',
      path: ['errors'],
      message: 'errors cannot exceed count',
      input: row,
    })
  }
})

export const usageFeedResponseSchema = z.object({
  capabilities: z.object({
    exactFailureTargeting: z.literal(true),
    sourceBalancedActivity: z.literal(true),
  }).strict(),
  window: z.enum(['5m', '1h', '24h']),
  coverage: interactionCoverageSchema,
  totals: z.object({
    count: nonNegativeInteger,
    errors: nonNegativeInteger,
    errorRate: rate,
  }).strict(),
  outcomes: z.object({
    failed: nonNegativeInteger,
    unverified: nonNegativeInteger,
    canceled: nonNegativeInteger,
    succeeded: nonNegativeInteger,
  }).strict(),
  byKind: z.array(usageByKindSchema).length(3),
  failureGroups: z.array(usageFailureGroupSchema).max(MAX_FAILURE_GROUPS),
  failureGroupPage: z.object({
    total: nonNegativeInteger,
    offset: nonNegativeInteger,
    limit: z.number().int().min(1).max(MAX_FAILURE_GROUPS),
    hasMore: z.boolean(),
  }).strict(),
  topByName: z.array(z.object({
    kind: usageKindSchema,
    method: z.string().min(1).nullable(),
    name: z.string(),
    count: nonNegativeInteger,
    errors: nonNegativeInteger,
    medianDurationMs: nonNegativeNumber.nullable(),
  }).strict().superRefine((row, context) => {
    if (row.errors > row.count) {
      context.addIssue({
        code: 'custom',
        path: ['errors'],
        message: 'errors cannot exceed count',
        input: row,
      })
    }
  })).max(MAX_TOP_DESTINATIONS),
  agentCount: nonNegativeInteger,
  byAgent: z.array(usageByAgentSchema).max(MAX_AGENT_ROWS),
  recent: z.array(usageEntrySchema).max(MAX_RECENT_ENTRIES),
  recentFailures: z.array(usageEntrySchema).max(MAX_RECENT_ENTRIES),
  recentUnverified: z.array(usageEntrySchema).max(MAX_RECENT_ENTRIES),
  timeBuckets: z.array(interactionTimeBucketSchema),
}).strict().superRefine((data, context) => {
  if (data.totals.errors > data.totals.count) {
    context.addIssue({
      code: 'custom',
      path: ['totals', 'errors'],
      message: 'errors cannot exceed count',
      input: data.totals,
    })
  }

  const expectedErrorRate = data.totals.count > 0
    ? data.totals.errors / data.totals.count
    : 0
  if (Math.abs(data.totals.errorRate - expectedErrorRate) > Number.EPSILON) {
    context.addIssue({
      code: 'custom',
      path: ['totals', 'errorRate'],
      message: 'errorRate must match errors divided by count',
      input: data.totals,
    })
  }

  const outcomeTotal = data.outcomes.failed
    + data.outcomes.unverified
    + data.outcomes.canceled
    + data.outcomes.succeeded
  if (outcomeTotal !== data.totals.count || data.outcomes.failed !== data.totals.errors) {
    context.addIssue({
      code: 'custom',
      path: ['outcomes'],
      message: 'outcomes must reconcile with totals',
      input: data.outcomes,
    })
  }

  const kinds = new Set(data.byKind.map((row) => row.kind))
  const kindTotal = data.byKind.reduce((sum, row) => sum + row.total, 0)
  const kindFailures = data.byKind.reduce((sum, row) => sum + row.failures, 0)
  if (
    kinds.size !== usageKindSchema.options.length
    || kindTotal !== data.totals.count
    || kindFailures !== data.totals.errors
  ) {
    context.addIssue({
      code: 'custom',
      path: ['byKind'],
      message: 'source totals must contain each source once and reconcile with totals',
      input: data.byKind,
    })
  }

  const attributedRows = data.byAgent.filter((row) => row.attributed)
  const unattributedRows = data.byAgent.filter((row) => !row.attributed)
  const distinctAttributedAgents = new Set(attributedRows.map((row) => row.agent))
  if (
    data.agentCount > data.totals.count
    || data.agentCount < distinctAttributedAgents.size
  ) {
    context.addIssue({
      code: 'custom',
      path: ['agentCount'],
      message: 'agentCount must describe the attributed agents in this window',
      input: data.agentCount,
    })
  }
  if (
    attributedRows.length > 10
    || distinctAttributedAgents.size !== attributedRows.length
    || unattributedRows.length > 1
    || unattributedRows.some((row) => row.agent !== 'unknown')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['byAgent'],
      message: 'agent rows must be unique, bounded, and use one unknown projection at most',
      input: data.byAgent,
    })
  }
})

export type UsageKind = z.infer<typeof usageKindSchema>
export type InteractionCoverage = z.infer<typeof interactionCoverageSchema>
export type UsageEntry = z.infer<typeof usageEntrySchema>
export type UsageFeedResponse = z.infer<typeof usageFeedResponseSchema>

export function isUsageFeedResponse(
  value: unknown,
  requestedWindow: UsageFeedResponse['window'],
): value is UsageFeedResponse {
  const result = usageFeedResponseSchema.safeParse(value)
  return result.success && result.data.window === requestedWindow
}
