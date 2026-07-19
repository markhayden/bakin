import { describe, expect, it } from 'bun:test'
import {
  agentEffortResponseSchema,
  agentUsageSnapshotResponseSchema,
  agentUsageResponseSchema,
  isAgentEffortResponse,
  isAgentUsageResponse,
  isUsageHistoryResponse,
  usageHistoryResponseSchema,
} from '../../../plugins/health/lib/agent-route-schemas'

const tokens = { input: 10, output: 2, cacheRead: 3, cacheWrite: 0, total: 15 }

function history(window: '24h' | '7d' | '30d' = '24h') {
  return {
    window,
    since: '2026-07-13',
    throughDay: '2026-07-14',
    scannedAt: '2026-07-14T18:00:00.000Z',
    coverage: {
      status: 'complete' as const,
      reason: 'complete' as const,
      agents: [{ agent: 'main', status: 'complete' as const }],
    },
    byAgent: [{ agent: 'main', tokens, costUsdMicros: 500, costedMessages: 1, messageCount: 1 }],
    byDay: [{ day: '2026-07-14', tokens, costUsdMicros: 500, costedMessages: 1, messageCount: 1 }],
    byAgentDay: [{ agent: 'main', day: '2026-07-14', tokens, originTokens: { bakin: 15, external: 0, unknown: 0 }, costUsdMicros: 500, costedMessages: 1, messageCount: 1 }],
  }
}

function effort(window: '24h' | '7d' | '30d' = '24h') {
  return {
    window,
    since: '2026-07-13',
    throughDay: '2026-07-14',
    scopeLabel: 'Local days 2026-07-13–2026-07-14',
    scannedAt: '2026-07-14T18:00:00.000Z',
    coverage: {
      status: 'complete' as const,
      reason: 'complete' as const,
      agents: [{ agent: 'main', status: 'complete' as const }],
    },
    agents: [{
      agent: 'main',
      windowTokens: 15,
      windowCostUsdMicros: 500,
      runs: 1,
      tokenApplicableRuns: 1,
      tokenMeteredRuns: 1,
      tokenAggregateRepresentable: true,
      costedRuns: 1,
      costAggregateRepresentable: true,
      completions: 1,
      tokensPerCompletion: 15,
      totalObservedTokens: 15,
      interactiveTokens: 0,
      unexplainedTokens: 0,
      flags: [],
    }],
  }
}

