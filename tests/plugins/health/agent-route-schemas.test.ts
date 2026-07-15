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
    byAgentDay: [{ agent: 'main', day: '2026-07-14', tokens, costUsdMicros: 500, costedMessages: 1, messageCount: 1 }],
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
      completions: 1,
      tokensPerCompletion: 15,
      totalObservedTokens: 15,
      unattributedTokens: 0,
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
      sessions: [{ ...legacySession, lastMessageAt: '2026-07-14T17:05:00.000Z' }],
    }).success).toBe(true)
    expect(agentUsageSnapshotResponseSchema.safeParse({
      generatedAt: '2026-07-14T18:00:00.000Z',
      source: { status: 'unavailable', reason: 'transcript_source_unavailable', failedAgents: [] },
      sessions: [{ ...legacySession, lastMessageAt: '2026-07-14T17:05:00.000Z' }],
    }).success).toBe(false)
  })

  it('requires evidence on current server responses while retaining legacy browser payloads', () => {
    const { coverage: _historyCoverage, ...legacyHistory } = history()
    const {
      coverage: _effortCoverage,
      since: _since,
      throughDay: _throughDay,
      scopeLabel: _scopeLabel,
      ...legacyEffort
    } = effort()
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
    expect(isUsageHistoryResponse(legacyHistory, '24h')).toBe(true)
    expect(isAgentEffortResponse(legacyEffort, '24h')).toBe(true)
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
    expect(usageHistoryResponseSchema.safeParse({ ...history(), scannedAt: null }).success).toBe(false)
    expect(agentEffortResponseSchema.safeParse({
      ...effort(),
      scannedAt: null,
      coverage: { status: 'partial', reason: 'agent_scan_failed', agents: [{ agent: 'main', status: 'partial' }] },
      agents: effort().agents.map((agent) => ({ ...agent, totalObservedTokens: null, unattributedTokens: null })),
    }).success).toBe(true)
  })

  it('requires the response window to match the requested window', () => {
    expect(isUsageHistoryResponse(history('24h'), '24h')).toBe(true)
    expect(isUsageHistoryResponse(history('7d'), '24h')).toBe(false)
    expect(isAgentEffortResponse(effort('24h'), '24h')).toBe(true)
    expect(isAgentEffortResponse(effort('30d'), '24h')).toBe(false)
  })
})
