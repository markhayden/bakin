import type { Document, QueryResult, ScanOpts, ScannedDocument, TableConfig, TableInfo } from './concepts'
import type { SearchAdapter } from './index'

/**
 * Mirrors live antfly scan semantics: WITHOUT a fields projection only keys
 * come back (empty documents); WITH one, only the projected fields. A mock
 * that returned full documents un-projected would green-light consumers that
 * forget to project — the exact bug class this contract exists to prevent.
 */
async function* scanDocuments(items: ScannedDocument[], opts?: ScanOpts): AsyncIterable<ScannedDocument> {
  for (const item of items) {
    if (!opts?.fields?.length) {
      yield { key: item.key, document: {} }
      continue
    }
    const projected: Document = {}
    for (const field of opts.fields) {
      if (field in item.document) projected[field] = item.document[field]
    }
    yield { key: item.key, document: projected }
  }
}

export function createMockSearchAdapter(
  overrides: Partial<SearchAdapter> = {}
): SearchAdapter {
  const tables = new Map<string, TableConfig>()
  const docs = new Map<string, Map<string, Document>>()

  function ensureTable(name: string): Map<string, Document> {
    let table = docs.get(name)
    if (!table) {
      table = new Map()
      docs.set(name, table)
    }
    return table
  }

  const adapter: SearchAdapter = {
    name: 'mock-search',
    version: '0.0.0',
    requiredCoreVersion: '*',
    initialize: async () => {},
    shutdown: async () => {},
    available: async () => true,
    capabilities: () => ({
      legs: ['full-text', 'text-embedding', 'media-embedding'],
      rerank: false,
      facets: true,
      transform: true,
    }),
    mappingFingerprint: () => 'mock-mapping-v1',

    tables: {
      list: async (): Promise<TableInfo[]> => Array.from(tables.entries()).map(([name, config]) => ({
        name,
        config,
        documentCount: docs.get(name)?.size ?? 0,
      })),
      create: async (name, config) => {
        tables.set(name, config)
        ensureTable(name)
      },
      drop: async (name) => {
        tables.delete(name)
        docs.delete(name)
      },
      stats: async (name) => {
        // Mirror the real engine: unknown table → null (404). Fabricating
        // stats would let exists-first create checks skip real creates.
        if (!tables.has(name)) return null
        return {
          table: name,
          documents: docs.get(name)?.size ?? 0,
          updatedAt: new Date().toISOString(),
        }
      },
      health: async (name) => {
        const config = tables.get(name)
        const count = docs.get(name)?.size ?? 0
        const legs = config?.legs?.length
          ? config.legs.map((leg) => leg.name)
          : ['full_text']
        return legs.map((leg) => ({ leg, state: 'ready' as const, indexedCount: count }))
      },
    },

    documents: {
      index: async (table, key, doc) => {
        ensureTable(table).set(key, doc)
      },
      batchIndex: async (table, items) => {
        const target = ensureTable(table)
        for (const item of items) target.set(item.key, item.doc)
        return { indexed: items.length, failed: [] }
      },
      remove: async (table, key) => {
        docs.get(table)?.delete(key)
      },
      batchRemove: async (table, keys) => {
        let removed = 0
        const target = docs.get(table)
        if (!target) return removed
        for (const key of keys) {
          if (target.delete(key)) removed++
        }
        return removed
      },
      transform: async (table, key, fn) => {
        const target = ensureTable(table)
        const current = target.get(key)
        if (!current) return
        target.set(key, await fn(current))
      },
      get: async (table, key) => docs.get(table)?.get(key) ?? null,
    },

    query: async (table, q): Promise<QueryResult> => {
      const all = Array.from(docs.get(table)?.entries() ?? [])
      // Naive substring matching over string fields — honest enough that
      // conformance cases assert real filtering, cheap enough for a mock.
      // Empty text = match-all (list/count flows).
      const text = (q.text ?? '').trim().toLowerCase()
      const searchable = Array.isArray((q.adapterOptions as Record<string, unknown> | undefined)?.searchableFields)
        ? ((q.adapterOptions as Record<string, unknown>).searchableFields as string[])
        : null
      const matched = text.length === 0 || text === '*'
        ? all
        : all.filter(([, document]) =>
            Object.entries(document).some(([field, value]) =>
              typeof value === 'string'
              && (!searchable || searchable.includes(field))
              && value.toLowerCase().includes(text)))
      const offset = q.offset ?? 0
      const limit = q.limit ?? matched.length
      const legName = tables.get(table)?.legs?.[0]?.name ?? 'full_text'
      const hits = matched.slice(offset, offset + limit).map(([key, document]) => ({
        key,
        document,
        score: 1,
        scoreBreakdown: { [legName]: 1 },
      }))
      // Term buckets over the FULL matched set (engines facet the corpus,
      // not the page) — keeps the conformance facets case honest.
      let facets: Record<string, Array<{ value: string | number | boolean; count: number }>> | undefined
      if (q.facets?.length) {
        facets = {}
        for (const field of q.facets) {
          const counts = new Map<string, number>()
          for (const [, document] of matched) {
            const value = document[field]
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
              counts.set(String(value), (counts.get(String(value)) ?? 0) + 1)
            }
          }
          facets[field] = Array.from(counts.entries()).map(([value, count]) => ({ value, count }))
        }
      }
      return {
        hits,
        total: matched.length,
        ...(facets ? { facets } : {}),
        diagnostics: { strategy: 'none' },
      }
    },
    multiQuery: async (queries) => Promise.all(queries.map((entry) => adapter.query(entry.table, entry.query))),
    scan: (table, opts?: ScanOpts) => scanDocuments(
      Array.from(docs.get(table)?.entries() ?? []).map(([key, document]) => ({ key, document })),
      opts,
    ),

  }

  return { ...adapter, ...overrides }
}
