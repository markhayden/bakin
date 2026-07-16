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
    'scan_in_progress',
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

function checkScannedAtCoverage(
  response: { scannedAt: string | null; coverage: z.infer<typeof usageEvidenceCoverageSchema> },
  context: z.core.$RefinementCtx,
) {
  const matches = response.coverage.status === 'complete'
    ? response.scannedAt !== null
    : response.scannedAt === null
  if (!matches) {
    context.addIssue({
      code: 'custom',
      path: ['scannedAt'],
      message: 'scannedAt must be present only when coverage is complete',
      input: response.scannedAt,
    })
  }
}

const usageHistoryResponseFields = {
  window: agentWindowSchema,
  since: dayKeySchema,
  throughDay: dayKeySchema,
  scannedAt: timestampSchema.nullable(),
  byAgent: z.array(usageByAgentSchema),
  byDay: z.array(usageByDaySchema),
  byAgentDay: z.array(usageByAgentDaySchema),
}

const usageHistoryLegacyResponseSchema = z.object(usageHistoryResponseFields).strict()

export const usageHistoryResponseSchema = z.object({
  ...usageHistoryResponseFields,
  coverage: usageEvidenceCoverageSchema,
}).strict().superRefine(checkScannedAtCoverage)

const usageHistoryClientResponseSchema = z.union([
  usageHistoryResponseSchema,
  usageHistoryLegacyResponseSchema,
])

const agentEffortFlagSchema = z.object({
  kind: z.enum(['effort-no-outcome', 'spike', 'unattributed']),
  message: z.string(),
}).strict()

