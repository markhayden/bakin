import { describe, expect, it, mock } from 'bun:test'
import type { SearchAPI } from '@bakin/core/plugin-types'

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { pruneExpired } from '../../../plugins/memory/lib/ttl-prune'

function makeSearch(rows: Array<{ key: string; document: Record<string, unknown> }>): {
  search: SearchAPI
  removed: string[]
} {
  const removed: string[] = []
  const scan = mock(async function* () {
    for (const row of rows) yield row
  })
  return {
    removed,
    search: {
      registerContentType: mock(),
      registerFileBackedContentType: mock(),
      index: mock(async () => {}),
      remove: mock(async () => {}),
      transform: mock(async () => {}),
      query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const } })),
      maintenance: {
        available: mock(async () => true),
        scan,
        batchRemove: mock(async (keys: string[]) => {
          removed.push(...keys)
          return keys.length
        }),
        resetContentType: mock(async () => {}),
      },
    },
  }
}

describe('pruneExpired', () => {
  it('deletes expired turn and audit rows through ctx.search maintenance', async () => {
    const now = Date.now()
    const { search, removed } = makeSearch([
      { key: 'old-turn', document: { tier: 'turn', updated_at: now - 8 * 86_400_000 } },
      { key: 'fresh-turn', document: { tier: 'turn', updated_at: now } },
      { key: 'old-audit', document: { tier: 'audit', updated_at: now - 31 * 86_400_000 } },
      { key: 'durable', document: { tier: 'durable', updated_at: 0 } },
    ])

    const stats = await pruneExpired(search, { turnRetentionDays: 7, auditRetentionDays: 30 })

    expect(removed.sort()).toEqual(['old-audit', 'old-turn'])
    expect(search.maintenance!.scan).toHaveBeenCalledWith({ fields: ['tier', 'updated_at'] })
    expect(stats.turn).toBe(1)
    expect(stats.audit).toBe(1)
    expect(stats.scanned).toBe(4)
  })

  it('no-ops when maintenance is unavailable', async () => {
    const search = makeSearch([]).search
    search.maintenance = undefined

    const stats = await pruneExpired(search, { turnRetentionDays: 7 })

    expect(stats.scanned).toBe(0)
    expect(stats.turn).toBe(0)
  })
})
