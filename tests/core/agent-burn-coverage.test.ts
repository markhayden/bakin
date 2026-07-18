import { beforeEach, describe, expect, it } from 'bun:test'
import {
  buildAgentBurnReports,
  type AgentBurnSources,
  type BurnConfig,
} from '../../src/core/agent-burn'

type UsageCell = {
  agent: string
  day: string
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  originTokens: { bakin: number; external: number; unknown: number }
  costUsdMicros: number | null
  costedMessages: number
  messageCount: number
}

const usageCells: UsageCell[] = []
let storeThrows = false
const attributed = [
  { agent: 'basil', totalTokens: 10, costUsdMicros: null, runs: 1, tokenApplicableRuns: 1, tokenMeteredRuns: 1, tokenAggregateRepresentable: true, costedRuns: 0, costAggregateRepresentable: true },
  { agent: 'clover', totalTokens: 10, costUsdMicros: null, runs: 1, tokenApplicableRuns: 1, tokenMeteredRuns: 1, tokenAggregateRepresentable: true, costedRuns: 0, costAggregateRepresentable: true },
]

function localDayKey(tsMs: number): string {
  const d = new Date(tsMs)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const sources: AgentBurnSources = {
  readUsageHistorySince: (sinceDay: string) => {
    if (storeThrows) throw new Error('usage store unavailable')
    return {
      byAgent: [],
      byDay: [],
      byAgentDay: usageCells.filter((cell) => cell.day >= sinceDay),
    }
  },
  readSessionUsageRollupsSince: () => [],
  runTokensByAgentSince: () => attributed,
  completionsByAgentSince: () => [],
}

const config: BurnConfig = {
  windowHours: 24,
  minTokensFloor: 500_000,
  spikeMultiplier: 3,
  baselineDays: 7,
  unattributedShare: 0.5,
  unattributedFloorTokens: 100_000,
  runawayAssistantTurns: 20,
  runawayFloorTokens: 1_000_000,
}

const NOW = new Date(2026, 6, 14, 12, 0, 0).getTime()
const TODAY = localDayKey(NOW)

beforeEach(() => {
  storeThrows = false
  usageCells.length = 0
})

describe('buildAgentBurnReports coverage', () => {
  it('uses scan completeness per agent and includes a completely scanned idle agent', () => {
    usageCells.push(
      {
        agent: 'basil', day: TODAY,
        tokens: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, total: 100 },
        originTokens: { bakin: 0, external: 0, unknown: 100 },
        costUsdMicros: null, costedMessages: 0, messageCount: 1,
      },
      {
        agent: 'clover', day: TODAY,
        tokens: { input: 20, output: 0, cacheRead: 0, cacheWrite: 0, total: 20 },
        originTokens: { bakin: 0, external: 0, unknown: 20 },
        costUsdMicros: null, costedMessages: 0, messageCount: 1,
      },
    )

    const reports = buildAgentBurnReports(NOW, {
      config,
      sources,
      coverage: {
        agents: [
          { agent: 'basil', status: 'complete' },
          { agent: 'clover', status: 'partial' },
          { agent: 'sage', status: 'complete' },
        ],
      },
    })

    expect(reports.find((report) => report.agent === 'basil')?.totalObservedTokens).toBe(100)
    expect(reports.find((report) => report.agent === 'clover')?.totalObservedTokens).toBeNull()
    expect(reports.find((report) => report.agent === 'sage')?.totalObservedTokens).toBe(0)
    expect(reports.find((report) => report.agent === 'sage')?.windowTokens).toBe(0)
  })

  it('preserves a nullable ledger total as unknown instead of treating it as zero', () => {
    usageCells.push({
      agent: 'basil', day: TODAY,
      tokens: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, total: 1_000_000 },
      originTokens: { bakin: 0, external: 0, unknown: 1_000_000 },
      costUsdMicros: null, costedMessages: 0, messageCount: 1,
    })
    const unknownMeteringSources: AgentBurnSources = {
      ...sources,
      runTokensByAgentSince: () => [{
        agent: 'basil',
        totalTokens: null,
        costUsdMicros: null,
        runs: 3,
        tokenApplicableRuns: 3,
        tokenMeteredRuns: 0,
        tokenAggregateRepresentable: true,
        costedRuns: 0,
        costAggregateRepresentable: true,
      }],
    }

    const basil = buildAgentBurnReports(NOW, {
      config,
      sources: unknownMeteringSources,
      coverage: { agents: [{ agent: 'basil', status: 'complete' }] },
    }).find((report) => report.agent === 'basil')

    expect(basil?.windowTokens).toBeNull()
    expect(basil?.totalObservedTokens).toBe(1_000_000)
    expect(basil?.unexplainedTokens).toBeNull()
    expect(basil?.flags).toEqual([])
  })

  it('does not publish plausible partial token or cost subtotals', () => {
    usageCells.push({
      agent: 'basil', day: TODAY,
      tokens: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, total: 1_000_000 },
      originTokens: { bakin: 0, external: 0, unknown: 1_000_000 },
      costUsdMicros: null, costedMessages: 0, messageCount: 1,
    })
    const partiallyMeteredSources: AgentBurnSources = {
      ...sources,
      runTokensByAgentSince: () => [{
        agent: 'basil',
        totalTokens: 600_000,
        costUsdMicros: 40_000,
        runs: 3,
        tokenApplicableRuns: 3,
        tokenMeteredRuns: 2,
        tokenAggregateRepresentable: true,
        costedRuns: 1,
        costAggregateRepresentable: true,
      }],
    }

    const basil = buildAgentBurnReports(NOW, {
      config,
      sources: partiallyMeteredSources,
      coverage: { agents: [{ agent: 'basil', status: 'complete' }] },
    }).find((report) => report.agent === 'basil')

    expect(basil).toMatchObject({
      windowTokens: null,
      windowCostUsdMicros: null,
      runs: 3,
      tokenApplicableRuns: 3,
      tokenMeteredRuns: 2,
      costedRuns: 1,
      totalObservedTokens: 1_000_000,
      unexplainedTokens: null,
      flags: [],
    })
  })

  it('threads origin splits and session rollups into the evaluator (#691)', () => {
    usageCells.push({
      agent: 'basil', day: TODAY,
      tokens: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, total: 1_000_000 },
      originTokens: { bakin: 0, external: 950_000, unknown: 50_000 },
      costUsdMicros: null, costedMessages: 0, messageCount: 1,
    })
    const originSources: AgentBurnSources = {
      ...sources,
      readSessionUsageRollupsSince: () => [{
        agent: 'basil',
        sessionId: 'tui-session',
        origin: 'external',
        totalTokens: 950_000,
        userMessages: 12,
        assistantMessages: 40,
        lastTs: NOW,
      }],
    }

    const basil = buildAgentBurnReports(NOW, {
      config,
      sources: originSources,
      coverage: { agents: [{ agent: 'basil', status: 'complete' }] },
    }).find((report) => report.agent === 'basil')

    expect(basil?.interactiveTokens).toBe(950_000)
    // 50k unknown-origin minus 10 attributed — unknown never counts interactive.
    expect(basil?.unexplainedTokens).toBe(49_990)
    expect(basil?.flags.map((f) => f.kind)).toEqual(['interactive'])
  })

  it('propagates a store read failure instead of evaluating empty usage as zero', () => {
    storeThrows = true

    expect(() => buildAgentBurnReports(NOW, {
      config,
      sources,
      coverage: {
        agents: [{ agent: 'basil', status: 'complete' }],
      },
    })).toThrow('usage store unavailable')
  })

  it('does not leak baseline-derived spike flags when the latest scan is unavailable', () => {
    const yesterday = localDayKey(NOW - 86_400_000)
    usageCells.push(
      {
        agent: 'basil', day: yesterday,
        tokens: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, total: 10 },
        originTokens: { bakin: 0, external: 0, unknown: 10 },
        costUsdMicros: null, costedMessages: 0, messageCount: 1,
      },
      {
        agent: 'basil', day: TODAY,
        tokens: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, total: 1_000_000 },
        originTokens: { bakin: 0, external: 0, unknown: 1_000_000 },
        costUsdMicros: null, costedMessages: 0, messageCount: 1,
      },
    )

    const basil = buildAgentBurnReports(NOW, {
      config,
      sources,
      coverage: { agents: [] },
    }).find((report) => report.agent === 'basil')

    expect(basil?.totalObservedTokens).toBeNull()
    expect(basil?.flags.some((flag) => flag.kind === 'spike')).toBe(false)
  })

  it('uses exact local calendar dates in window-scoped flag wording', () => {
    const flaggedSources: AgentBurnSources = {
      ...sources,
      runTokensByAgentSince: () => [{
        agent: 'basil',
        totalTokens: 600_000,
        costUsdMicros: null,
        runs: 3,
        tokenApplicableRuns: 3,
        tokenMeteredRuns: 3,
        tokenAggregateRepresentable: true,
        costedRuns: 0,
        costAggregateRepresentable: true,
      }],
    }

    const [report] = buildAgentBurnReports(NOW, {
      config,
      sources: flaggedSources,
      coverage: { agents: [] },
    })

    expect(report?.flags[0]?.message).toContain('2026-07-13 through 2026-07-14')
    expect(report?.flags[0]?.message).not.toContain('24h')
  })
})
