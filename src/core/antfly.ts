/**
 * Legacy Antfly facade.
 *
 * Search is owned by `SearchAdapter`; this module remains only as a temporary
 * compatibility wrapper for older tests and commands while the hard cutover
 * drains direct imports.
 */
import type { Query, TableConfig as AdapterTableConfig } from '@bakin/core/adapters/search'
import { getSearchAdapter } from './search-registry'
import { getSettings } from './settings'

export const TABLES = {
  tasks: 'bakin_tasks',
  assets: 'bakin_assets',
  projects: 'bakin_projects',
  workflows: 'bakin_workflows',
  schedule: 'bakin_schedule',
  team: 'bakin_team',
} as const

export type TableKey = keyof typeof TABLES

export interface SearchResult {
  id: string
  table: string
  score: number
  fields: Record<string, unknown>
  indexScores?: Record<string, number>
  rerankScore?: number
}

export interface TableConfig {
  description?: string
  schema?: Record<string, unknown>
  indexes?: Record<string, Record<string, unknown>>
  num_shards?: number
}

export interface IndexHealthEntry {
  name: string
  type: string
  totalIndexed: number
  walBacklog: number
  error?: string
  rebuilding: boolean
  backfillProgress?: number
}

export interface IndexHealth {
  indexes: IndexHealthEntry[]
  healthy: boolean
}

export function enabled(): boolean {
  return getSettings().antfly.enabled
}

export function available(): boolean {
  return enabled()
}

export async function initialize(): Promise<void> {
  await getSearchAdapter().initialize({
    contentDir: '',
    settings: getSettings().antfly,
  })
}

export async function listTables(): Promise<Array<{ name: string }>> {
  return getSearchAdapter().tables.list()
}

export async function createTable(tableName: string, config: TableConfig): Promise<boolean> {
  const existing = await getSearchAdapter().tables.list()
  if (existing.some((table) => table.name === tableName)) return false
  const adapterConfig: AdapterTableConfig = {
    fields: {},
    indexes: [],
    adapterOptions: {
      description: config.description,
      numShards: config.num_shards,
    },
  }
  await getSearchAdapter().tables.create(tableName, adapterConfig)
  return true
}

export async function dropTable(tableName: string): Promise<void> {
  await getSearchAdapter().tables.drop(tableName)
}

export async function getTableStats(tableName: string): Promise<Record<string, unknown> | null> {
  const stats = await getSearchAdapter().tables.stats(tableName)
  return stats ? { ...stats, num_docs: stats.documents } : null
}

export async function indexDocument(
  tableName: string,
  key: string,
  doc: Record<string, unknown>,
): Promise<void> {
  await getSearchAdapter().documents.index(tableName, key, doc)
}

export async function removeDocument(tableName: string, key: string): Promise<void> {
  await getSearchAdapter().documents.remove(tableName, key)
}

export async function transformDocument(
  tableName: string,
  key: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await getSearchAdapter().documents.transform(tableName, key, (doc) => ({ ...doc, ...fields }))
}

export async function batchIndex(
  tableName: string,
  docs: Record<string, Record<string, unknown>>,
): Promise<number> {
  const items = Object.entries(docs).map(([key, doc]) => ({ key, doc }))
  return (await getSearchAdapter().documents.batchIndex(tableName, items)).indexed
}

export async function batchRemove(tableName: string, keys: string[]): Promise<number> {
  return getSearchAdapter().documents.batchRemove(tableName, keys)
}

export async function queryTable(
  tableName: string,
  query: string,
  options: {
    limit?: number
    offset?: number
    filters?: Record<string, string | boolean | number>
    aggregations?: Record<string, unknown>
    strategy?: 'rrf' | 'semantic_only' | 'full_text_only'
    indexes?: string[]
    rerank?: boolean
    rerankField?: string
  } = {},
): Promise<{ results: SearchResult[]; aggregations?: Record<string, unknown>; took: number; total: number }> {
  const result = await getSearchAdapter().query(tableName, {
    text: query,
    limit: options.limit,
    offset: options.offset,
    filters: filtersFromRecord(options.filters),
    strategy: mapStrategy(options.strategy),
    rerank: options.rerank,
    adapterOptions: {
      indexes: options.indexes,
      rerankField: options.rerankField,
    },
  })
  return {
    results: result.hits.map((hit) => ({
      id: hit.key,
      table: tableName,
      score: hit.score,
      fields: hit.document,
      rerankScore: hit.scoreBreakdown?.rerank,
    })),
    aggregations: result.aggregations,
    took: result.diagnostics?.durationMs ?? 0,
    total: result.total ?? result.hits.length,
  }
}

export async function multiQuery(
  query: string,
  tables: string[],
  options: {
    limit?: number
    filters?: Record<string, string | boolean | number>
    indexesByTable?: Record<string, string[]>
    rerank?: boolean
    rerankFieldByTable?: Record<string, string>
  } = {},
): Promise<{ results: SearchResult[]; aggregations?: Record<string, unknown>; took: number; total: number }> {
  const perTableLimit = options.limit ? Math.ceil(options.limit / Math.max(tables.length, 1)) : undefined
  const responses = await getSearchAdapter().multiQuery(tables.map((table) => ({
    table,
    query: {
      text: query,
      limit: perTableLimit,
      filters: filtersFromRecord(options.filters),
      rerank: options.rerank,
      adapterOptions: {
        indexes: options.indexesByTable?.[table],
        rerankField: options.rerankFieldByTable?.[table],
      },
    },
  })))
  const results = responses.flatMap((response, index) => response.hits.map((hit) => ({
    id: hit.key,
    table: tables[index],
    score: hit.score,
    fields: hit.document,
    rerankScore: hit.scoreBreakdown?.rerank,
  }))).sort((a, b) => b.score - a.score)
  const limit = options.limit ?? results.length
  return {
    results: results.slice(0, limit),
    took: Math.max(0, ...responses.map((response) => response.diagnostics?.durationMs ?? 0)),
    total: responses.reduce((sum, response) => sum + (response.total ?? response.hits.length), 0),
  }
}

export async function* scanTable(
  tableName: string,
): AsyncGenerator<{ key: string; doc: Record<string, unknown> }> {
  for await (const { key, document } of getSearchAdapter().scan(tableName)) {
    yield { key, doc: document }
  }
}

export async function getIndexHealth(tableName: string): Promise<IndexHealth | null> {
  const health = await getSearchAdapter().tables.getHealth(tableName)
  const details = health?.details as Partial<IndexHealth> | undefined
  if (!details || !Array.isArray(details.indexes)) return null
  return {
    indexes: details.indexes,
    healthy: typeof details.healthy === 'boolean' ? details.healthy : health?.status === 'ok',
  }
}

export async function rebuildIndexes(tableName: string): Promise<boolean> {
  await getSearchAdapter().tables.rebuildIndexes(tableName)
  return true
}

export function hasEmbedderChanged(): boolean {
  void getSearchAdapter().embedder.hasChanged()
  return false
}

function filtersFromRecord(filters?: Record<string, string | boolean | number>): Query['filters'] {
  if (!filters) return undefined
  return Object.entries(filters).map(([field, value]) => ({ field, op: 'eq', value }))
}

function mapStrategy(strategy: 'rrf' | 'semantic_only' | 'full_text_only' | undefined): Query['strategy'] {
  switch (strategy) {
    case 'full_text_only': return 'fts'
    case 'semantic_only': return 'vector'
    case 'rrf': return 'hybrid'
    default: return undefined
  }
}
