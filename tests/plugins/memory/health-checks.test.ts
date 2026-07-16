import { describe, expect, it } from 'bun:test'
import type { SearchHealthSnapshot } from '@makinbakin/sdk/types'
import { checkSearchIndexObservations } from '../../../plugins/health/lib/system-checks/search'

function snapshot(tables: SearchHealthSnapshot['tables']): SearchHealthSnapshot {
  return { enabled: true, tables }
}

const table = {
  logical: 'bakin_memory',
  physical: 'bakin_memory_v1',
  schemaVersion: 1,
  state: 'active' as const,
  phase: null,
  pluginId: 'memory',
  docCount: 12,
  lastIndexedAt: null,
  lastRebuildAt: null,
  journalPending: 0,
  legs: [],
  healthy: true,
}

describe('Memory Search health consolidation', () => {
  it('publishes Memory table counts through the canonical Health Indexes source', async () => {
    const observations = await checkSearchIndexObservations(async () => snapshot([table]))

    expect(observations).toEqual([expect.objectContaining({
      key: 'indexes.tables',
      status: 'healthy',
      evidence: expect.objectContaining({ tableCount: 1, totalDocuments: 12 }),
    })])
  })

  it('keeps unreadable Memory table stats visible as a structured warning', async () => {
    const observations = await checkSearchIndexObservations(async () => snapshot([{ ...table, docCount: null }]))

    expect(observations).toEqual([expect.objectContaining({
      key: 'indexes.tables',
      status: 'warning',
      evidence: expect.objectContaining({ unreadableTables: ['bakin_memory'] }),
    })])
  })
})
