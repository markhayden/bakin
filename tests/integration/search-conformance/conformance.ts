/**
 * Adapter-agnostic conformance suite — every SearchAdapter implementation
 * must pass these cases (D17). Run against the mock in-tree; A7 runs the
 * same suite against a real ephemeral antfly. Cases assert CONTRACT
 * behavior only: anything here must hold for any conforming engine.
 */
import { describe, it, expect } from 'bun:test'
import type { SearchAdapter } from '../../../packages/core/src/adapters/search'

export interface ConformanceTarget {
  /** Fresh adapter per suite run; tables created here are throwaway. */
  adapter: SearchAdapter
  /** Namespace prefix so suites can run against shared engines safely. */
  prefix: string
  /** True when the engine computes real relevance (antfly); the mock uses
   *  naive substring matching, so scoring-strength cases are gated. */
  realEngine: boolean
  /** Wait until writes to `table` are queryable (real engines index async). */
  settle?: (table: string) => Promise<void>
}

export function runSearchConformanceSuite(name: string, getTarget: () => ConformanceTarget): void {
  describe(`search conformance: ${name}`, () => {
    const t = (suffix: string) => `${getTarget().prefix}${suffix}`
    const settle = async (table: string) => {
      const target = getTarget()
      if (target.settle) await target.settle(table)
    }

    it('declares capabilities and a stable mapping fingerprint', () => {
      const { adapter } = getTarget()
      // Transitional-optional on the type; REQUIRED to conform.
      expect(adapter.capabilities).toBeDefined()
      expect(adapter.mappingFingerprint).toBeDefined()
      const caps = adapter.capabilities!()
      expect(caps.legs).toContain('full-text')
      expect(typeof caps.rerank).toBe('boolean')
      expect(typeof caps.transform).toBe('boolean')
      const fp = adapter.mappingFingerprint!()
      expect(typeof fp).toBe('string')
      expect(fp.length).toBeGreaterThan(0)
      expect(adapter.mappingFingerprint!()).toBe(fp)
    })

    it('table lifecycle: create → list → stats → drop', async () => {
      const { adapter } = getTarget()
      const table = t('lifecycle')
      await adapter.tables.create(table, {
        fields: { title: { type: 'text' } },
        legs: [{ name: 'full_text', capability: 'full-text', fields: ['title'] }],
      })
      const listed = await adapter.tables.list()
      expect(listed.map((x) => x.name)).toContain(table)
      const stats = await adapter.tables.stats(table)
      expect(stats?.documents ?? 0).toBe(0)
      await adapter.tables.drop(table)
      const after = await adapter.tables.list()
      expect(after.map((x) => x.name)).not.toContain(table)
    })

    it('index → query round-trip with per-leg score breakdown', async () => {
      const { adapter } = getTarget()
      const table = t('roundtrip')
      await adapter.tables.create(table, {
        fields: { title: { type: 'text' }, kind: { type: 'keyword' } },
        legs: [{ name: 'full_text', capability: 'full-text', fields: ['title'] }],
      })
      await adapter.documents.batchIndex(table, [
        { key: 'a', doc: { title: 'alpha cats', kind: 'note' } },
        { key: 'b', doc: { title: 'beta dogs', kind: 'note' } },
        { key: 'c', doc: { title: 'gamma cats', kind: 'task' } },
      ])
      await settle(table)
      const res = await adapter.query(table, { text: 'cats', limit: 10, adapterOptions: { searchableFields: ['title'] } })
      expect(res.hits.map((h) => h.key).sort()).toEqual(['a', 'c'])
      for (const hit of res.hits) {
        expect(hit.score).toBeGreaterThan(0)
        // Generic per-leg breakdown: keys are leg names, values numeric.
        if (hit.scoreBreakdown) {
          for (const [leg, score] of Object.entries(hit.scoreBreakdown)) {
            expect(typeof leg).toBe('string')
            expect(typeof score).toBe('number')
          }
        }
      }
    })

    it('per-leg health reports ready with accurate counts after writes', async () => {
      const { adapter } = getTarget()
      const table = t('health')
      await adapter.tables.create(table, {
        fields: { title: { type: 'text' } },
        legs: [{ name: 'full_text', capability: 'full-text', fields: ['title'] }],
      })
      await adapter.documents.batchIndex(table, [
        { key: 'h1', doc: { title: 'one' } },
        { key: 'h2', doc: { title: 'two' } },
      ])
      await settle(table)
      expect(adapter.tables.health).toBeDefined()
      const legs = await adapter.tables.health!(table)
      expect(legs.length).toBeGreaterThan(0)
      for (const leg of legs) {
        expect(['ready', 'building', 'error']).toContain(leg.state)
      }
      const ft = legs.find((l) => l.leg === 'full_text') ?? legs[0]
      expect(ft.state).toBe('ready')
      expect(ft.indexedCount).toBeGreaterThanOrEqual(2)
    })

    it('remove and batchRemove drop documents from results and stats', async () => {
      const { adapter } = getTarget()
      const table = t('remove')
      await adapter.tables.create(table, {
        fields: { title: { type: 'text' } },
        legs: [{ name: 'full_text', capability: 'full-text', fields: ['title'] }],
      })
      await adapter.documents.batchIndex(table, [
        { key: 'r1', doc: { title: 'stay' } },
        { key: 'r2', doc: { title: 'go' } },
        { key: 'r3', doc: { title: 'go too' } },
      ])
      await settle(table)
      await adapter.documents.remove(table, 'r2')
      const removed = await adapter.documents.batchRemove(table, ['r3', 'missing'])
      expect(removed).toBe(1)
      await settle(table)
      const stats = await adapter.tables.stats(table)
      expect(stats?.documents).toBe(1)
    })

    it('scan projects only requested fields (keys-only without projection)', async () => {
      const { adapter } = getTarget()
      const table = t('scan')
      await adapter.tables.create(table, {
        fields: { title: { type: 'text' }, secret: { type: 'keyword' } },
        legs: [{ name: 'full_text', capability: 'full-text', fields: ['title'] }],
      })
      await adapter.documents.index(table, 's1', { title: 'visible', secret: 'hidden' })
      await settle(table)
      const bare: string[] = []
      for await (const d of adapter.scan(table)) {
        bare.push(d.key)
        expect(Object.keys(d.document)).toHaveLength(0)
      }
      expect(bare).toContain('s1')
      for await (const d of adapter.scan(table, { fields: ['title'] })) {
        expect(d.document.title).toBe('visible')
        expect(d.document.secret).toBeUndefined()
      }
    })

    it('transform mutates a document without full reindex semantics changing', async () => {
      const { adapter } = getTarget()
      const table = t('transform')
      await adapter.tables.create(table, {
        fields: { title: { type: 'text' }, status: { type: 'keyword' } },
        legs: [{ name: 'full_text', capability: 'full-text', fields: ['title'] }],
      })
      await adapter.documents.index(table, 'x1', { title: 'doc', status: 'draft' })
      await settle(table)
      await adapter.documents.transform(table, 'x1', (doc) => ({ ...doc, status: 'done' }))
      await settle(table)
      for await (const d of adapter.scan(table, { fields: ['status'] })) {
        if (d.key === 'x1') expect(d.document.status).toBe('done')
      }
    })
  })
}
