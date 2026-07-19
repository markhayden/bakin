/**
 * usage.agent-burn doctor check (#385) — maps burn evaluator reports to
 * warning observations with machine-readable agent evidence.
 */
import { afterEach, describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-burn-check-${Date.now()}-${randomUUID()}`)
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

import type { AgentBurnReport } from '../../src/core/agent-burn'

let reports: AgentBurnReport[] = []
let throwLedger = false
let receivedOptions: unknown
const usageScanGlobal = globalThis as typeof globalThis & {
  __bakinUsageHistoryLastScan?: unknown
  __bakinUsageHistoryScanPending?: boolean
}

afterEach(() => {
  usageScanGlobal.__bakinUsageHistoryScanPending = false
})

import { checkAgentBurnWith } from '../../plugins/health/lib/system-checks/agent-burn'
import { LedgerUnavailableError } from '../../packages/core/src/execution/ledger'
import type { HealthCheckRunInput } from '@makinbakin/sdk'
import { parseHealthCheckRunInput } from '../../src/core/health-contract'

const cleanReport = {
  agent: 'scout',
  windowTokens: 1000,
  windowCostUsdMicros: null,
  runs: 2,
  tokenApplicableRuns: 2,
  tokenMeteredRuns: 2,
  tokenAggregateRepresentable: true,
  costedRuns: 0,
  costAggregateRepresentable: true,
  completions: 2,
  tokensPerCompletion: 500,
  totalObservedTokens: 1200,
  interactiveTokens: 0,
  unexplainedTokens: 200,
  flags: [],
}

function buildReports(_now?: number, options?: unknown): AgentBurnReport[] {
  receivedOptions = options
  if (throwLedger) throw new LedgerUnavailableError('db locked')
  return reports
}

function checkAgentBurn() {
  return checkAgentBurnWith({ buildReports })
}

function observed(run: HealthCheckRunInput) {
  const parsed = parseHealthCheckRunInput(run)
  expect(parsed.outcome).toBe('observed')
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}

describe('checkAgentBurn', () => {
  it('passes the latest per-agent transcript coverage into the shared evaluator', async () => {
    const g = globalThis as typeof globalThis & { __bakinUsageHistoryLastScan?: unknown }
    g.__bakinUsageHistoryLastScan = {
      at: Date.now(),
      report: {
        scanned: 0,
        skipped: 1,
        failed: 0,
        coverage: {
          status: 'complete',
          reason: 'complete',
          agents: [{ agent: 'scout', status: 'complete' }],
        },
      },
    }
    reports = [cleanReport]

    await checkAgentBurn()

    expect(receivedOptions).toMatchObject({
      coverage: {
        agents: [{ agent: 'scout', status: 'complete' }],
      },
    })
    g.__bakinUsageHistoryLastScan = null
  })

  it('reports ok when nothing is flagged', async () => {
    const g = globalThis as typeof globalThis & { __bakinUsageHistoryLastScan?: unknown }
    g.__bakinUsageHistoryLastScan = {
      at: Date.now(),
      report: {
        scanned: 0, skipped: 1, failed: 0,
        coverage: { status: 'complete', reason: 'complete', agents: [{ agent: 'scout', status: 'complete' }] },
      },
    }
    reports = [cleanReport]
    const results = observed(await checkAgentBurn())
    expect(results).toHaveLength(1)
    expect(results[0]!.status).toBe('healthy')
    expect(results[0]!.key).toBe('usage')
    g.__bakinUsageHistoryLastScan = null
  })

  it('reports unknown when transcript coverage is unavailable instead of blessing zero usage', async () => {
    const g = globalThis as typeof globalThis & { __bakinUsageHistoryLastScan?: unknown }
    g.__bakinUsageHistoryLastScan = {
      at: Date.now(),
      report: {
        scanned: 0, skipped: 0, failed: 0,
        coverage: { status: 'unavailable', reason: 'missing_session_tier', agents: [] },
      },
    }
    reports = [{ ...cleanReport, totalObservedTokens: null, interactiveTokens: null, unexplainedTokens: null }]

    const results = observed(await checkAgentBurn())

    expect(results[0]!.status).toBe('unknown')
    expect(results[0]!.summary).toContain('could not be verified')
    g.__bakinUsageHistoryLastScan = null
  })

  it('reports unknown when recorded runs have incomplete token metering', async () => {
    const g = globalThis as typeof globalThis & { __bakinUsageHistoryLastScan?: unknown }
    g.__bakinUsageHistoryLastScan = {
      at: Date.now(),
      report: {
        scanned: 1,
        skipped: 0,
        failed: 0,
        coverage: {
          status: 'complete',
          reason: 'complete',
          agents: [{ agent: 'scout', status: 'complete' }],
        },
      },
    }
    reports = [{
      ...cleanReport,
      windowTokens: null,
      windowCostUsdMicros: null,
      tokenApplicableRuns: 2,
      tokenMeteredRuns: 1,
      costedRuns: 0,
      tokensPerCompletion: null,
      interactiveTokens: null,
      unexplainedTokens: null,
    }]

    const results = observed(await checkAgentBurn())

    expect(results).toHaveLength(1)
    expect(results[0]!.status).toBe('unknown')
    expect(results[0]!.summary).toContain('metering is incomplete')
    expect(results[0]!.detail).toContain('1 of 2 token-bearing recorded calls')
    expect(results[0]!.evidence).toMatchObject({
      agents: ['scout'],
      runs: 2,
      tokenApplicableRuns: 2,
      tokenMeteredRuns: 1,
    })
    g.__bakinUsageHistoryLastScan = null
  })

  it('reports unrepresentable token and cost aggregates without changing honest coverage counts', async () => {
    const g = globalThis as typeof globalThis & { __bakinUsageHistoryLastScan?: unknown }
    g.__bakinUsageHistoryLastScan = {
      at: Date.now(),
      report: {
        scanned: 1,
        skipped: 0,
        failed: 0,
        coverage: {
          status: 'complete',
          reason: 'complete',
          agents: [{ agent: 'scout', status: 'complete' }],
        },
      },
    }
    reports = [{
      ...cleanReport,
      windowTokens: null,
      windowCostUsdMicros: null,
      tokenMeteredRuns: 2,
      tokenAggregateRepresentable: false,
      costedRuns: 2,
      costAggregateRepresentable: false,
      tokensPerCompletion: null,
      interactiveTokens: null,
      unexplainedTokens: null,
    }]

    const results = observed(await checkAgentBurn())

    expect(results).toHaveLength(2)
    expect(results.map((result) => result.key)).toEqual(['metering', 'cost-aggregation'])
    expect(results[0]!.detail).toContain('2 of 2 token-bearing recorded calls reported totals')
    expect(results[0]!.evidence).toMatchObject({
      tokenApplicableRuns: 2,
      tokenMeteredRuns: 2,
      unrepresentableAggregateAgents: ['scout'],
    })
    expect(results[1]!.detail).toContain('1 agent aggregate exceeded the safe reporting range across 2 priced calls')
    g.__bakinUsageHistoryLastScan = null
  })

  it('does not call media-only work incomplete token metering', async () => {
    const g = globalThis as typeof globalThis & { __bakinUsageHistoryLastScan?: unknown }
    g.__bakinUsageHistoryLastScan = {
      at: Date.now(),
      report: {
        scanned: 1,
        skipped: 0,
        failed: 0,
        coverage: {
          status: 'complete',
          reason: 'complete',
          agents: [{ agent: 'scout', status: 'complete' }],
        },
      },
    }
    reports = [{
      ...cleanReport,
      windowTokens: 0,
      runs: 2,
      tokenApplicableRuns: 0,
      tokenMeteredRuns: 0,
      completions: 0,
      tokensPerCompletion: null,
      totalObservedTokens: 0,
      interactiveTokens: 0,
      unexplainedTokens: 0,
    }]

    const results = observed(await checkAgentBurn())

    expect(results).toHaveLength(1)
    expect(results[0]!.status).toBe('healthy')
    expect(results[0]!.summary).not.toContain('incomplete')
    g.__bakinUsageHistoryLastScan = null
  })

  it('does not mint a fresh healthy verdict from an expired complete scan', async () => {
    const now = Date.parse('2026-07-14T18:00:00.000Z')
    const staleAfterMs = 10 * 60_000
    const lastUsageScan = () => ({
      at: now - staleAfterMs - 1,
      report: {
        scanned: 1,
        skipped: 0,
        failed: 0,
        coverage: {
          status: 'complete' as const,
          reason: 'complete' as const,
          agents: [{ agent: 'scout', status: 'complete' as const }],
        },
      },
    })
    reports = [cleanReport]

    const results = observed(await checkAgentBurnWith({
      buildReports,
      lastUsageScan,
      now: () => now,
      scanStaleAfterMs: () => staleAfterMs,
    }))

    expect(results[0]!.status).toBe('unknown')
    expect(results[0]!.evidence).toMatchObject({ reason: 'scan_stale' })
    expect(receivedOptions).toEqual({ coverage: { agents: [] }, scheduledJobs: null })
  })

  it('does not mint a healthy verdict while the usage store is changing generations', async () => {
    usageScanGlobal.__bakinUsageHistoryLastScan = {
      at: Date.now(),
      report: {
        scanned: 1,
        skipped: 0,
        failed: 0,
        coverage: {
          status: 'complete',
          reason: 'complete',
          agents: [{ agent: 'scout', status: 'complete' }],
        },
      },
    }
    usageScanGlobal.__bakinUsageHistoryScanPending = true
    reports = [{ ...cleanReport, totalObservedTokens: null, interactiveTokens: null, unexplainedTokens: null }]

    const results = observed(await checkAgentBurn())

    expect(results[0]!.status).toBe('unknown')
    expect(results[0]!.evidence).toMatchObject({ reason: 'scan_in_progress' })
    expect(receivedOptions).toEqual({ coverage: { agents: [] }, scheduledJobs: null })
    usageScanGlobal.__bakinUsageHistoryLastScan = null
  })

  it('emits one warn row per flagged agent with data.agents attribution', async () => {
    reports = [
      cleanReport,
      {
        ...cleanReport,
        agent: 'pixel',
        completions: 0,
        tokensPerCompletion: null,
        flags: [
          { kind: 'effort-no-outcome', message: "'pixel' used 2.1M tokens across 14 run(s) in 24h but completed no tasks — check its timeline" },
          { kind: 'unexplained', tokens: 790_000, spikeConcurrent: false, message: "'pixel' used 790k tokens Bakin could not attribute to tasks, system sends, or interactive sessions in 24h — review its recent sessions" },
        ],
      },
    ]
    const results = observed(await checkAgentBurn())
    expect(results).toHaveLength(2)
    const unexplainedRow = results.find((r) => r.key === 'unexplained:pixel')!
    expect(unexplainedRow.status).toBe('warning')
    expect(unexplainedRow.incident?.disposition).toBe('watch')
    expect(unexplainedRow.evidence).toMatchObject({ agents: ['pixel'], kinds: ['unexplained'], tokens: 790_000 })
    const legacyRow = results.find((r) => r.key === 'agent:pixel')!
    expect(legacyRow.summary).toContain('pixel')
    expect(legacyRow.evidence).toEqual({ agents: ['pixel'], kinds: ['effort-no-outcome'] })
  })

  it('interactive usage is an advisory incident with calm copy', async () => {
    reports = [{
      ...cleanReport,
      agent: 'main',
      interactiveTokens: 10_000_000,
      flags: [
        { kind: 'interactive', tokens: 10_000_000, message: "'main' used 10M tokens in interactive runtime sessions (direct chats/TUI) not tied to board tasks — normal if you were working with this agent directly" },
      ],
    }]
    const results = observed(await checkAgentBurn())
    expect(results).toHaveLength(1)
    const row = results[0]!
    expect(row.status).toBe('warning')
    expect(row.key).toBe('interactive:main')
    expect(row.incident?.disposition).toBe('advisory')
    expect(row.incident?.title).toBe('Interactive agent chat usage')
    expect(row.incident?.impact).toContain('normal use')
    expect(row.evidence).toMatchObject({ agents: ['main'], kinds: ['interactive'], tokens: 10_000_000 })
  })

  it('runaway pages as action_required with structured session evidence', async () => {
    reports = [{
      ...cleanReport,
      agent: 'main',
      flags: [
        {
          kind: 'runaway',
          sessions: [{ sessionId: 's9', tokens: 2_000_000, assistantTurns: 34 }],
          scheduledJobs: [],
          downgraded: false,
          message: "'main' shows possible runaway usage: 34 autonomous turns / 2M tokens with no user interaction — investigate now",
        },
      ],
    }]
    const results = observed(await checkAgentBurn())
    const row = results[0]!
    expect(row.status).toBe('error')
    expect(row.key).toBe('runaway:main')
    expect(row.incident?.disposition).toBe('action_required')
    expect(row.incident?.title).toBe('Possible runaway agent usage')
    expect(row.evidence).toMatchObject({
      downgraded: false,
      sessions: [{ sessionId: 's9', tokens: 2_000_000, assistantTurns: 34 }],
    })
  })

  it('downgraded runaway (scheduled jobs) is a watch review prompt, never a page', async () => {
    reports = [{
      ...cleanReport,
      agent: 'main',
      flags: [
        {
          kind: 'runaway',
          sessions: [{ sessionId: 's9', tokens: 2_000_000, assistantTurns: 34 }],
          scheduledJobs: ['nightly-digest'],
          downgraded: true,
          message: "'main' has high autonomous usage and this runtime also has 1 scheduled job(s) (nightly-digest) — review if unexpected",
        },
      ],
    }]
    const results = observed(await checkAgentBurn())
    const row = results[0]!
    expect(row.status).toBe('warning')
    expect(row.incident?.disposition).toBe('watch')
    expect(row.incident?.title).toContain('scheduled jobs present')
    expect(row.evidence).toMatchObject({ downgraded: true, scheduledJobs: ['nightly-digest'] })
  })

  it('fetches cron evidence when any agent has complete coverage — even a partial fleet (D11)', async () => {
    usageScanGlobal.__bakinUsageHistoryLastScan = {
      at: Date.now(),
      report: {
        scanned: 1, skipped: 0, failed: 1,
        coverage: {
          status: 'partial',
          reason: 'agent_scan_failed',
          agents: [
            { agent: 'covered', status: 'complete' },
            { agent: 'broken', status: 'partial' },
          ],
        },
      },
    }
    reports = []
    const scheduledJobs = mock(async () => [])
    await checkAgentBurnWith({ buildReports, scheduledJobs })
    // One broken transcript elsewhere must not strip the cron downgrade
    // from a fully-covered agent's runaway page.
    expect(scheduledJobs).toHaveBeenCalledTimes(1)
    expect(receivedOptions).toMatchObject({ scheduledJobs: [] })
    usageScanGlobal.__bakinUsageHistoryLastScan = null
  })

  it('skips cron evidence when no agent can produce a runaway flag', async () => {
    usageScanGlobal.__bakinUsageHistoryLastScan = {
      at: Date.now(),
      report: {
        scanned: 0, skipped: 0, failed: 0,
        coverage: { status: 'unavailable', reason: 'missing_session_tier', agents: [] },
      },
    }
    reports = []
    const scheduledJobs = mock(async () => [])
    await checkAgentBurnWith({ buildReports, scheduledJobs })
    expect(scheduledJobs).not.toHaveBeenCalled()
    expect(receivedOptions).toMatchObject({ scheduledJobs: null })
    usageScanGlobal.__bakinUsageHistoryLastScan = null
  })

  it('fails loudly (error row) when the ledger is unavailable', async () => {
    throwLedger = true
    const results = observed(await checkAgentBurn())
    expect(results[0]!.status).toBe('error')
    expect(results[0]!.incident?.title).toContain('ledger')
    throwLedger = false
  })

  it('ok row notes an idle fleet honestly', async () => {
    const g = globalThis as typeof globalThis & { __bakinUsageHistoryLastScan?: unknown }
    g.__bakinUsageHistoryLastScan = {
      at: Date.now(),
      report: {
        scanned: 0, skipped: 0, failed: 0,
        coverage: { status: 'complete', reason: 'complete', agents: [] },
      },
    }
    reports = []
    const results = observed(await checkAgentBurn())
    expect(results[0]!.status).toBe('healthy')
    expect(results[0]!.detail).toContain('no agent activity')
    g.__bakinUsageHistoryLastScan = null
  })
})