const agentEffortLegacyRowSchema = z.object({
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
  if (row.totalObservedTokens === null && row.unattributedTokens !== null) {
    context.addIssue({
      code: 'custom',
      path: ['unattributedTokens'],
      message: 'unattributedTokens requires observed token evidence',
      input: row.unattributedTokens,
    })
  }
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

const agentEffortRowSchema = z.object({
  agent: z.string().min(1),
  windowTokens: nullableNonNegativeInteger,
  windowCostUsdMicros: nullableNonNegativeInteger,
  runs: nonNegativeInteger,
  tokenApplicableRuns: nonNegativeInteger,
  tokenMeteredRuns: nonNegativeInteger,
  tokenAggregateRepresentable: z.boolean(),
  costedRuns: nonNegativeInteger,
  costAggregateRepresentable: z.boolean(),
  completions: nonNegativeInteger,
  tokensPerCompletion: nullableNonNegativeInteger,
  totalObservedTokens: nullableNonNegativeInteger,
  unattributedTokens: nullableNonNegativeInteger,
  flags: z.array(agentEffortFlagSchema),
}).strict().superRefine((row, context) => {
  if (row.tokenApplicableRuns > row.runs) {
    context.addIssue({
      code: 'custom',
      path: ['tokenApplicableRuns'],
      message: 'tokenApplicableRuns cannot exceed runs',
      input: row.tokenApplicableRuns,
    })
  }
  if (row.tokenMeteredRuns > row.tokenApplicableRuns) {
    context.addIssue({
      code: 'custom',
      path: ['tokenMeteredRuns'],
      message: 'tokenMeteredRuns cannot exceed tokenApplicableRuns',
      input: row.tokenMeteredRuns,
    })
  }
  if (row.costedRuns > row.runs) {
    context.addIssue({
      code: 'custom',
      path: ['costedRuns'],
      message: 'costedRuns cannot exceed runs',
      input: row.costedRuns,
    })
  }

  if (!row.tokenAggregateRepresentable && row.tokenMeteredRuns === 0) {
    context.addIssue({
      code: 'custom',
      path: ['tokenAggregateRepresentable'],
      message: 'a token aggregate can be unrepresentable only when at least one total was reported',
      input: row.tokenAggregateRepresentable,
    })
  }
  if (!row.costAggregateRepresentable && row.costedRuns === 0) {
    context.addIssue({
      code: 'custom',
      path: ['costAggregateRepresentable'],
      message: 'a cost aggregate can be unrepresentable only when at least one cost was reported',
      input: row.costAggregateRepresentable,
    })
  }

  const tokenEvidenceComplete = row.tokenMeteredRuns === row.tokenApplicableRuns
    && row.tokenAggregateRepresentable
  if (tokenEvidenceComplete !== (row.windowTokens !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['windowTokens'],
      message: 'windowTokens must be available exactly when every token-bearing call has token evidence',
      input: row.windowTokens,
    })
  }
  if (row.tokenApplicableRuns === 0 && row.windowTokens !== 0) {
    context.addIssue({
      code: 'custom',
      path: ['windowTokens'],
      message: 'windowTokens must be zero when no recorded call is token-bearing',
      input: row.windowTokens,
    })
  }
  if (!tokenEvidenceComplete && (
    row.tokensPerCompletion !== null
    || row.unattributedTokens !== null
    || row.flags.length > 0
  )) {
    context.addIssue({
      code: 'custom',
      message: 'partial token evidence cannot publish ratios, deltas, or burn flags',
      input: row,
    })
  }
  if (tokenEvidenceComplete && row.windowTokens !== null) {
    const expectedTokensPerCompletion = row.completions > 0
      ? Math.round(row.windowTokens / row.completions)
      : null
    if (row.tokensPerCompletion !== expectedTokensPerCompletion) {
      context.addIssue({
        code: 'custom',
        path: ['tokensPerCompletion'],
        message: 'tokensPerCompletion must agree with complete token and completion evidence',
        input: row.tokensPerCompletion,
      })
    }
    const expectedUnattributedTokens = row.totalObservedTokens === null
      ? null
      : Math.max(0, row.totalObservedTokens - row.windowTokens)
    if (row.unattributedTokens !== expectedUnattributedTokens) {
      context.addIssue({
        code: 'custom',
        path: ['unattributedTokens'],
        message: 'unattributedTokens must agree with complete observed and attributed totals',
        input: row.unattributedTokens,
      })
    }
  }

  const costEvidenceComplete = row.runs > 0
    && row.costedRuns === row.runs
    && row.costAggregateRepresentable
  if (costEvidenceComplete !== (row.windowCostUsdMicros !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['windowCostUsdMicros'],
      message: 'windowCostUsdMicros must be available exactly when every recorded run has cost evidence',
      input: row.windowCostUsdMicros,
    })
  }
  if (row.totalObservedTokens === null && row.unattributedTokens !== null) {
    context.addIssue({
      code: 'custom',
      path: ['unattributedTokens'],
      message: 'unattributedTokens requires observed token evidence',
      input: row.unattributedTokens,
    })
  }
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

const agentEffortLegacyResponseSchema = z.object({
  window: agentWindowSchema,
  scannedAt: timestampSchema.nullable(),
  agents: z.array(agentEffortLegacyRowSchema),
}).strict()

const agentEffortQualifiedEnvelopeFields = {
  window: agentWindowSchema,
  scannedAt: timestampSchema.nullable(),
  since: dayKeySchema,
  throughDay: dayKeySchema,
  scopeLabel: z.string().min(1),
  coverage: usageEvidenceCoverageSchema,
}

function checkAgentEffortCoverage(
  response: {
    scannedAt: string | null
    coverage: z.infer<typeof usageEvidenceCoverageSchema>
    agents: Array<{
      agent: string
      totalObservedTokens: number | null
      unattributedTokens: number | null
    }>
  },
  context: z.core.$RefinementCtx,
) {
  checkScannedAtCoverage(response, context)

  const coverageByAgent = new Map(response.coverage.agents.map((agent) => [agent.agent, agent.status]))
  for (const [index, agent] of response.agents.entries()) {
    const hasCompleteCoverage = coverageByAgent.get(agent.agent) === 'complete'
    if (hasCompleteCoverage && agent.totalObservedTokens === null) {
      context.addIssue({
        code: 'custom',
        path: ['agents', index, 'totalObservedTokens'],
        message: 'complete per-agent coverage requires observed token evidence',
        input: agent.totalObservedTokens,
      })
    }
    if (!hasCompleteCoverage && (agent.totalObservedTokens !== null || agent.unattributedTokens !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['agents', index, 'totalObservedTokens'],
        message: 'incomplete per-agent coverage cannot publish observed or unattributed token totals',
        input: agent.totalObservedTokens,
      })
    }
  }
}

export const agentEffortResponseSchema = z.object({
  ...agentEffortQualifiedEnvelopeFields,
  agents: z.array(agentEffortRowSchema),
}).strict().superRefine(checkAgentEffortCoverage)

// The immediately preceding server generation already published qualified
// window/coverage metadata but did not yet include per-row ledger coverage.
// Keep that exact homogeneous generation readable while the view model
// withholds its unqualified sums and verdicts.
const agentEffortPriorResponseSchema = z.object({
  ...agentEffortQualifiedEnvelopeFields,
  agents: z.array(agentEffortLegacyRowSchema),
}).strict().superRefine(checkAgentEffortCoverage)

const agentEffortClientResponseSchema = z.union([
  agentEffortResponseSchema,
  agentEffortPriorResponseSchema,
  agentEffortLegacyResponseSchema,
])

const nullableRuntimeCost = z.number().nonnegative().nullable()
const agentUsageCostSchema = z.object({
  input: nullableRuntimeCost,
  output: nullableRuntimeCost,
  cacheRead: nullableRuntimeCost,
  cacheWrite: nullableRuntimeCost,
  total: nullableRuntimeCost,
  source: z.enum(['runtime', 'unavailable']),
}).strict()

const agentUsageBaseFields = {
  agent: z.string().min(1),
  sessionId: z.string(),
  sessionStarted: z.union([timestampSchema, z.literal('')]),
  model: z.string(),
  messages: nonNegativeInteger,
  tokens: agentTokenCountsSchema,
  cost: agentUsageCostSchema,
}

function checkAgentUsageCostSource(
  row: { cost: z.infer<typeof agentUsageCostSchema> },
  context: z.core.$RefinementCtx,
) {
  const values = [row.cost.input, row.cost.output, row.cost.cacheRead, row.cost.cacheWrite, row.cost.total]
  const hasReportedCost = values.some((value) => value !== null)
  const consistent = row.cost.source === 'runtime'
    ? row.cost.total !== null
    : !hasReportedCost
  if (!consistent) {
    context.addIssue({
      code: 'custom',
      path: ['cost'],
      message: 'cost source must agree with the reported runtime cost fields',
      input: row.cost,
    })
  }
}

const agentUsageLegacySchema = z.object(agentUsageBaseFields)
  .strict()
  .superRefine(checkAgentUsageCostSource)

const agentUsagePriorSchema = z.object({
  ...agentUsageBaseFields,
  lastMessageAt: timestampSchema.nullable(),
}).strict().superRefine(checkAgentUsageCostSource)

const agentUsageSchema = z.object({
  ...agentUsageBaseFields,
  lastMessageAt: timestampSchema.nullable(),
  costedMessages: nonNegativeInteger,
}).strict().superRefine((row, context) => {
  checkAgentUsageCostSource(row, context)
  if (row.costedMessages > row.messages) {
    context.addIssue({
      code: 'custom',
      path: ['costedMessages'],
      message: 'costedMessages cannot exceed messages',
      input: row.costedMessages,
    })
  }
  // A runtime subtotal can be useful even when none of the contributing
  // messages had complete cost evidence. Only a nonzero coverage count
  // requires a runtime total; unavailable evidence cannot claim coverage.
  const coverageMatches = row.costedMessages === 0
    || (row.cost.source === 'runtime' && row.cost.total !== null)
  if (!coverageMatches) {
    context.addIssue({
      code: 'custom',
      path: ['costedMessages'],
      message: 'costedMessages must agree with runtime cost availability',
      input: row.costedMessages,
    })
  }
})

export const agentUsageResponseSchema = z.array(agentUsageSchema)
export const agentUsageClientResponseSchema = z.union([
  agentUsageResponseSchema,
  z.array(agentUsagePriorSchema),
  z.array(agentUsageLegacySchema),
])

const agentUsageSourceSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('complete'),
    reason: z.literal('complete'),
    failedAgents: z.tuple([]),
  }).strict(),
  z.object({
    status: z.literal('partial'),
    reason: z.literal('session_read_failures'),
    failedAgents: z.array(z.string().min(1)).min(1),
  }).strict(),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['transcript_source_unavailable', 'agent_roster_unavailable']),
    failedAgents: z.tuple([]),
  }).strict(),
])

