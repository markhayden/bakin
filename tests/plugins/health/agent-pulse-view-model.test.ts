import { describe, expect, it } from 'bun:test'
import type { AgentUsage } from '@makinbakin/sdk/types'
import { buildAgentPulseRows } from '../../../plugins/health/lib/agent-pulse-view-model'
import type {
  AgentEffortData,
  ContextSummaryData,
  LiveNowData,
  UsageHistoryData,
} from '../../../plugins/health/types'

const tokens = (total: number) => ({
  input: total,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total,
})

describe('buildAgentPulseRows', () => {
  it('joins every observed agent and orders review flags before working and high-usage agents', () => {
    const effort: AgentEffortData = {
      window: '24h',
      scannedAt: '2026-07-14T18:00:00.000Z',
      agents: [
        {
          agent: 'expensive',
          windowTokens: 800,
          windowCostUsdMicros: 40_000,
          runs: 4,
          completions: 2,
          tokensPerCompletion: 400,
          totalObservedTokens: 1_000,
          unattributedTokens: 200,
          flags: [],
        },
        {
          agent: 'flagged',
          windowTokens: 100,
          windowCostUsdMicros: null,
          runs: 2,
          completions: 0,
          tokensPerCompletion: null,
          totalObservedTokens: 200,
          unattributedTokens: 100,
          flags: [{ kind: 'effort-no-outcome', message: 'No completion was recorded.' }],
        },
      ],
    }
    const history: UsageHistoryData = {
      window: '24h',
      since: '2026-07-13',
      throughDay: '2026-07-14',
      scannedAt: effort.scannedAt,
      byAgent: [
        { agent: 'expensive', tokens: tokens(1_000), costUsdMicros: 40_000, costedMessages: 4, messageCount: 4 },
        { agent: 'flagged', tokens: tokens(200), costUsdMicros: null, costedMessages: 0, messageCount: 2 },
      ],
      byDay: [],
      byAgentDay: [],
    }
    const latestSessions: AgentUsage[] = [{
      agent: 'session-only',
      sessionId: 'session-only-1',
      sessionStarted: '2026-07-14T17:30:00.000Z',
      model: 'gpt-test',
      messages: 1,
      tokens: tokens(50),
      cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null, source: 'unavailable' },
    }]
    const liveNow: LiveNowData = {
      generatedAt: '2026-07-14T18:01:00.000Z',
      runs: [{
        agent: 'working',
        taskId: 'task-1',
        taskTitle: 'Verify search',
        runId: 'run-1',
        startedAt: Date.parse('2026-07-14T18:00:00.000Z'),
        runningForMs: 60_000,
        heartbeatAgeMs: 2_000,
      }],
    }
    const context: ContextSummaryData = {
      ok: true,
      tokenEstimateNote: 'byte-derived estimates are approximate',
      agents: [{
        agentId: 'context-only',
        staticTaskBytes: 10_000,
        staticWorkflowBytes: 0,
        estimatedMaxTaskBytes: 16_384,
        workspaceAvailable: true,
        workspaceTotalBytes: 0,
        lastObserved: null,
      }],
    }

    const rows = buildAgentPulseRows({
      effort,
      history,
      latestSessions,
      liveNow,
      context,
      contextBudgetBytes: 65_536,
    })

    expect(rows.map((row) => row.agent)).toEqual([
      'flagged',
      'working',
      'expensive',
      'context-only',
      'session-only',
    ])
    expect(rows.find((row) => row.agent === 'flagged')?.reviewState).toBe('review')
    expect(rows.find((row) => row.agent === 'working')?.liveRun?.taskTitle).toBe('Verify search')
    expect(rows.find((row) => row.agent === 'context-only')?.startupContextPercent).toBe(25)
  })

  it('keeps missing coverage and unreported cost unknown instead of converting them to healthy zeroes', () => {
    const effort: AgentEffortData = {
      window: '24h',
      scannedAt: null,
      agents: [{
        agent: 'unknown',
        windowTokens: 0,
        windowCostUsdMicros: null,
        runs: 0,
        completions: 0,
        tokensPerCompletion: null,
        totalObservedTokens: null,
        unattributedTokens: null,
        flags: [],
      }],
    }

    const [row] = buildAgentPulseRows({
      effort,
      history: null,
      latestSessions: [],
      liveNow: null,
      context: null,
      contextBudgetBytes: null,
    })

    expect(row?.reviewState).toBe('unknown')
    expect(row?.historyCostUsdMicros).toBeNull()
    expect(row?.startupContextPercent).toBeNull()
    expect(row?.evidenceAligned).toBe(false)
  })

  it('keeps an explicit review flag visible even when transcript coverage is unavailable', () => {
    const effort: AgentEffortData = {
      window: '24h',
      scannedAt: null,
      agents: [{
        agent: 'flagged-without-coverage',
        windowTokens: 0,
        windowCostUsdMicros: null,
        runs: 1,
        completions: 0,
        tokensPerCompletion: null,
        totalObservedTokens: null,
        unattributedTokens: null,
        flags: [{ kind: 'effort-no-outcome', message: 'No completion was recorded.' }],
      }],
    }

    const [row] = buildAgentPulseRows({
      effort,
      history: null,
      latestSessions: [],
      liveNow: null,
      context: null,
      contextBudgetBytes: null,
    })

    expect(row?.reviewState).toBe('review')
  })

  it('chooses the longest-running task and retains the number of concurrent runs', () => {
    const liveNow: LiveNowData = {
      generatedAt: '2026-07-14T18:01:00.000Z',
      runs: [
        {
          agent: 'main',
          taskId: 'short',
          taskTitle: 'Short task',
          runId: 'run-short',
          startedAt: 2,
          runningForMs: 10,
          heartbeatAgeMs: 1,
        },
        {
          agent: 'main',
          taskId: 'long',
          taskTitle: 'Long task',
          runId: 'run-long',
          startedAt: 1,
          runningForMs: 20,
          heartbeatAgeMs: 1,
        },
      ],
    }

    const [row] = buildAgentPulseRows({
      effort: null,
      history: null,
      latestSessions: [],
      liveNow,
      context: null,
      contextBudgetBytes: null,
    })

    expect(row?.liveRun?.taskTitle).toBe('Long task')
    expect(row?.liveRunCount).toBe(2)
  })

  it('marks independently loaded usage and effort snapshots as mixed evidence', () => {
    const effort: AgentEffortData = {
      window: '24h',
      scannedAt: '2026-07-14T18:00:00.000Z',
      agents: [],
    }
    const history: UsageHistoryData = {
      window: '24h',
      since: '2026-07-13',
      throughDay: '2026-07-14',
      scannedAt: '2026-07-14T18:05:00.000Z',
      byAgent: [{ agent: 'main', tokens: tokens(100), costUsdMicros: 1_000, costedMessages: 1, messageCount: 1 }],
      byDay: [],
      byAgentDay: [],
    }

    const [row] = buildAgentPulseRows({
      effort,
      history,
      latestSessions: [],
      liveNow: null,
      context: null,
      contextBudgetBytes: null,
    })

    expect(row?.evidenceAligned).toBe(false)
  })
})
