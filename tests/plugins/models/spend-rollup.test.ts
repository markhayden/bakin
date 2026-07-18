/**
 * Browse-window rollups — NULL-honest replacement for the deleted ledger
 * GROUP-BY verbs. The regression that matters: unpriced buckets report null,
 * never a fabricated $0.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), 'bakin-test-spend-rollup')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) }))

import { rollupSpend } from '../../../plugins/models/lib/spend-rollup'
import type { RunCostSpendRow } from '../../../src/core/execution-ledger'

function row(over: Partial<RunCostSpendRow>): RunCostSpendRow {
  return {
    runId: 'task:t:d1', agent: 'pixel', model: 'g/f', provider: 'g', lane: 'metered',
    usageKind: 'tokens', totalTokens: 100, costUsdMicros: 1000, workClass: 'adhoc',
    routeSource: 'inherit', occurredAt: 0, ...over,
  }
}

describe('rollupSpend', () => {
  it('sums priced rows and counts every run', () => {
    const r = rollupSpend([
      row({ runId: 'a', costUsdMicros: 1000 }),
      row({ runId: 'b', costUsdMicros: 500 }),
      row({ runId: 'c', agent: 'rolo', costUsdMicros: 200 }),
    ])
    expect(r.totalUsdMicros).toBe(1700)
    expect(r.byAgent).toEqual([
      { agent: 'pixel', runs: 2, costUsdMicros: 1500 },
      { agent: 'rolo', runs: 1, costUsdMicros: 200 },
    ])
  })

  it('an all-unpriced bucket reports null cost — never a fabricated $0', () => {
    const r = rollupSpend([
      row({ runId: 'a', agent: 'ghost', model: 'mystery/x', costUsdMicros: null }),
      row({ runId: 'b', agent: 'pixel', costUsdMicros: 700 }),
    ])
    expect(r.byAgent.find((x) => x.agent === 'ghost')?.costUsdMicros).toBeNull()
    expect(r.byModel.find((x) => x.model === 'mystery/x')?.costUsdMicros).toBeNull()
    expect(r.totalUsdMicros).toBe(700)
  })

  it('work-class rollup: lanes, avg over priced runs, media + unclassified buckets', () => {
    const r = rollupSpend([
      row({ runId: 'a', workClass: 'scheduled', costUsdMicros: 1000, totalTokens: 100 }),
      row({ runId: 'b', workClass: 'scheduled', costUsdMicros: 3000, totalTokens: 300 }),
      row({ runId: 'c', workClass: 'scheduled', costUsdMicros: null, totalTokens: 50 }),
      row({ runId: 'd', workClass: 'auto-title', lane: 'subscription', costUsdMicros: null, totalTokens: 500 }),
      row({ runId: 'e', workClass: null, costUsdMicros: null, totalTokens: 10 }),
      row({ runId: 'f', workClass: null, usageKind: 'media', totalTokens: null, costUsdMicros: 39_000 }),
    ])
    const byClass = new Map(r.byWorkClass.map((x) => [x.workClass, x]))
    expect(byClass.get('scheduled')).toMatchObject({ runs: 3, totalTokens: 450, costUsdMicros: 4000, avgCostUsdMicros: 2000 })
    expect(byClass.get('auto-title')).toMatchObject({ runs: 1, subscriptionTokens: 500, costUsdMicros: null, avgCostUsdMicros: null })
    expect(byClass.get('unclassified')).toMatchObject({ runs: 1, totalTokens: 10, costUsdMicros: null })
    expect(byClass.get('media')).toMatchObject({ runs: 1, totalTokens: null, costUsdMicros: 39_000 })
  })

  it('empty input yields empty rollups with a zero total', () => {
    expect(rollupSpend([])).toEqual({ totalUsdMicros: 0, byAgent: [], byModel: [], byWorkClass: [] })
  })
})