describe('Agents route schemas', () => {
  it('documents and accepts the complete current wire shapes', () => {
    expect(usageHistoryResponseSchema.safeParse(history()).success).toBe(true)
    expect(agentEffortResponseSchema.safeParse(effort()).success).toBe(true)
    expect(agentUsageResponseSchema.safeParse([{
      agent: 'main',
      sessionId: 'session-1',
      sessionStarted: '2026-07-14T17:00:00.000Z',
      lastMessageAt: '2026-07-14T17:05:00.000Z',
      model: 'gpt-test',
      messages: 1,
      costedMessages: 0,
      tokens,
      cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null, source: 'unavailable' },
    }]).success).toBe(true)
  })

  it('qualifies session snapshots while accepting a legacy session row in the browser', () => {
    const legacySession = {
      agent: 'main',
      sessionId: 'session-1',
      sessionStarted: '2026-07-14T17:00:00.000Z',
      model: 'gpt-test',
      messages: 1,
      tokens,
      cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null, source: 'unavailable' },
    }
    expect(isAgentUsageResponse([legacySession])).toBe(true)
    expect(agentUsageSnapshotResponseSchema.safeParse({
      generatedAt: '2026-07-14T18:00:00.000Z',
      source: { status: 'complete', reason: 'complete', failedAgents: [] },
      sessions: [{ ...legacySession, lastMessageAt: '2026-07-14T17:05:00.000Z', costedMessages: 0 }],
    }).success).toBe(true)
    expect(agentUsageSnapshotResponseSchema.safeParse({
      generatedAt: '2026-07-14T18:00:00.000Z',
      source: { status: 'unavailable', reason: 'transcript_source_unavailable', failedAgents: [] },
      sessions: [{ ...legacySession, lastMessageAt: '2026-07-14T17:05:00.000Z', costedMessages: 0 }],
    }).success).toBe(false)
  })

  it('never accepts a failed agent as a trusted current session', () => {
    const session = {
      agent: 'main',
      sessionId: 'session-1',
      sessionStarted: '2026-07-14T17:00:00.000Z',
      lastMessageAt: '2026-07-14T17:05:00.000Z',
      model: 'gpt-test',
      messages: 1,
      tokens,
      cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null, source: 'unavailable' },
    }

    const result = agentUsageSnapshotResponseSchema.safeParse({
      generatedAt: '2026-07-14T18:00:00.000Z',
      source: { status: 'partial', reason: 'session_read_failures', failedAgents: ['main'] },
      sessions: [session],
    })

    expect(result.success).toBe(false)
  })

  it('accepts a read-race snapshot only when the unstable agent is withheld', () => {
    expect(agentUsageSnapshotResponseSchema.safeParse({
      generatedAt: '2026-07-14T18:00:00.000Z',
      source: { status: 'partial', reason: 'session_read_failures', failedAgents: ['main'] },
      sessions: [],
    }).success).toBe(true)
  })

  it('requires evidence on current server responses while retaining legacy browser payloads', () => {
    const { coverage: _historyCoverage, ...legacyHistory } = history()
    const currentEffort = effort()
    const {
      coverage: _effortCoverage,
      since: _since,
      throughDay: _throughDay,
      scopeLabel: _scopeLabel,
      agents: currentAgents,
      ...legacyEffortFields
    } = currentEffort
    const legacyEffort = {
      ...legacyEffortFields,
      agents: currentAgents.map((agent) => {
        const {
          tokenApplicableRuns: _tokenApplicableRuns,
          tokenMeteredRuns: _tokenMeteredRuns,
          tokenAggregateRepresentable: _tokenAggregateRepresentable,
          costedRuns: _costedRuns,
          costAggregateRepresentable: _costAggregateRepresentable,
          // Pre-#691 servers sent one unattributed delta, no bucket split.
          interactiveTokens: _interactiveTokens,
          unexplainedTokens: _unexplainedTokens,
          ...legacyAgent
        } = agent
        return { ...legacyAgent, unattributedTokens: 0 }
      }),
    }
    const priorEffort = {
      ...currentEffort,
      agents: legacyEffort.agents,
    }
    const covered = {
      ...history(),
      scannedAt: null,
      coverage: {
        status: 'partial',
        reason: 'agent_scan_failed',
        agents: [
          { agent: 'main', status: 'complete' },
          { agent: 'pixel', status: 'partial' },
        ],
      },
    }
    expect(usageHistoryResponseSchema.safeParse(covered).success).toBe(true)
    expect(usageHistoryResponseSchema.safeParse(legacyHistory).success).toBe(false)
    expect(agentEffortResponseSchema.safeParse(legacyEffort).success).toBe(false)
    expect(agentEffortResponseSchema.safeParse(priorEffort).success).toBe(false)
    expect(isUsageHistoryResponse(legacyHistory, '24h')).toBe(true)
    expect(isAgentEffortResponse(legacyEffort, '24h')).toBe(true)
    expect(isAgentEffortResponse(priorEffort, '24h')).toBe(true)
    expect(isAgentEffortResponse({
      ...currentEffort,
      agents: [legacyEffort.agents[0]!, currentAgents[0]!],
    }, '24h')).toBe(false)
  })

  it('rejects coverage that claims complete while an agent is partial', () => {
    const impossible = {
      ...history(),
      coverage: {
        status: 'complete',
        reason: 'complete',
        agents: [{ agent: 'main', status: 'partial' }],
      },
    }
    expect(usageHistoryResponseSchema.safeParse(impossible).success).toBe(false)
  })

  it('rejects incomplete usage and impossible cost coverage', () => {
    expect(agentUsageResponseSchema.safeParse([{
      agent: 'main',
      sessionId: 'session-1',
      model: 'gpt-test',
      messages: 1,
      tokens: { total: 15 },
      cost: { total: 0.01, source: 'runtime' },
    }]).success).toBe(false)

    const impossible = history()
    impossible.byAgent[0]!.costedMessages = 2
    expect(usageHistoryResponseSchema.safeParse(impossible).success).toBe(false)

    const incompleteEffort = {
      ...effort(),
      agents: effort().agents.map((agent) => ({ ...agent, totalObservedTokens: null })),
    }
    expect(agentEffortResponseSchema.safeParse(incompleteEffort).success).toBe(false)
  })

  it('requires scannedAt to agree with current coverage', () => {
    const impossibleHistory = { ...history(), scannedAt: null }
    const partialEffort = {
      ...effort(),
      scannedAt: null,
      coverage: { status: 'partial', reason: 'agent_scan_failed', agents: [{ agent: 'main', status: 'partial' }] },
      agents: effort().agents.map((agent) => ({ ...agent, totalObservedTokens: null, interactiveTokens: null, unexplainedTokens: null })),
    }
    const impossibleEffort = { ...partialEffort, agents: effort().agents }
    expect(usageHistoryResponseSchema.safeParse(impossibleHistory).success).toBe(false)
    expect(isUsageHistoryResponse(impossibleHistory, '24h')).toBe(false)
    expect(agentEffortResponseSchema.safeParse(partialEffort).success).toBe(true)
    expect(isAgentEffortResponse(partialEffort, '24h')).toBe(true)
    expect(agentEffortResponseSchema.safeParse(impossibleEffort).success).toBe(false)
    expect(isAgentEffortResponse(impossibleEffort, '24h')).toBe(false)
  })

  it('accepts unavailable evidence while a scan generation is in progress', () => {
    const pending = {
      ...history(),
      scannedAt: null,
      coverage: { status: 'unavailable', reason: 'scan_in_progress', agents: [] },
    }

    expect(usageHistoryResponseSchema.safeParse(pending).success).toBe(true)
    expect(isUsageHistoryResponse(pending, '24h')).toBe(true)
  })

  it('accepts explicit partial ledger coverage only with unavailable totals', () => {
    const partialLedger = {
      ...effort(),
      agents: effort().agents.map((agent) => ({
        ...agent,
        windowTokens: null,
        windowCostUsdMicros: null,
        runs: 3,
        tokenApplicableRuns: 2,
        tokenMeteredRuns: 1,
        costedRuns: 1,
        completions: 1,
        tokensPerCompletion: null,
        interactiveTokens: null,
        unexplainedTokens: null,
      })),
    }
    expect(agentEffortResponseSchema.safeParse(partialLedger).success).toBe(true)
    expect(isAgentEffortResponse(partialLedger, '24h')).toBe(true)

    const plausibleSubtotal = {
      ...partialLedger,
      agents: partialLedger.agents.map((agent) => ({ ...agent, windowTokens: 10 })),
    }
    expect(agentEffortResponseSchema.safeParse(plausibleSubtotal).success).toBe(false)
    expect(isAgentEffortResponse(plausibleSubtotal, '24h')).toBe(false)

    const plausiblePartialCost = {
      ...partialLedger,
      agents: partialLedger.agents.map((agent) => ({ ...agent, windowCostUsdMicros: 5 })),
    }
    expect(agentEffortResponseSchema.safeParse(plausiblePartialCost).success).toBe(false)

    const overCounted = {
      ...partialLedger,
      agents: partialLedger.agents.map((agent) => ({ ...agent, tokenApplicableRuns: 4 })),
    }
    expect(agentEffortResponseSchema.safeParse(overCounted).success).toBe(false)

    const meteredBeyondApplicable = {
      ...partialLedger,
      agents: partialLedger.agents.map((agent) => ({ ...agent, tokenMeteredRuns: 3 })),
    }
    expect(agentEffortResponseSchema.safeParse(meteredBeyondApplicable).success).toBe(false)

    const missingCompleteTotal = {
      ...partialLedger,
      agents: partialLedger.agents.map((agent) => ({ ...agent, tokenMeteredRuns: 2 })),
    }
    expect(agentEffortResponseSchema.safeParse(missingCompleteTotal).success).toBe(false)

    const impossibleRatio = {
      ...effort(),
      agents: effort().agents.map((agent) => ({ ...agent, tokensPerCompletion: 14 })),
    }
    expect(agentEffortResponseSchema.safeParse(impossibleRatio).success).toBe(false)

    const impossibleDelta = {
      ...effort(),
      agents: effort().agents.map((agent) => ({ ...agent, unexplainedTokens: 1 })),
    }
    expect(agentEffortResponseSchema.safeParse(impossibleDelta).success).toBe(false)
  })

  it('accepts media-only work as complete zero token evidence', () => {
    const mediaOnly = {
      ...effort(),
      agents: effort().agents.map((agent) => ({
        ...agent,
        windowTokens: 0,
        windowCostUsdMicros: null,
        runs: 2,
        tokenApplicableRuns: 0,
        tokenMeteredRuns: 0,
        costedRuns: 0,
        completions: 0,
        tokensPerCompletion: null,
        totalObservedTokens: 0,
        interactiveTokens: 0,
        unexplainedTokens: 0,
      })),
    }

    expect(agentEffortResponseSchema.safeParse(mediaOnly).success).toBe(true)

    const impossibleMediaTotal = {
      ...mediaOnly,
      agents: mediaOnly.agents.map((agent) => ({ ...agent, windowTokens: 1 })),
    }
    expect(agentEffortResponseSchema.safeParse(impossibleMediaTotal).success).toBe(false)
  })

  it('accepts unrepresentable aggregates only as unavailable totals with honest coverage counts', () => {
    const unrepresentable = {
      ...effort(),
      agents: effort().agents.map((agent) => ({
        ...agent,
        windowTokens: null,
        windowCostUsdMicros: null,
        tokenAggregateRepresentable: false,
        costAggregateRepresentable: false,
        tokensPerCompletion: null,
        interactiveTokens: null,
        unexplainedTokens: null,
        flags: [],
      })),
    }

    expect(agentEffortResponseSchema.safeParse(unrepresentable).success).toBe(true)
    expect(agentEffortResponseSchema.safeParse({
      ...unrepresentable,
      agents: unrepresentable.agents.map((agent) => ({ ...agent, windowTokens: 15 })),
    }).success).toBe(false)
    expect(agentEffortResponseSchema.safeParse({
      ...unrepresentable,
      agents: unrepresentable.agents.map((agent) => ({ ...agent, tokenMeteredRuns: 0 })),
    }).success).toBe(false)
    expect(agentEffortResponseSchema.safeParse({
      ...unrepresentable,
      agents: unrepresentable.agents.map((agent) => ({ ...agent, costedRuns: 0 })),
    }).success).toBe(false)
  })

  it('requires the response window to match the requested window', () => {
    expect(isUsageHistoryResponse(history('24h'), '24h')).toBe(true)
    expect(isUsageHistoryResponse(history('7d'), '24h')).toBe(false)
    expect(isAgentEffortResponse(effort('24h'), '24h')).toBe(true)
    expect(isAgentEffortResponse(effort('30d'), '24h')).toBe(false)
  })
})