function checkAgentUsageSnapshot(
  snapshot: {
    source: z.infer<typeof agentUsageSourceSchema>
    sessions: Array<{ agent: string }>
  },
  context: z.core.$RefinementCtx,
) {
  if (snapshot.source.status === 'unavailable' && snapshot.sessions.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['sessions'],
      message: 'Unavailable usage evidence cannot include sessions',
      input: snapshot.sessions,
    })
  }
  const sessionAgents = new Set(snapshot.sessions.map((session) => session.agent))
  const duplicateFailedAgent = snapshot.source.failedAgents.find((agent) => sessionAgents.has(agent))
  if (duplicateFailedAgent) {
    context.addIssue({
      code: 'custom',
      path: ['source', 'failedAgents'],
      message: 'A failed agent cannot also publish a current session',
      input: duplicateFailedAgent,
    })
  }
}

export const agentUsageSnapshotResponseSchema = z.object({
  generatedAt: timestampSchema,
  source: agentUsageSourceSchema,
  sessions: agentUsageResponseSchema,
}).strict().superRefine(checkAgentUsageSnapshot)

const agentUsagePriorSnapshotResponseSchema = z.object({
  generatedAt: timestampSchema,
  source: agentUsageSourceSchema,
  sessions: z.array(agentUsagePriorSchema),
}).strict().superRefine(checkAgentUsageSnapshot)

const agentUsageSnapshotClientResponseSchema = z.union([
  agentUsageSnapshotResponseSchema,
  agentUsagePriorSnapshotResponseSchema,
])

export type AgentUsageSnapshotData = z.output<typeof agentUsageSnapshotClientResponseSchema>

export function isUsageHistoryResponse(
  value: unknown,
  requestedWindow: UsageHistoryWindow,
): value is UsageHistoryData {
  const result = usageHistoryClientResponseSchema.safeParse(value)
  return result.success && result.data.window === requestedWindow
}

export function isAgentEffortResponse(
  value: unknown,
  requestedWindow: UsageHistoryWindow,
): value is AgentEffortData {
  const result = agentEffortClientResponseSchema.safeParse(value)
  return result.success && result.data.window === requestedWindow
}

export function isAgentUsageResponse(value: unknown): value is AgentUsage[] {
  return agentUsageClientResponseSchema.safeParse(value).success
}

export function isAgentUsageSnapshotResponse(value: unknown): value is AgentUsageSnapshotData {
  return agentUsageSnapshotClientResponseSchema.safeParse(value).success
}
