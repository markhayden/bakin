import { z } from 'zod'
import type { AgentUsage } from '@makinbakin/sdk/types'
import type { AgentEffortData, UsageHistoryData, UsageHistoryWindow } from '../types'

const nonNegativeInteger = z.number().int().nonnegative()
const nullableNonNegativeInteger = nonNegativeInteger.nullable()
const dayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const timestampSchema = z.iso.datetime({ offset: true })

export const agentWindowSchema = z.enum(['24h', '7d', '30d'])
export const agentWindowQuerySchema = z.object({
  window: agentWindowSchema.default('24h'),
}).strict()

export const agentTokenCountsSchema = z.object({
  input: nonNegativeInteger,
  output: nonNegativeInteger,
  cacheRead: nonNegativeInteger,
  cacheWrite: nonNegativeInteger,
  total: nonNegativeInteger,
}).strict()

const usageRollupFields = {
  tokens: agentTokenCountsSchema,
  costUsdMicros: nullableNonNegativeInteger,
  costedMessages: nonNegativeInteger,
  messageCount: nonNegativeInteger,
}

function checkCostCoverage(
  value: { costedMessages: number; messageCount: number },
  context: z.core.$RefinementCtx,
) {
  if (value.costedMessages > value.messageCount) {
    context.addIssue({
      code: 'custom',
      path: ['costedMessages'],
      message: 'costedMessages cannot exceed messageCount',
      input: value,
    })
  }
}

const usageByAgentSchema = z.object({
  agent: z.string().min(1),
  ...usageRollupFields,
}).strict().superRefine(checkCostCoverage)

const usageByDaySchema = z.object({
  day: dayKeySchema,
  ...usageRollupFields,
}).strict().superRefine(checkCostCoverage)

const usageByAgentDaySchema = z.object({
  agent: z.string().min(1),
  day: dayKeySchema,
  ...usageRollupFields,
}).strict().superRefine(checkCostCoverage)

export const usageEvidenceCoverageSchema = z.object({
  status: z.enum(['complete', 'partial', 'unavailable']),
  reason: z.enum([
    'complete',
    'scan_not_run',
    'scan_status_unavailable',
    'missing_session_tier',
    'roster_unavailable',
    'agent_scan_failed',
    'scan_failed',
    'scan_stale',
  ]),
  agents: z.array(z.object({
    agent: z.string().min(1),
    status: z.enum(['complete', 'partial']),
  }).strict()),
}).strict().superRefine((coverage, context) => {
  const hasPartialAgent = coverage.agents.some((agent) => agent.status === 'partial')
  const valid = coverage.status === 'complete'
    ? coverage.reason === 'complete' && !hasPartialAgent
    : coverage.status === 'partial'
      ? coverage.reason === 'agent_scan_failed' && hasPartialAgent
      : coverage.reason !== 'complete'
        && coverage.reason !== 'agent_scan_failed'
        && coverage.agents.length === 0
  if (!valid) {
    context.addIssue({
      code: 'custom',
      message: 'coverage status, reason, and per-agent states are inconsistent',
      input: coverage,
    })
  }
})

export const usageHistoryResponseSchema = z.object({
  window: agentWindowSchema,
  since: dayKeySchema,
  throughDay: dayKeySchema,
  scannedAt: timestampSchema.nullable(),
  coverage: usageEvidenceCoverageSchema.optional(),
  byAgent: z.array(usageByAgentSchema),
  byDay: z.array(usageByDaySchema),
  byAgentDay: z.array(usageByAgentDaySchema),
}).strict()

const agentEffortFlagSchema = z.object({
  kind: z.enum(['effort-no-outcome', 'spike', 'unattributed']),
  message: z.string(),
}).strict()

const agentEffortRowSchema = z.object({
  agent: z.string().min(1),
  windowTokens: nonNegativeInteger,
  windowCostUsdMicros: nullableNonNegativeInteger,
  runs: nonNegativeInteger,
  completions: nonNegativeInteger,
  tokensPerCompletion: nullableNonNegativeInteger,
  totalObservedTokens: nullableNonNegativeInteger,
  unattributedTokens: nullableNonNegativeInteger,
  flags: z.array(agentEffortFlagSchema),
}).strict().superRefine((row, context) => {
  if (
    row.totalObservedTokens !== null
    && row.unattributedTokens !== null
    && row.unattributedTokens > row.totalObservedTokens
  ) {
    context.addIssue({
      code: 'custom',
      path: ['unattributedTokens'],
      message: 'unattributedTokens cannot exceed totalObservedTokens',
      input: row,
    })
  }
})

export const agentEffortResponseSchema = z.object({
  window: agentWindowSchema,
  scannedAt: timestampSchema.nullable(),
  coverage: usageEvidenceCoverageSchema.optional(),
  agents: z.array(agentEffortRowSchema),
}).strict()

const nullableRuntimeCost = z.number().nonnegative().nullable()
const agentUsageSchema = z.object({
  agent: z.string().min(1),
  sessionId: z.string(),
  sessionStarted: z.union([timestampSchema, z.literal('')]),
  model: z.string(),
  messages: nonNegativeInteger,
  tokens: agentTokenCountsSchema,
  cost: z.object({
    input: nullableRuntimeCost,
    output: nullableRuntimeCost,
    cacheRead: nullableRuntimeCost,
    cacheWrite: nullableRuntimeCost,
    total: nullableRuntimeCost,
    source: z.enum(['runtime', 'unavailable']),
  }).strict(),
}).strict()

export const agentUsageResponseSchema = z.array(agentUsageSchema)

export function isUsageHistoryResponse(
  value: unknown,
  requestedWindow: UsageHistoryWindow,
): value is UsageHistoryData {
  const result = usageHistoryResponseSchema.safeParse(value)
  return result.success && result.data.window === requestedWindow
}

export function isAgentEffortResponse(
  value: unknown,
  requestedWindow: UsageHistoryWindow,
): value is AgentEffortData {
  const result = agentEffortResponseSchema.safeParse(value)
  return result.success && result.data.window === requestedWindow
}

export function isAgentUsageResponse(value: unknown): value is AgentUsage[] {
  return agentUsageResponseSchema.safeParse(value).success
}
