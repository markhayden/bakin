import { describe, expect, it } from 'bun:test'
import {
  agentEffortResponseSchema,
  agentUsageResponseSchema,
  isAgentEffortResponse,
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
    byAgent: [{ agent: 'main', tokens, costUsdMicros: 500, costedMessages: 1, messageCount: 1 }],
    byDay: [{ day: '2026-07-14', tokens, costUsdMicros: 500, costedMessages: 1, messageCount: 1 }],
    byAgentDay: [{ agent: 'main', day: '2026-07-14', tokens, costUsdMicros: 500, costedMessages: 1, messageCount: 1 }],
  }
}

function effort(window: '24h' | '7d' | '30d' = '24h') {
  return {
    window,
    scannedAt: '2026-07-14T18:00:00.000Z',
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
  it('documents and accepts the complete legacy-compatible wire shapes', () => {
    expect(usageHistoryResponseSchema.safeParse(history()).success).toBe(true)
    expect(agentEffortResponseSchema.safeParse(effort()).success).toBe(true)
    expect(agentUsageResponseSchema.safeParse([{
      agent: 'main',
      sessionId: 'session-1',
      sessionStarted: '2026-07-14T17:00:00.000Z',
      model: 'gpt-test',
      messages: 1,
      tokens,
      cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null, source: 'unavailable' },
    }]).success).toBe(true)
  })

  it('accepts additive per-agent evidence coverage while retaining legacy payloads', () => {
    const covered = {
      ...history(),
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
    expect(usageHistoryResponseSchema.safeParse(history()).success).toBe(true)
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
  })

  it('requires the response window to match the requested window', () => {
    expect(isUsageHistoryResponse(history('24h'), '24h')).toBe(true)
    expect(isUsageHistoryResponse(history('7d'), '24h')).toBe(false)
    expect(isAgentEffortResponse(effort('24h'), '24h')).toBe(true)
    expect(isAgentEffortResponse(effort('30d'), '24h')).toBe(false)
  })
})
