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
    getHealthChecks: () => [],

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
      stats: async (name) => ({
        table: name,
        documents: docs.get(name)?.size ?? 0,
        updatedAt: new Date().toISOString(),
      }),
      getHealth: async (name) => ({
        table: name,
        status: tables.has(name) ? 'ok' : 'warn',
        message: tables.has(name) ? 'table registered' : 'table not registered',
      }),
      rebuildIndexes: async () => {},
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
    },

    query: async (table, q): Promise<QueryResult> => {
      const all = Array.from(docs.get(table)?.entries() ?? [])
      const offset = q.offset ?? 0
      const limit = q.limit ?? all.length
      const hits = all.slice(offset, offset + limit).map(([key, document]) => ({
        key,
        document,
        score: 1,
        scoreBreakdown: { hybrid: 1 },
      }))
      return {
        hits,
        total: all.length,
        diagnostics: { strategy: 'none' },
      }
    },
    multiQuery: async (queries) => Promise.all(queries.map((entry) => adapter.query(entry.table, entry.query))),
    scan: (table, opts?: ScanOpts) => scanDocuments(
      Array.from(docs.get(table)?.entries() ?? []).map(([key, document]) => ({ key, document })),
      opts,
    ),

    embedder: {
      hasChanged: async () => false,
      rebuildAll: async () => ({
        tables: tables.size,
        documents: Array.from(docs.values()).reduce((sum, table) => sum + table.size, 0),
        errors: [],
      }),
    },
  }

  return { ...adapter, ...overrides }
}
