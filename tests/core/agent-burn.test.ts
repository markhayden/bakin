/**
 * Agent burn evaluator (#385) — pure effort-vs-outcome / spike / unattributed
 * heuristics. The evaluator never fabricates data: unknown observed usage is
 * null (scanner hasn't covered the window), never zero.
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

import { evaluateAgentBurn, type AgentBurnInputs, type BurnConfig } from '../../src/core/agent-burn'
import { DEFAULT_SETTINGS } from '../../packages/core/src/settings'

const config: BurnConfig = {
  windowHours: 24,
  minTokensFloor: 500_000,
  spikeMultiplier: 3,
  baselineDays: 7,
  unattributedShare: 0.5,
  unattributedFloorTokens: 100_000,
}

function inputs(overrides: Partial<AgentBurnInputs> = {}): AgentBurnInputs {
  return {
    agent: 'pixel',
    attributedTokens: 0,
    attributedCostUsdMicros: null,
    runs: 0,
    completions: 0,
    observedTokens: null,
    todayObservedTokens: null,
    baselineDailyTokens: [],
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

describe('unattributed', () => {
  it('flags a large share of tokens outside Bakin-managed runs', () => {
    const report = evaluateAgentBurn(
      inputs({ attributedTokens: 210_000, observedTokens: 1_000_000, runs: 14 }),
      config,
    )
    expect(report.unattributedTokens).toBe(790_000)
    expect(report.flags.map((f) => f.kind)).toEqual(['unattributed'])
    expect(report.flags[0]!.message).toContain('outside Bakin-managed tasks')
  })

  it('clamps to zero when attributed exceeds observed (scan lag)', () => {
    const report = evaluateAgentBurn(
      inputs({ attributedTokens: 500_000, observedTokens: 400_000, completions: 1 }),
      config,
    )
    expect(report.unattributedTokens).toBe(0)
    expect(report.flags).toEqual([])
  })

  it('below the share or floor → no flag', () => {
    // 40% share, above floor
    expect(flagKinds(inputs({ attributedTokens: 600_000, observedTokens: 1_000_000, completions: 1 }))).toEqual([])
    // 90% share, below floor
    expect(flagKinds(inputs({ attributedTokens: 5_000, observedTokens: 50_000 }))).toEqual([])
  })

  it('null observed (no scanner coverage) → null delta, no flag, never zero', () => {
    const report = evaluateAgentBurn(inputs({ attributedTokens: 800_000, completions: 2 }), config)
    expect(report.totalObservedTokens).toBeNull()
    expect(report.unattributedTokens).toBeNull()
    expect(report.flags).toEqual([])
  })
})

describe('composition', () => {
  it('an agent can trip multiple flags at once', () => {
    const kinds = flagKinds(
      inputs({
        attributedTokens: 600_000,
        runs: 10,
        observedTokens: 2_000_000,
        todayObservedTokens: 2_000_000,
        baselineDailyTokens: [100_000, 200_000],
      }),
    )
    expect(kinds.sort()).toEqual(['effort-no-outcome', 'spike', 'unattributed'])
  })

  it('idle agent (all zeros/nulls) is clean', () => {
    const report = evaluateAgentBurn(inputs(), config)
    expect(report.flags).toEqual([])
    expect(report.windowTokens).toBe(0)
    expect(report.windowCostUsdMicros).toBeNull()
  })
})
