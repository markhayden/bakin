import { afterEach, describe, expect, it } from 'bun:test'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'

import {
  getLastUsageScan,
  getUsageHistoryScanState,
  isUsageHistoryScanInFlight,
  runUsageHistoryScan,
} from '../../../plugins/health/lib/usage-history-timer'

const g = globalThis as typeof globalThis & {
  __bakinUsageHistoryLastScan?: unknown
  __bakinUsageHistoryScanInFlight?: Promise<void> | null
  __bakinUsageHistoryScanPending?: boolean
  __bakinUsageHistoryScanGeneration?: number
}

afterEach(() => {
  g.__bakinUsageHistoryLastScan = null
  g.__bakinUsageHistoryScanInFlight = null
  g.__bakinUsageHistoryScanPending = false
  g.__bakinUsageHistoryScanGeneration = undefined
})

describe('usage-history timer failures', () => {
  it('replaces stale complete coverage with fresh unavailable evidence when a sweep rejects', async () => {
    g.__bakinUsageHistoryLastScan = {
      at: 1,
      report: {
        scanned: 10,
        skipped: 0,
        failed: 0,
        coverage: {
          status: 'complete',
          reason: 'complete',
          agents: [{ agent: 'main', status: 'complete' }],
        },
      },
    }

    await runUsageHistoryScan(
      createMockRuntimeAdapter(),
      async () => { throw new Error('unexpected sweep failure') },
    )

    expect(getLastUsageScan()).toMatchObject({
      report: {
        scanned: 0,
        skipped: 0,
        failed: 1,
        coverage: {
          status: 'unavailable',
          reason: 'scan_failed',
          agents: [],
        },
      },
    })
    expect(getLastUsageScan()!.at).toBeGreaterThan(1)
  })

  it('coalesces overlapping timer ticks so an older sweep cannot overwrite a newer one', async () => {
    let calls = 0
    const report = {
      scanned: 1,
      skipped: 0,
      failed: 0,
      coverage: {
        status: 'complete' as const,
        reason: 'complete' as const,
        agents: [{ agent: 'main', status: 'complete' as const }],
      },
    }
    let resolveScan!: (value: typeof report) => void
    const scanner = async () => {
      calls += 1
      return await new Promise<typeof report>((resolve) => { resolveScan = resolve })
    }

    const first = runUsageHistoryScan(createMockRuntimeAdapter(), scanner)
    const firstGeneration = getUsageHistoryScanState().generation
    const second = runUsageHistoryScan(createMockRuntimeAdapter(), scanner)
    await Promise.resolve()

    expect(calls).toBe(1)
    expect(second).toBe(first)
    expect(firstGeneration).toBe(1)
    expect(getUsageHistoryScanState().generation).toBe(firstGeneration)
    expect(isUsageHistoryScanInFlight()).toBe(true)
    resolveScan(report)
    await Promise.all([first, second])

    expect(getLastUsageScan()?.report).toEqual(report)
    expect(isUsageHistoryScanInFlight()).toBe(false)
    expect(g.__bakinUsageHistoryScanInFlight).toBeNull()
  })

  it('coalesces a re-entrant scan request made before the scanner yields', async () => {
    const runtime = createMockRuntimeAdapter()
    const report = {
      scanned: 0,
      skipped: 0,
      failed: 0,
      coverage: {
        status: 'complete' as const,
        reason: 'complete' as const,
        agents: [],
      },
    }
    let calls = 0
    let nested: Promise<void> | undefined
    const scanner = async () => {
      calls += 1
      if (calls === 1) nested = runUsageHistoryScan(runtime, scanner)
      return report
    }

    const first = runUsageHistoryScan(runtime, scanner)
    await Promise.resolve()

    expect(calls).toBe(1)
    expect(nested).toBe(first)
    expect(getUsageHistoryScanState().generation).toBe(1)
    await first
    expect(isUsageHistoryScanInFlight()).toBe(false)
  })
})
