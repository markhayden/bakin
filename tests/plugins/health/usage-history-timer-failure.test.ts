import { afterEach, describe, expect, it } from 'bun:test'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'

import {
  getLastUsageScan,
  runUsageHistoryScan,
} from '../../../plugins/health/lib/usage-history-timer'

const g = globalThis as typeof globalThis & {
  __bakinUsageHistoryLastScan?: unknown
  __bakinUsageHistoryScanInFlight?: Promise<void> | null
}

afterEach(() => {
  g.__bakinUsageHistoryLastScan = null
  g.__bakinUsageHistoryScanInFlight = null
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
    const second = runUsageHistoryScan(createMockRuntimeAdapter(), scanner)

    expect(calls).toBe(1)
    expect(second).toBe(first)
    resolveScan(report)
    await Promise.all([first, second])

    expect(getLastUsageScan()?.report).toEqual(report)
    expect(g.__bakinUsageHistoryScanInFlight).toBeNull()
  })
})
