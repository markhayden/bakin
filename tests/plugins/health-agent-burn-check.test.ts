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
  unattributedTokens: 200,
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
    reports = [{ ...cleanReport, totalObservedTokens: null, unattributedTokens: null }]

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
      unattributedTokens: null,
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
      unattributedTokens: null,
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
      unattributedTokens: 0,
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
    expect(receivedOptions).toEqual({ coverage: { agents: [] } })
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
    reports = [{ ...cleanReport, totalObservedTokens: null, unattributedTokens: null }]

    const results = observed(await checkAgentBurn())

    expect(results[0]!.status).toBe('unknown')
    expect(results[0]!.evidence).toMatchObject({ reason: 'scan_in_progress' })
    expect(receivedOptions).toEqual({ coverage: { agents: [] } })
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
          { kind: 'unattributed', message: "'pixel' used 790k tokens outside Bakin-managed tasks in 24h — review its recent sessions" },
        ],
      },
    ]
    const results = observed(await checkAgentBurn())
    expect(results).toHaveLength(1)
    const row = results[0]!
    expect(row.status).toBe('warning')
    expect(row.summary).toContain('pixel')
    expect(row.detail).toContain('outside Bakin-managed tasks')
    expect(row.evidence).toEqual({ agents: ['pixel'], kinds: ['effort-no-outcome', 'unattributed'] })
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
