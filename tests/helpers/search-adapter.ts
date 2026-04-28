import { mock } from 'bun:test'
import type {
  Document,
  IndexItem,
  Query,
  QueryResult,
  ScannedDocument,
  SearchAdapter,
  TableConfig,
  TableHealth,
  TableInfo,
  TableStats,
} from '@bakin/core/adapters/search'

type AppServicesGlobal = typeof globalThis & {
  __bakinAppServices?: { search: SearchAdapter }
}

async function* scanDocuments(items: ScannedDocument[]): AsyncIterable<ScannedDocument> {
  for (const item of items) yield item
}

export function installSearchAdapter(adapter: SearchAdapter): void {
  ;(globalThis as AppServicesGlobal).__bakinAppServices = { search: adapter }
}

export function clearSearchAdapter(): void {
  delete (globalThis as AppServicesGlobal).__bakinAppServices
}

export function createSearchAdapterHarness() {
  let availableValue = true
  const tables = new Map<string, TableConfig>()
  const docs = new Map<string, Map<string, Document>>()
  const scanItems = new Map<string, ScannedDocument[]>()
  const health = new Map<string, TableHealth | null>()
  const stats = new Map<string, TableStats | null>()

  function ensureDocs(table: string): Map<string, Document> {
    let tableDocs = docs.get(table)
    if (!tableDocs) {
      tableDocs = new Map()
      docs.set(table, tableDocs)
    }
    return tableDocs
  }

  const initialize = mock(async () => {})
  const shutdown = mock(async () => {})
  const available = mock(async () => availableValue)
  const getHealthChecks = mock(() => [])

  const tablesList = mock(async (): Promise<TableInfo[]> => (
    Array.from(tables.entries()).map(([name, config]) => ({
      name,
      config,
      documentCount: docs.get(name)?.size ?? 0,
    }))
  ))
  const tablesCreate = mock(async (name: string, config: TableConfig): Promise<void> => {
    tables.set(name, config)
    ensureDocs(name)
  })
  const tablesDrop = mock(async (name: string): Promise<void> => {
    tables.delete(name)
    docs.delete(name)
    scanItems.delete(name)
    health.delete(name)
    stats.delete(name)
  })
  const tablesStats = mock(async (name: string): Promise<TableStats | null> => (
    stats.has(name)
      ? stats.get(name)!
      : { table: name, documents: docs.get(name)?.size ?? 0 }
  ))
  const tablesGetHealth = mock(async (name: string): Promise<TableHealth | null> => (
    health.has(name) ? health.get(name)! : null
  ))
  const tablesRebuildIndexes = mock(async () => {})

  const documentsIndex = mock(async (table: string, key: string, doc: Document): Promise<void> => {
    ensureDocs(table).set(key, doc)
  })
  const documentsBatchIndex = mock(async (table: string, items: IndexItem[]): Promise<{ indexed: number; failed: [] }> => {
    const target = ensureDocs(table)
    for (const item of items) target.set(item.key, item.doc)
    return { indexed: items.length, failed: [] }
  })
  const documentsRemove = mock(async (table: string, key: string): Promise<void> => {
    docs.get(table)?.delete(key)
  })
  const documentsBatchRemove = mock(async (table: string, keys: string[]): Promise<number> => {
    const target = docs.get(table)
    if (!target) return 0
    let removed = 0
    for (const key of keys) {
      if (target.delete(key)) removed++
    }
    return removed
  })
  const documentsTransform = mock(async (
    table: string,
    key: string,
    fn: (doc: Document) => Promise<Document> | Document,
  ): Promise<void> => {
    const target = ensureDocs(table)
    const current = target.get(key) ?? {}
    target.set(key, await fn(current))
  })

  const query = mock(async (table: string, q: Query): Promise<QueryResult> => {
    const all = Array.from(docs.get(table)?.entries() ?? [])
    const offset = q.offset ?? 0
    const limit = q.limit ?? all.length
    return {
      hits: all.slice(offset, offset + limit).map(([key, document]) => ({
        key,
        document,
        score: 1,
        scoreBreakdown: { hybrid: 1 },
      })),
      total: all.length,
      diagnostics: { strategy: 'none', durationMs: 0 },
    }
  })
  const multiQuery = mock(async (queries: Array<{ table: string; query: Query }>): Promise<QueryResult[]> => (
    Promise.all(queries.map((entry) => adapter.query(entry.table, entry.query)))
  ))
  const scan = mock((table: string): AsyncIterable<ScannedDocument> => (
    scanDocuments(scanItems.get(table) ?? Array.from(docs.get(table)?.entries() ?? []).map(([key, document]) => ({ key, document })))
  ))

  const embedderHasChanged = mock(async () => false)
  const embedderRebuildAll = mock(async () => ({ tables: tables.size, documents: 0, errors: [] }))

  const adapter: SearchAdapter = {
    name: 'mock-search',
    version: '0.0.0',
    requiredCoreVersion: '*',
    initialize,
    shutdown,
    available,
    getHealthChecks,
    tables: {
      list: tablesList,
      create: tablesCreate,
      drop: tablesDrop,
      stats: tablesStats,
      getHealth: tablesGetHealth,
      rebuildIndexes: tablesRebuildIndexes,
    },
    documents: {
      index: documentsIndex,
      batchIndex: documentsBatchIndex,
      remove: documentsRemove,
      batchRemove: documentsBatchRemove,
      transform: documentsTransform,
    },
    query,
    multiQuery,
    scan,
    embedder: {
      hasChanged: embedderHasChanged,
      rebuildAll: embedderRebuildAll,
    },
  }

  return {
    adapter,
    setAvailable(value: boolean) {
      availableValue = value
    },
    setTables(names: string[]) {
      tables.clear()
      for (const name of names) tables.set(name, { fields: {} })
    },
    setScanItems(table: string, items: ScannedDocument[]) {
      scanItems.set(table, items)
    },
    setTableStats(table: string, value: TableStats | null) {
      stats.set(table, value)
    },
    setTableHealth(table: string, value: TableHealth | null) {
      health.set(table, value)
    },
    calls: {
      initialize,
      shutdown,
      available,
      getHealthChecks,
      tablesList,
      tablesCreate,
      tablesDrop,
      tablesStats,
      tablesGetHealth,
      tablesRebuildIndexes,
      documentsIndex,
      documentsBatchIndex,
      documentsRemove,
      documentsBatchRemove,
      documentsTransform,
      query,
      multiQuery,
      scan,
      embedderHasChanged,
      embedderRebuildAll,
    },
  }
}
