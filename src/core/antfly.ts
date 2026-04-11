/**
 * Antfly core module for Bakin.
 * Optional vector database integration — Bakin works without it.
 * When enabled, provides dual-write sync and hybrid search across all content.
 *
 * Uses @antfly/sdk AntflyClient for all API interactions.
 */
import { AntflyClient } from '@antfly/sdk'
import type { BatchRequest, QueryRequest, QueryResult, QueryHit } from '@antfly/sdk'
import { createLogger } from './logger'
import { getSettings } from './settings'

const log = createLogger('antfly')

// ---------------------------------------------------------------------------
// Singleton client (survives Next.js webpack re-evaluation)
// ---------------------------------------------------------------------------
const _g = globalThis as typeof globalThis & {
  __bakinAntflyClient?: AntflyClient | null
  __bakinAntflyReady?: boolean
  __bakinAntflyEmbedderHash?: string
}

function getClient(): AntflyClient | null { return _g.__bakinAntflyClient ?? null }
function setClient(c: AntflyClient | null) { _g.__bakinAntflyClient = c }

// ---------------------------------------------------------------------------
// Table names — bakin_ prefix for clear namespacing
// ---------------------------------------------------------------------------
export const TABLES = {
  tasks: 'bakin_tasks',
  audit: 'bakin_audit',
  content: 'bakin_content',
  assets: 'bakin_assets',
  projects: 'bakin_projects',
  workflows: 'bakin_workflows',
  schedule: 'bakin_schedule',
  team: 'bakin_team',
} as const

/** Stale beacon_ tables to wipe on startup */
const LEGACY_TABLES = [
  'beacon_tasks',
  'beacon_decisions',
  'beacon_audit',
  'beacon_content',
  'beacon_assets',
]

export type TableKey = keyof typeof TABLES

