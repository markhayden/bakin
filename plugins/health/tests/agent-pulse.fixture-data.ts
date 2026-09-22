import type { AgentUsage } from '@makinbakin/sdk/types'
import type { AgentEffortData, UsageHistoryData } from '../types'

export const fixtureAgent = 'editorial-research-and-publication-review'
export const fixtureScan = '2026-09-22T12:00:00.000Z'
export const agentHistory: UsageHistoryData = {
  window: '24h', since: '2026-09-21', throughDay: '2026-09-22', scannedAt: fixtureScan,
  byDay: [], byAgentDay: [],
  byAgent: [
    { agent: fixtureAgent, tokens: { input: 600, output: 200, cacheRead: 400, cacheWrite: 0, total: 1200 }, costUsdMicros: 30000, costedMessages: 1, messageCount: 2 },
    { agent: 'pixel', tokens: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, total: 120 }, costUsdMicros: null, costedMessages: 0, messageCount: 1 },
  ],
}
export const agentEffort: AgentEffortData = {
  window: '24h', since: '2026-09-21', throughDay: '2026-09-22', scopeLabel: 'September 21–22', scannedAt: fixtureScan,
  agents: [
    { agent: fixtureAgent, windowTokens: 900, windowCostUsdMicros: 30000, runs: 3,
      tokenApplicableRuns: 3, tokenMeteredRuns: 3, tokenAggregateRepresentable: true,
      costedRuns: 3, costAggregateRepresentable: true, completions: 2, tokensPerCompletion: 450,
      totalObservedTokens: 1200, interactiveTokens: 0, unexplainedTokens: 300,
      flags: [{ kind: 'spike', message: 'Token use is above the recent baseline; review the latest session before starting more work.' }] },
    { agent: 'pixel', windowTokens: 120, windowCostUsdMicros: null, runs: 1,
      tokenApplicableRuns: 1, tokenMeteredRuns: 1, tokenAggregateRepresentable: true,
      costedRuns: 0, costAggregateRepresentable: true, completions: 1, tokensPerCompletion: 120,
      totalObservedTokens: 120, interactiveTokens: 0, unexplainedTokens: 0, flags: [] },
  ],
}
export const agentSessions: AgentUsage[] = [
  { agent: fixtureAgent, sessionId: 'fixture-editorial', sessionStarted: fixtureScan, lastMessageAt: fixtureScan,
    model: 'review-model-with-a-long-provider-and-version-name', messages: 2, costedMessages: 1,
    tokens: { input: 600, output: 200, cacheRead: 400, cacheWrite: 0, total: 1200 },
    cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: 0.03, source: 'runtime' } },
  { agent: 'no-evidence', sessionId: 'fixture-unknown', sessionStarted: fixtureScan, lastMessageAt: fixtureScan,
    model: 'unknown', messages: 0, costedMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null, source: 'unavailable' } },
]
