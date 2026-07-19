/**
 * Agent burn evaluator (#385, buckets #691) — pure effort-vs-outcome / spike /
 * interactive / unexplained / runaway heuristics. The evaluator never
 * fabricates data: unknown observed usage is null (scanner hasn't covered the
 * window), never zero; unknown-origin tokens count toward unexplained, never
 * toward the calm interactive bucket.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// Pure-evaluator test, but the settings import chain reaches content-dir —
// point it at a temp dir so nothing can touch ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-agent-burn-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { evaluateAgentBurn, type AgentBurnInputs, type BurnConfig, type BurnSessionRollup } from '../../src/core/agent-burn'
import { DEFAULT_SETTINGS } from '../../packages/core/src/settings'

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

function inputs(overrides: Partial<AgentBurnInputs> = {}): AgentBurnInputs {
  const merged: AgentBurnInputs = {
    agent: 'pixel',
    attributedTokens: 0,
    attributedCostUsdMicros: null,
    runs: 0,
    tokenApplicableRuns: 0,
    tokenMeteredRuns: 0,
    tokenAggregateRepresentable: true,
    costedRuns: 0,
    costAggregateRepresentable: true,
    completions: 0,
    observedTokens: null,
    todayObservedTokens: null,
    baselineDailyTokens: [],
    sessions: [],
    scheduledJobs: null,
    ...overrides,
  }
  if (overrides.tokenApplicableRuns === undefined) {
    merged.tokenApplicableRuns = merged.runs
  }
  if (overrides.tokenMeteredRuns === undefined) {
    merged.tokenMeteredRuns = merged.attributedTokens === null ? 0 : merged.tokenApplicableRuns
  }
  if (overrides.costedRuns === undefined) {
    merged.costedRuns = merged.attributedCostUsdMicros === null ? 0 : merged.runs
  }
  return merged
}

function session(overrides: Partial<BurnSessionRollup> = {}): BurnSessionRollup {
  return {
    sessionId: 'sess-1',
    origin: 'external',
    totalTokens: 2_000_000,
    userMessages: 0,
    assistantMessages: 30,
    ...overrides,
  }
}

function flagKinds(i: AgentBurnInputs) {
  return evaluateAgentBurn(i, config).flags.map((f) => f.kind)
}

describe('settings', () => {
  it('burn block ships with the spec defaults', () => {
    expect(DEFAULT_SETTINGS.burn).toEqual({
      windowHours: 24,
      minTokensFloor: 500_000,
      spikeMultiplier: 3,
      baselineDays: 7,
      unattributedShare: 0.5,
      unattributedFloorTokens: 100_000,
      runawayAssistantTurns: 20,
      runawayFloorTokens: 1_000_000,
    })
  })
})

describe('effort-no-outcome', () => {
  it('flags heavy burn with zero completions, message carries the numbers', () => {
    const report = evaluateAgentBurn(inputs({ attributedTokens: 2_100_000, runs: 14 }), config)
    expect(report.flags.map((f) => f.kind)).toEqual(['effort-no-outcome'])
    expect(report.flags[0]!.message).toContain('pixel')
    expect(report.flags[0]!.message).toContain('14 run')
    expect(report.tokensPerCompletion).toBeNull()
  })

  it('stays quiet below the floor or when work completes', () => {
    expect(flagKinds(inputs({ attributedTokens: 499_999, runs: 9 }))).toEqual([])
    expect(flagKinds(inputs({ attributedTokens: 2_000_000, runs: 4, completions: 2 }))).toEqual([])
  })

  it('computes tokensPerCompletion when there are completions', () => {
    const report = evaluateAgentBurn(
      inputs({ attributedTokens: 900_000, runs: 3, completions: 3 }),
      config,
    )
    expect(report.tokensPerCompletion).toBe(300_000)
  })

  it('does not describe a day-aligned calendar scope as an exact 24-hour window', () => {
    const report = evaluateAgentBurn(inputs({ attributedTokens: 2_100_000, runs: 14 }), config)

    expect(report.flags[0]!.message).toContain('selected day-aligned window')
    expect(report.flags[0]!.message).not.toContain('24h')
  })
})

describe('spike', () => {
  it('flags today far above the trailing baseline', () => {
    const kinds = flagKinds(
      inputs({ todayObservedTokens: 1_600_000, baselineDailyTokens: [400_000, 500_000, 600_000] }),
    )
    expect(kinds).toEqual(['spike'])
  })

  it('needs the floor too — 3x a tiny baseline is not a spike', () => {
    expect(
      flagKinds(inputs({ todayObservedTokens: 90_000, baselineDailyTokens: [10_000, 20_000] })),
    ).toEqual([])
  })

  it('no baseline days → no spike judgment', () => {
    expect(flagKinds(inputs({ todayObservedTokens: 5_000_000, baselineDailyTokens: [] }))).toEqual([])
  })
})

describe('interactive bucket (#691)', () => {
  const chatSession = (tokens: number, overrides: Partial<BurnSessionRollup> = {}) =>
    session({ totalTokens: tokens, userMessages: 12, assistantMessages: 40, ...overrides })

  it('flags interactive-session usage as calm advisory copy — never scary', () => {
    const report = evaluateAgentBurn(
      inputs({
        attributedTokens: 200_000,
        observedTokens: 10_200_000,
        sessions: [chatSession(10_000_000)],
        runs: 3,
        completions: 1,
      }),
      config,
    )
    expect(report.interactiveTokens).toBe(10_000_000)
    const flag = report.flags.find((f) => f.kind === 'interactive')
    expect(flag).toBeDefined()
    expect(flag!.message).toContain('interactive runtime sessions')
    expect(flag!.message).toContain('normal if you were working with this agent directly')
    expect(flag!.message).not.toContain('outside Bakin-managed tasks')
  })

  it('interactive usage alone produces no unexplained flag', () => {
    const report = evaluateAgentBurn(
      inputs({
        attributedTokens: 200_000,
        observedTokens: 10_200_000,
        sessions: [chatSession(10_000_000)],
        runs: 3,
        completions: 1,
      }),
      config,
    )
    expect(report.unexplainedTokens).toBe(0)
    expect(report.flags.some((f) => f.kind === 'unexplained')).toBe(false)
  })

  it('a zero-user-turn external session is never calm — its tokens are unexplained, not interactive', () => {
    // 800k autonomous tokens below the runaway thresholds must not hide
    // behind "you were working with this agent directly".
    const report = evaluateAgentBurn(
      inputs({
        observedTokens: 800_000,
        sessions: [session({ totalTokens: 800_000, userMessages: 0, assistantMessages: 15 })],
      }),
      config,
    )
    expect(report.interactiveTokens).toBe(0)
    expect(report.unexplainedTokens).toBe(800_000)
    expect(report.flags.map((f) => f.kind)).toEqual(['unexplained'])
  })

  it('below share or floor → no interactive flag', () => {
    expect(flagKinds(inputs({
      attributedTokens: 600_000,
      observedTokens: 1_000_000,
      sessions: [chatSession(400_000)],
      completions: 1,
    }))).toEqual([])
    expect(flagKinds(inputs({
      observedTokens: 60_000,
      sessions: [chatSession(55_000)],
    }))).toEqual([])
  })
})

describe('unexplained bucket (#691)', () => {
  it('flags tokens no ledger row or interactive session explains', () => {
    const report = evaluateAgentBurn(
      inputs({ attributedTokens: 210_000, observedTokens: 1_000_000, runs: 14 }),
      config,
    )
    expect(report.unexplainedTokens).toBe(790_000)
    expect(report.flags.map((f) => f.kind)).toEqual(['unexplained'])
    expect(report.flags[0]!.message).toContain('could not attribute')
    expect(report.flags[0]!.message).toContain('review its recent sessions')
  })

  it('unknown-origin tokens land in unexplained, never in interactive', () => {
    // Observed 1M, no user-proven external session, attributed 0 → all unexplained.
    const report = evaluateAgentBurn(
      inputs({ observedTokens: 1_000_000, sessions: [session({ origin: 'unknown', totalTokens: 1_000_000 })] }),
      config,
    )
    expect(report.interactiveTokens).toBe(0)
    expect(report.unexplainedTokens).toBe(1_000_000)
    expect(report.flags.map((f) => f.kind)).toEqual(['unexplained'])
  })

  it('strengthens the copy when a spike fires the same day', () => {
    const report = evaluateAgentBurn(
      inputs({
        observedTokens: 900_000,
        todayObservedTokens: 900_000,
        baselineDailyTokens: [100_000, 150_000],
      }),
      config,
    )
    const flag = report.flags.find((f) => f.kind === 'unexplained')
    expect(flag).toBeDefined()
    expect(flag!.kind === 'unexplained' && flag!.spikeConcurrent).toBe(true)
    expect(flag!.message).toContain('well above its daily average')
  })

  it('clamps to zero when attributed exceeds observed (scan lag)', () => {
    const report = evaluateAgentBurn(
      inputs({ attributedTokens: 500_000, observedTokens: 400_000, completions: 1 }),
      config,
    )
    expect(report.unexplainedTokens).toBe(0)
    expect(report.flags).toEqual([])
  })

  it('below the share or floor → no flag', () => {
    expect(flagKinds(inputs({ attributedTokens: 600_000, observedTokens: 1_000_000, completions: 1 }))).toEqual([])
    expect(flagKinds(inputs({ attributedTokens: 5_000, observedTokens: 50_000 }))).toEqual([])
  })

  it('null observed (no scanner coverage) → null buckets, no flag, never zero', () => {
    const report = evaluateAgentBurn(inputs({ attributedTokens: 800_000, completions: 2 }), config)
    expect(report.totalObservedTokens).toBeNull()
    expect(report.interactiveTokens).toBeNull()
    expect(report.unexplainedTokens).toBeNull()
    expect(report.flags).toEqual([])
  })

  it('null attributed metering stays unknown instead of fabricating usage or ratios', () => {
    const report = evaluateAgentBurn(
      inputs({
        attributedTokens: null,
        observedTokens: 1_000_000,
        runs: 3,
        tokenApplicableRuns: 3,
        tokenMeteredRuns: 0,
        completions: 2,
      }),
      config,
    )

    expect(report.windowTokens).toBeNull()
    expect(report.unexplainedTokens).toBeNull()
    expect(report.tokensPerCompletion).toBeNull()
    expect(report.flags.some((f) => f.kind === 'unexplained')).toBe(false)
  })

  it('null attributed metering cannot trigger effort-no-outcome', () => {
    const report = evaluateAgentBurn(
      inputs({
        attributedTokens: null,
        observedTokens: 1_000_000,
        runs: 3,
        tokenApplicableRuns: 3,
        tokenMeteredRuns: 0,
      }),
      config,
    )

    expect(report.flags.some((flag) => flag.kind === 'effort-no-outcome')).toBe(false)
  })

  it('suppresses attributed-derived judgments when only some runs have token evidence', () => {
    const report = evaluateAgentBurn(
      inputs({
        attributedTokens: null,
        attributedCostUsdMicros: null,
        runs: 4,
        tokenApplicableRuns: 4,
        tokenMeteredRuns: 3,
        costedRuns: 2,
        completions: 0,
        observedTokens: 2_000_000,
        todayObservedTokens: 2_000_000,
        baselineDailyTokens: [100_000, 200_000],
      }),
      config,
    )

    expect(report.windowTokens).toBeNull()
    expect(report.windowCostUsdMicros).toBeNull()
    expect(report.tokensPerCompletion).toBeNull()
    expect(report.unexplainedTokens).toBeNull()
    expect(report.flags.filter((f) => f.kind !== 'interactive')).toEqual([])
  })

  it('sanitizes a numeric subtotal when coverage counts say it is partial', () => {
    const report = evaluateAgentBurn(
      inputs({
        attributedTokens: 900_000,
        attributedCostUsdMicros: 30_000,
        runs: 4,
        tokenApplicableRuns: 4,
        tokenMeteredRuns: 3,
        costedRuns: 2,
        completions: 2,
        observedTokens: 1_000_000,
      }),
      config,
    )

    expect(report.windowTokens).toBeNull()
    expect(report.windowCostUsdMicros).toBeNull()
    expect(report.tokensPerCompletion).toBeNull()
    expect(report.unexplainedTokens).toBeNull()
    expect(report.flags.filter((f) => f.kind !== 'interactive')).toEqual([])
  })

  it('withholds unsafe token and cost aggregates even when every run reported evidence', () => {
    const report = evaluateAgentBurn(
      inputs({
        attributedTokens: Number.MAX_SAFE_INTEGER * 2,
        attributedCostUsdMicros: Number.MAX_SAFE_INTEGER * 2,
        runs: 2,
        tokenApplicableRuns: 2,
        tokenMeteredRuns: 2,
        tokenAggregateRepresentable: false,
        costedRuns: 2,
        costAggregateRepresentable: false,
        completions: 1,
        observedTokens: 100,
      }),
      config,
    )

    expect(report.windowTokens).toBeNull()
    expect(report.windowCostUsdMicros).toBeNull()
    expect(report.tokensPerCompletion).toBeNull()
    expect(report.unexplainedTokens).toBeNull()
    expect(report.flags).toEqual([])
  })

  it('treats media-only interactions as complete zero token evidence', () => {
    const report = evaluateAgentBurn(
      inputs({
        attributedTokens: 0,
        runs: 2,
        tokenApplicableRuns: 0,
        tokenMeteredRuns: 0,
        observedTokens: 0,
      }),
      config,
    )

    expect(report.windowTokens).toBe(0)
    expect(report.tokenApplicableRuns).toBe(0)
    expect(report.tokenMeteredRuns).toBe(0)
    expect(report.flags).toEqual([])
  })
})

describe('runaway (#691 D9/D11)', () => {
  it('fires on an external session at the turn and token thresholds with zero user turns', () => {
    const report = evaluateAgentBurn(
      inputs({ sessions: [session({ assistantMessages: 20, totalTokens: 1_000_000 })] }),
      config,
    )
    const flag = report.flags.find((f) => f.kind === 'runaway')
    expect(flag).toBeDefined()
    expect(flag!.kind === 'runaway' && flag!.downgraded).toBe(false)
    expect(flag!.message).toContain('possible runaway usage')
    expect(flag!.message).toContain('investigate now')
    expect(flag!.kind === 'runaway' && flag!.sessions).toEqual([
      { sessionId: 'sess-1', tokens: 1_000_000, assistantTurns: 20 },
    ])
  })

  it('a session that went quiet before the window cannot re-page — window sums are the evidence', () => {
    // The store window-scopes token/turn sums: a Monday runaway the user
    // already killed reports zero window evidence on Tuesday.
    expect(flagKinds(inputs({
      sessions: [session({ totalTokens: 0, assistantMessages: 0, userMessages: 0 })],
    }))).toEqual([])
  })

  it('boundary honesty: 19 turns, floor−1 tokens, or a single user turn kill it', () => {
    expect(flagKinds(inputs({ sessions: [session({ assistantMessages: 19 })] }))).toEqual([])
    expect(flagKinds(inputs({ sessions: [session({ totalTokens: 999_999 })] }))).toEqual([])
    expect(flagKinds(inputs({ sessions: [session({ userMessages: 1 })] }))).toEqual([])
  })

  it('never pages on bakin or unknown-origin sessions — cannot-tell is not evidence', () => {
    expect(flagKinds(inputs({ sessions: [session({ origin: 'bakin' })] }))).toEqual([])
    expect(flagKinds(inputs({ sessions: [session({ origin: 'unknown' })] }))).toEqual([])
  })

  it('composition trigger: unexplained at the runaway floor plus a spike', () => {
    const report = evaluateAgentBurn(
      inputs({
        observedTokens: 1_500_000,
        todayObservedTokens: 1_500_000,
        baselineDailyTokens: [100_000, 150_000],
      }),
      config,
    )
    const flag = report.flags.find((f) => f.kind === 'runaway')
    expect(flag).toBeDefined()
    expect(flag!.message).toContain('unexplained tokens well above its daily average')
  })

  it('cron guard: scheduled jobs downgrade the page to a named review prompt', () => {
    const report = evaluateAgentBurn(
      inputs({
        sessions: [session()],
        scheduledJobs: [{ id: 'j1', name: 'nightly-digest' }],
      }),
      config,
    )
    const flag = report.flags.find((f) => f.kind === 'runaway')
    expect(flag).toBeDefined()
    expect(flag!.kind === 'runaway' && flag!.downgraded).toBe(true)
    expect(flag!.message).toContain('nightly-digest')
    expect(flag!.message).toContain('review if unexpected')
    expect(flag!.message).not.toContain('investigate now')
  })

  it('cron guard fails loud: no cron evidence (null) means NO downgrade', () => {
    const report = evaluateAgentBurn(
      inputs({ sessions: [session()], scheduledJobs: null }),
      config,
    )
    const flag = report.flags.find((f) => f.kind === 'runaway')
    expect(flag!.kind === 'runaway' && flag!.downgraded).toBe(false)
  })

  it('an empty jobs list (surface read, nothing scheduled) does not downgrade', () => {
    const report = evaluateAgentBurn(
      inputs({ sessions: [session()], scheduledJobs: [] }),
      config,
    )
    const flag = report.flags.find((f) => f.kind === 'runaway')
    expect(flag!.kind === 'runaway' && flag!.downgraded).toBe(false)
  })
})

describe('composition', () => {
  it('an agent can trip multiple flags at once (incl. the runaway composition)', () => {
    const kinds = flagKinds(
      inputs({
        attributedTokens: 600_000,
        runs: 10,
        observedTokens: 2_000_000,
        todayObservedTokens: 2_000_000,
        baselineDailyTokens: [100_000, 200_000],
      }),
    )
    expect(kinds.sort()).toEqual(['effort-no-outcome', 'runaway', 'spike', 'unexplained'])
  })

  it('idle agent (all zeros/nulls) is clean', () => {
    const report = evaluateAgentBurn(inputs(), config)
    expect(report.flags).toEqual([])
    expect(report.windowTokens).toBe(0)
    expect(report.windowCostUsdMicros).toBeNull()
  })
})