export interface SearchResult {
  id: string
  table: string
  score: number
  fields: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function embedderHash(settings: ReturnType<typeof getSettings>): string {
  const e = settings.antfly.embedder
  return `${e.provider}:${e.model}`
}

function resolveTable(table: string): string {
  return TABLES[table as TableKey] || table
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function enabled(): boolean {
  return getSettings().antfly.enabled
}

export async function initialize(): Promise<void> {
  if (_g.__bakinAntflyReady) return

  const settings = getSettings()
  if (!settings.antfly.enabled) {
    log.info('Antfly disabled — running in file-only mode')
    _g.__bakinAntflyReady = true
    return
  }

  const config: ConstructorParameters<typeof AntflyClient>[0] = {
    baseUrl: settings.antfly.url,
  }
  if (settings.antfly.auth) {
    config.auth = {
      type: 'basic',
      username: settings.antfly.auth.username,
      password: settings.antfly.auth.password,
    }
  }

  const client = new AntflyClient(config)
  setClient(client)

  try {
    const status = await client.getStatus()
    log.info('Antfly connected', { url: settings.antfly.url, health: status?.health })

    // Wipe legacy beacon_* tables
    await wipeLegacyTables(client)

    // Store embedder hash for change detection
    _g.__bakinAntflyEmbedderHash = embedderHash(settings)

    _g.__bakinAntflyReady = true
  } catch (err) {
    log.error('Failed to connect to Antfly — falling back to file-only mode', err)
    setClient(null)
    _g.__bakinAntflyReady = true
  }
}

async function wipeLegacyTables(client: AntflyClient): Promise<void> {
  try {
    const tables = await client.tables.list()
    const existingNames = new Set(tables.map(t => t.name))

    for (const legacy of LEGACY_TABLES) {
      if (existingNames.has(legacy)) {
        try {
          await client.tables.drop(legacy)
          log.info(`Wiped legacy table: ${legacy}`)
        } catch (err) {
          log.warn(`Failed to wipe legacy table ${legacy}`, err)
        }
      }
    }
  } catch {
    // Can't list tables — skip cleanup
  }
}

// ---------------------------------------------------------------------------
// Table Management
// ---------------------------------------------------------------------------

export interface TableConfig {
  description?: string
  schema: {
    default_type: string
    document_schemas: Record<string, {
      schema: Record<string, unknown>
    }>
  }
  indexes: Record<string, Record<string, unknown>>
  num_shards?: number
}

/**
 * Create a table if it doesn't already exist.
 * Returns true if the table was created, false if it already existed.
 */
export async function createTable(tableName: string, config: TableConfig): Promise<boolean> {
  const client = getClient()
  if (!client) return false

  try {
    const tables = await client.tables.list()
    if (tables.some(t => t.name === tableName)) return false

    await client.tables.create(tableName, {
      num_shards: config.num_shards ?? 1,
      description: config.description,
      schema: config.schema as Record<string, unknown>,
      indexes: config.indexes as Record<string, unknown>,
    } as Record<string, unknown>)
    log.info(`Table created: ${tableName}`)
    return true
  } catch (err) {
    log.warn(`Failed to create table ${tableName}`, err)
    return false
  }
}

/**
 * Get stats for a table (document count, index status, disk usage).
 */
export async function getTableStats(tableName: string): Promise<Record<string, unknown> | null> {
  const client = getClient()
  if (!client) return null

  try {
    // Get doc count via matchAll query with limit 0
    const { matchAll } = await import('@antfly/sdk')
    const queryResult = await client.tables.query(tableName, { full_text_search: matchAll(), limit: 0 } as unknown as QueryRequest)
    const total = (queryResult as unknown as { responses: Array<{ hits: { total: number } }> })
      .responses?.[0]?.hits?.total ?? 0

    // Get table metadata (indexes, schema, storage)
    let info: Record<string, unknown> = {}
    try {
      info = await client.tables.get(tableName) as unknown as Record<string, unknown>
    } catch {
      const tables = await client.tables.list()
      const match = tables.find(t => t.name === tableName)
      if (match) info = match as unknown as Record<string, unknown>
    }

    return { ...info, num_docs: total }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Index (write) — uses batch API via SDK
// ---------------------------------------------------------------------------

/**
 * Index a document to Antfly. Fire-and-forget — never blocks the caller.
 */
export async function indexDocument(
  tableName: string,
  key: string,
  doc: Record<string, unknown>,
): Promise<void> {
  const client = getClient()
  if (!client || !enabled()) return

  try {
    await client.tables.batch(tableName, {
      inserts: { [key]: doc },
    })
  } catch (err) {
    log.warn('Antfly index failed (non-blocking)', err, { table: tableName, key })
  }
}

/**
 * Remove a document from Antfly.
 */
export async function removeDocument(tableName: string, key: string): Promise<void> {
  const client = getClient()
  if (!client || !enabled()) return

  try {
    await client.tables.batch(tableName, {
      deletes: [key],
    })
  } catch (err) {
    log.warn('Antfly delete failed', err, { table: tableName, key })
  }
}

/**
 * Atomic field transform without re-embedding.
 * Uses batch inserts with partial document — Antfly merges fields.
 */
export async function transformDocument(
  tableName: string,
  key: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const client = getClient()
  if (!client || !enabled()) return

  try {
    await client.tables.batch(tableName, {
      inserts: { [key]: fields },
    })
  } catch (err) {
    log.warn('Antfly transform failed', err, { table: tableName, key })
  }
}

/**
 * Batch index multiple documents at once.
 */
export async function batchIndex(
  tableName: string,
  docs: Record<string, Record<string, unknown>>,
): Promise<number> {
  const client = getClient()
  if (!client || !enabled()) return 0

  try {
    const result = await client.tables.batch(tableName, { inserts: docs })
    return result?.inserted ?? Object.keys(docs).length
  } catch (err) {
    log.warn('Antfly batch index failed', err, { table: tableName, count: Object.keys(docs).length })
    return 0
  }
}

/**
 * Batch delete multiple documents at once.
 */
export async function batchRemove(tableName: string, keys: string[]): Promise<number> {
  const client = getClient()
  if (!client || !enabled()) return 0

  try {
    const result = await client.tables.batch(tableName, { deletes: keys })
    return result?.deleted ?? keys.length
  } catch (err) {
    log.warn('Antfly batch delete failed', err, { table: tableName, count: keys.length })
    return 0
  }
}

// ---------------------------------------------------------------------------
// Search (read) — uses SDK query/multiquery
// ---------------------------------------------------------------------------

/**
 * Search a single table with hybrid (full-text + semantic) search.
 */
export async function queryTable(
  tableName: string,
  query: string,
  options: {
    limit?: number
    offset?: number
    filters?: Record<string, string | boolean | number>
    aggregations?: Record<string, unknown>
    strategy?: 'rrf' | 'semantic_only' | 'full_text_only'
  } = {},
): Promise<{ results: SearchResult[]; aggregations?: Record<string, unknown>; took: number; total: number }> {
  const client = getClient()
  if (!client || !enabled()) {
    return { results: [], took: 0, total: 0 }
  }

  const settings = getSettings()
  const strategy = options.strategy ?? settings.antfly.search.strategy
  const limit = options.limit ?? settings.antfly.search.defaultLimit

  const request: QueryRequest = {
    table: tableName,
    limit,
    offset: options.offset,
    indexes: ['embeddings'],
  }

  // Build query based on strategy
  if (strategy !== 'semantic_only') {
    request.full_text_search = { query } as QueryRequest['full_text_search']
  }
  if (strategy !== 'full_text_only') {
    request.semantic_search = query
  }

  // Build filter query from filters map
  if (options.filters && Object.keys(options.filters).length > 0) {
    const filterParts = Object.entries(options.filters)
      .map(([k, v]) => `+${k}:${v}`)
      .join(' ')
    request.filter_query = { query: filterParts } as QueryRequest['filter_query']
  }

  if (options.aggregations) {
    request.aggregations = options.aggregations as QueryRequest['aggregations']
  }

  try {
    const result = await client.tables.query(tableName, request)
    const response = result?.responses?.[0]
    if (!response) return { results: [], took: 0, total: 0 }

    return {
      results: mapHits(response, tableName),
      aggregations: response.aggregations as Record<string, unknown> | undefined,
      took: response.took ?? 0,
      total: response.hits?.total ?? 0,
    }
  } catch (err) {
    log.error('Antfly query failed', err, { table: tableName })
    return { results: [], took: 0, total: 0 }
  }
}

/**
 * Multi-table search in a single request using SDK multiquery.
 */
export async function multiQuery(
  query: string,
  tables: string[],
  options: {
    limit?: number
    filters?: Record<string, string | boolean | number>
    aggregations?: Record<string, unknown>
  } = {},
): Promise<{ results: SearchResult[]; aggregations?: Record<string, unknown>; took: number; total: number }> {
  const client = getClient()
  if (!client || !enabled()) {
    return { results: [], took: 0, total: 0 }
  }

  const settings = getSettings()
  const limit = options.limit ?? settings.antfly.search.defaultLimit
  const perTable = Math.ceil(limit / tables.length)

  const requests: QueryRequest[] = tables.map(tableName => {
    const req: QueryRequest = {
      table: tableName,
      full_text_search: { query } as QueryRequest['full_text_search'],
      semantic_search: query,
      indexes: ['embeddings'],
      limit: perTable,
    }
    if (options.filters && Object.keys(options.filters).length > 0) {
      const filterParts = Object.entries(options.filters)
        .map(([k, v]) => `+${k}:${v}`)
        .join(' ')
      req.filter_query = { query: filterParts } as QueryRequest['filter_query']
    }
    if (options.aggregations) {
      req.aggregations = options.aggregations as QueryRequest['aggregations']
    }
    return req
  })

  try {
    const result = await client.multiquery(requests)
    const allResults: SearchResult[] = []
    let totalTook = 0
    let totalHits = 0
    const mergedAggs: Record<string, unknown> = {}

    for (let i = 0; i < (result?.responses?.length ?? 0); i++) {
      const response = result!.responses![i]
      const tableName = tables[i]
      allResults.push(...mapHits(response, tableName))
      totalTook = Math.max(totalTook, response.took ?? 0)
      totalHits += response.hits?.total ?? 0
      if (response.aggregations) {
        Object.assign(mergedAggs, response.aggregations)
      }
    }

    return {
      results: allResults.sort((a, b) => b.score - a.score).slice(0, limit),
      aggregations: Object.keys(mergedAggs).length > 0 ? mergedAggs : undefined,
      took: totalTook,
      total: totalHits,
    }
  } catch (err) {
    log.error('Antfly multiquery failed', err)
    return { results: [], took: 0, total: 0 }
  }
}

function mapHits(response: QueryResult, tableName: string): SearchResult[] {
  if (!response?.hits?.hits) return []
  return response.hits.hits.map((hit: QueryHit) => ({
    id: hit._id || '',
    table: tableName,
    score: hit._score || 0,
    fields: hit._source || {},
  }))
}

// ---------------------------------------------------------------------------
// Table scanning
// ---------------------------------------------------------------------------

/**
 * Scan all keys in a table. Returns an async generator.
 */
export async function* scanTable(
  tableName: string,
): AsyncGenerator<{ key: string; doc: Record<string, unknown> }> {
  const client = getClient()
  if (!client || !enabled()) return

  for await (const doc of client.tables.scan(tableName)) {
    const { _key, ...fields } = doc
    yield { key: _key, doc: fields }
  }
}

// ---------------------------------------------------------------------------
// Index management
// ---------------------------------------------------------------------------

/**
 * Rebuild indexes for a table (drops + re-creates).
 * Triggers full re-embedding for vector indexes.
 */
export async function rebuildIndexes(tableName: string): Promise<boolean> {
  const client = getClient()
  if (!client) return false

  try {
    // Get current index configs, then drop + re-create each
    const indexStatuses = await client.indexes.list(tableName)
    for (const [indexName, indexInfo] of Object.entries(indexStatuses)) {
      const config = 'config' in indexInfo ? indexInfo.config : null
      if (!config || typeof config !== 'object') continue

      try {
        await client.indexes.drop(tableName, indexName)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await client.indexes.create(tableName, config as any)
        log.info(`Rebuilt index ${indexName} on ${tableName}`)
      } catch (err) {
        log.warn(`Failed to rebuild index ${indexName} on ${tableName}`, err)
      }
    }
    return true
  } catch (err) {
    log.error(`Failed to rebuild indexes for ${tableName}`, err)
    return false
  }
}

/**
 * Check if the embedder config has changed since initialization.
 * If so, indexes need to be rebuilt.
 */
export function hasEmbedderChanged(): boolean {
  const settings = getSettings()
  const current = embedderHash(settings)
  return _g.__bakinAntflyEmbedderHash !== current
}

// ---------------------------------------------------------------------------
// Backward-compat wrappers (used by existing callers)
// These will be replaced when each plugin wires ctx.search.
// ---------------------------------------------------------------------------

/**
 * Legacy index function — resolves table alias and indexes.
 * @deprecated Use indexDocument() directly with full table name.
 */
export async function index(
  table: string,
  doc: { id: string; content: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const tableName = resolveTable(table)
  await indexDocument(tableName, doc.id, {
    id: doc.id,
    content: doc.content,
    created_at: new Date().toISOString(),
    ...doc.metadata,
  })
}

/**
 * Legacy remove function.
 * @deprecated Use removeDocument() directly.
 */
export async function remove(table: string, id: string): Promise<void> {
  const tableName = resolveTable(table)
  await removeDocument(tableName, id)
}

/**
 * Legacy hybrid search across tables.
 * @deprecated Use queryTable() or multiQuery() directly.
 */
export async function search(
  query: string,
  options: { table?: string; limit?: number; agent?: string } = {},
): Promise<SearchResult[]> {
  if (!getClient() || !enabled()) return []

  const limit = options.limit || 10

  if (options.table) {
    const tableName = resolveTable(options.table)
    const filters = options.agent ? { agent: options.agent } : undefined
    const result = await queryTable(tableName, query, { limit, filters })
    return result.results
  }

  // Cross-table search
  const allTables = Object.values(TABLES)
  const filters = options.agent ? { agent: options.agent } : undefined
  const result = await multiQuery(query, allTables, { limit, filters })
  return result.results
}

// ---------------------------------------------------------------------------
// Sync hook for watcher.ts (backward compat)
// ---------------------------------------------------------------------------

/**
 * Sync hook — called by the file watcher on every content write.
 * @deprecated Will be replaced by per-plugin ctx.search.index() calls.
 */
export async function syncFile(relativePath: string, content: string): Promise<void> {
  if (!enabled()) return

  if (relativePath.startsWith('projects/') && relativePath.endsWith('.md')) {
    const id = relativePath.replace(/\//g, '-').replace('.md', '')
    await indexDocument(TABLES.projects, id, {
      content,
      source: relativePath,
      type: 'project',
      updated_at: new Date().toISOString(),
    })
    return
  }

  if (relativePath.startsWith('assets/') && relativePath.endsWith('.meta.json')) {
    try {
      const meta = JSON.parse(content)
      const assetPath = relativePath.replace('.meta.json', '')
      const pathParts = assetPath.split('/')
      const assetType = pathParts[1] || 'other'
      await indexDocument(TABLES.assets, assetPath, {
        content: [meta.description || '', (meta.tags || []).join(' '), pathParts[pathParts.length - 1]].join(' '),
        source: assetPath,
        type: assetType,
        agent: meta.agent || 'unknown',
        taskId: meta.taskId || null,
        tool: meta.tool || null,
        updated_at: new Date().toISOString(),
      })
    } catch {
      // Malformed sidecar — skip indexing
    }
    return
  }

  if (relativePath.startsWith('team/personas/') && relativePath.endsWith('.md')) {
    const id = `persona-${relativePath.replace('team/personas/', '').replace('.md', '')}`
    await indexDocument(TABLES.content, id, {
      content,
      source: relativePath,
      type: 'persona',
      updated_at: new Date().toISOString(),
    })
    return
  }
}

/**
 * Sync hook for file deletions — removes documents from Antfly.
 * @deprecated Will be replaced by per-plugin ctx.search.remove() calls.
 */
export async function syncFileUnlink(relativePath: string): Promise<void> {
  if (!enabled()) return

  if (relativePath.startsWith('projects/') && relativePath.endsWith('.md')) {
    const id = relativePath.replace(/\//g, '-').replace('.md', '')
    await removeDocument(TABLES.projects, id)
    return
  }

  if (relativePath.startsWith('assets/') && relativePath.endsWith('.meta.json')) {
    const assetPath = relativePath.replace('.meta.json', '')
    await removeDocument(TABLES.assets, assetPath)
    return
  }

  if (relativePath.startsWith('team/personas/') && relativePath.endsWith('.md')) {
    const id = `persona-${relativePath.replace('team/personas/', '').replace('.md', '')}`
    await removeDocument(TABLES.content, id)
    return
  }
}

/**
 * Index a completed task to Antfly for historical search.
 * @deprecated Will be replaced by tasks plugin using ctx.search.index().
 */
export async function indexCompletedTask(task: {
  id: string
  title: string
  agent?: string
  description?: string
  log?: Array<{ timestamp: string; author: string; message: string }>
}): Promise<void> {
  const logText = task.log?.map(l => `[${l.timestamp} ${l.author}] ${l.message}`).join('\n') || ''
  await indexDocument(TABLES.tasks, task.id, {
    title: task.title,
    content: `${task.title}\n\n${task.description || ''}\n\n${logText}`,
    agent: task.agent,
    source: 'flow_runs',
    updated_at: new Date().toISOString(),
  })
}

/**
 * Index an audit event.
 * @deprecated Will be replaced by audit module using ctx.search.index().
 */
export async function indexAuditEvent(entry: {
  ts: string
  event: string
  agent: string
  data: Record<string, unknown>
}): Promise<void> {
  await indexDocument(TABLES.audit, `audit-${entry.ts}-${entry.event}`, {
    content: `[${entry.ts}] ${entry.event} by ${entry.agent}: ${JSON.stringify(entry.data)}`,
    event: entry.event,
    agent: entry.agent,
    created_at: entry.ts,
    ...entry.data,
  })
}

// ---------------------------------------------------------------------------
// Bulk reindex (backward compat)
// ---------------------------------------------------------------------------

/**
 * Reindex all content from disk into Antfly.
 * @deprecated Will be replaced by per-plugin reindex() generators.
 */
export async function reindexAll(contentDir: string): Promise<number> {
  if (!enabled()) {
    log.info('Antfly disabled — skipping reindex')
    return 0
  }

  const { readdirSync, readFileSync, existsSync } = await import('fs')
  const { join } = await import('path')
  let count = 0

  const projectsDir = join(contentDir, 'projects')
  if (existsSync(projectsDir)) {
    for (const file of readdirSync(projectsDir).filter(f => f.endsWith('.md'))) {
      await syncFile(`projects/${file}`, readFileSync(join(projectsDir, file), 'utf-8'))
      count++
    }
  }

  const assetsDir = join(contentDir, 'assets')
  if (existsSync(assetsDir)) {
    const assetTypes = readdirSync(assetsDir).filter(d => !d.startsWith('.'))
    for (const assetType of assetTypes) {
      const typeDir = join(assetsDir, assetType)
      try {
        const taskDirs = readdirSync(typeDir)
        for (const taskDir of taskDirs) {
          const fullTaskDir = join(typeDir, taskDir)
          try {
            const files = readdirSync(fullTaskDir).filter(f => f.endsWith('.meta.json'))
            for (const file of files) {
              const content = readFileSync(join(fullTaskDir, file), 'utf-8')
              await syncFile(`assets/${assetType}/${taskDir}/${file}`, content)
              count++
            }
          } catch { /* not a directory or unreadable */ }
        }
      } catch { /* empty type dir */ }
    }
  }

  const personasDir = join(contentDir, 'team', 'personas')
  if (existsSync(personasDir)) {
    for (const file of readdirSync(personasDir).filter(f => f.endsWith('.md'))) {
      await syncFile(`team/personas/${file}`, readFileSync(join(personasDir, file), 'utf-8'))
      count++
    }
  }

  log.info('Reindex complete', { indexed: count })
  return count
}
