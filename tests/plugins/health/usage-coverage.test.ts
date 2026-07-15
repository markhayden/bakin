import { describe, expect, it } from 'bun:test'
import { scopeUsageHistoryToCompleteEvidence } from '../../../plugins/health/lib/usage-coverage'
import type { UsageHistoryData } from '../../../plugins/health/types'

const tokens = (total: number) => ({
  input: total,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total,
})

describe('scopeUsageHistoryToCompleteEvidence', () => {
  it('excludes retained orphan rows even when the current roster scan is complete', () => {
    const history: UsageHistoryData = {
      window: '24h',
      since: '2026-07-13',
      throughDay: '2026-07-14',
      scannedAt: '2026-07-14T18:00:00.000Z',
      coverage: {
        status: 'complete',
        reason: 'complete',
        agents: [{ agent: 'main', status: 'complete' }],
      },
      byAgent: [
        { agent: 'main', tokens: tokens(100), costUsdMicros: 1, costedMessages: 1, messageCount: 1 },
        { agent: 'removed', tokens: tokens(900), costUsdMicros: 9, costedMessages: 1, messageCount: 1 },
      ],
      byDay: [
        { day: '2026-07-14', tokens: tokens(1_000), costUsdMicros: 10, costedMessages: 2, messageCount: 2 },
      ],
      byAgentDay: [
        { agent: 'main', day: '2026-07-14', tokens: tokens(100), costUsdMicros: 1, costedMessages: 1, messageCount: 1 },
        { agent: 'removed', day: '2026-07-14', tokens: tokens(900), costUsdMicros: 9, costedMessages: 1, messageCount: 1 },
      ],
    }

    const scoped = scopeUsageHistoryToCompleteEvidence(history)

    expect(scoped.history.byAgent.map((row) => row.agent)).toEqual(['main'])
    expect(scoped.history.byAgentDay.map((row) => row.agent)).toEqual(['main'])
    expect(scoped.history.byDay).toEqual([])
    expect(scoped.includedAgentCount).toBe(1)
    expect(scoped.excludedAgentCount).toBe(1)
  })
})
