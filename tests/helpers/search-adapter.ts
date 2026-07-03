import { mock } from 'bun:test'
import { configureOutboxPump, stopOutboxPump } from '../../src/core/search-outbox'
import { resetOutboxForTests } from '../../packages/core/src/search/outbox'
import type {
  Document,
  IndexItem,
  Query,
  QueryResult,
  ScanOpts,
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

/**
 * Mirrors live antfly scan semantics: keys-only without a fields projection,
 * projected fields only with one — so a consumer that forgets to project
 * fails here the same way it fails live.
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

export function installSearchAdapter(adapter: SearchAdapter): void {
  ;(globalThis as AppServicesGlobal).__bakinAppServices = { search: adapter }
  // ctx.search writes journal through the outbox and land via the pump —
  // wire it to this adapter (identity mapping) and start each install from
  // an empty journal so per-test assertions see only their own writes.
  configureOutboxPump({ adapter, resolveTargets: (logical) => [logical] })
  resetOutboxForTests()
}

export function clearSearchAdapter(): void {
  delete (globalThis as AppServicesGlobal).__bakinAppServices
  stopOutboxPump()
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
    // Batches double-record as per-item index calls: the outbox drains via
    // batchIndex, and per-item spies keep test assertions readable.
    for (const item of items) await documentsIndex(table, item.key, item.doc)
    return { indexed: items.length, failed: [] }
  })
  const documentsRemove = mock(async (table: string, key: string): Promise<void> => {
    docs.get(table)?.delete(key)
  })
  const documentsBatchRemove = mock(async (table: string, keys: string[]): Promise<number> => {
    const target = docs.get(table)
    let removed = 0
    for (const key of keys) {
      await documentsRemove(table, key)
      if (target) removed++
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
  const scan = mock((table: string, opts?: ScanOpts): AsyncIterable<ScannedDocument> => (
    scanDocuments(
      scanItems.get(table) ?? Array.from(docs.get(table)?.entries() ?? []).map(([key, document]) => ({ key, document })),
      opts,
    )
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
