/**
 * Antfly core module for Bakin.
 * Optional vector database integration — Bakin works without it.
 * When enabled, provides dual-write sync and hybrid search across all content.
 *
 * Uses direct HTTP calls to the Antfly REST API (no SDK dependency at runtime).
 */
import { createLogger } from './logger'
import { getSettings } from './settings'

const log = createLogger('antfly')

let baseUrl: string | null = null
let isInitialized = false

// Table names for Bakin content (keeping beacon_ prefix for backward compat with existing indexes)
export const TABLES = {
  tasks: 'beacon_tasks',
  decisions: 'beacon_decisions',
  audit: 'beacon_audit',
  content: 'beacon_content',
  assets: 'beacon_assets',
} as const

export interface SearchResult {
  id: string
  table: string
  content: string
  score: number
  metadata: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function antflyFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    signal: init?.signal || AbortSignal.timeout(10000),
  })
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function enabled(): boolean {
  return getSettings().antfly.enabled
}

export async function initialize(): Promise<void> {
  if (isInitialized) return
  isInitialized = true

  const settings = getSettings()
  if (!settings.antfly.enabled) {
    log.info('Antfly disabled — running in file-only mode')
    return
  }

  baseUrl = settings.antfly.url

  try {
    // Verify connection
    const statusUrl = baseUrl.replace(/\/api\/v1\/?$/, '') + '/api/v1/status'
    const res = await fetch(statusUrl, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(`Status check returned ${res.status}`)
    const status = await res.json()
    log.info('Antfly connected', { url: baseUrl, health: status?.health })

    // Ensure tables exist
    await ensureTables()
  } catch (err) {
    log.error('Failed to connect to Antfly — falling back to file-only mode', err)
    baseUrl = null
  }
}

async function ensureTables(): Promise<void> {
  if (!baseUrl) return

  // List existing tables
  let existingNames = new Set<string>()
  try {
    const res = await antflyFetch('/tables')
    if (res.ok) {
      const tables = await res.json()
      existingNames = new Set((tables || []).map((t: { name: string }) => t.name))
    }
  } catch {
    log.warn('Could not list tables — will attempt creation')
  }

  for (const [key, tableName] of Object.entries(TABLES)) {
    if (existingNames.has(tableName)) continue

    try {
      const res = await antflyFetch(`/tables/${tableName}`, {
        method: 'POST',
        body: JSON.stringify({
          num_shards: 1,
          description: `Bakin ${key} — auto-created`,
          schema: {
            default_type: key,
            document_schemas: {
              [key]: {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', 'x-antfly-types': ['keyword'] },
                    content: { type: 'string', 'x-antfly-types': ['text'] },
                    source: { type: 'string', 'x-antfly-types': ['keyword'] },
                    agent: { type: 'string', 'x-antfly-types': ['keyword'] },
                    created_at: { type: 'string', 'x-antfly-types': ['keyword'] },
                  },
                  'x-antfly-include-in-all': ['content'],
                },
              },
            },
          },
          indexes: {
            search: { name: 'search', type: 'full_text' },
            embeddings: {
              name: 'embeddings',
              type: 'embeddings',
              field: 'content',
              embedder: { provider: 'antfly', model: 'all-MiniLM-L6-v2' },
            },
          },
        }),
      })
      if (res.ok) {
        log.info(`Table created: ${tableName}`)
      } else {
        const body = await res.text()
        log.warn(`Failed to create table ${tableName}: ${res.status} ${body}`)
      }
    } catch (err) {
      log.warn(`Failed to create table ${tableName}`, err)
    }
  }

  // Wait for shards to finish initializing before allowing writes
  await new Promise(r => setTimeout(r, 3000))
  log.info('Tables ready')
}

// ---------------------------------------------------------------------------
// Index (write) — uses batch API
// ---------------------------------------------------------------------------

/**
 * Index a document to Antfly. Fire-and-forget — never blocks the caller.
 */
export async function index(
  table: string,
  doc: { id: string; content: string; metadata?: Record<string, unknown> }
): Promise<void> {
  if (!baseUrl || !enabled()) return

  const tableName = TABLES[table as keyof typeof TABLES] || table

  try {
    await antflyFetch(`/tables/${tableName}/batch`, {
      method: 'POST',
      body: JSON.stringify({
        inserts: {
          [doc.id]: {
            id: doc.id,
            content: doc.content,
            created_at: new Date().toISOString(),
            ...doc.metadata,
          },
        },
      }),
    })
  } catch (err) {
    log.warn('Antfly index failed (non-blocking)', err, { table: tableName, id: doc.id })
  }
}

/**
 * Delete a document from Antfly.
 */
export async function remove(table: string, id: string): Promise<void> {
  if (!baseUrl || !enabled()) return

  const tableName = TABLES[table as keyof typeof TABLES] || table
  try {
    await antflyFetch(`/tables/${tableName}/batch`, {
      method: 'POST',
      body: JSON.stringify({ deletes: [id] }),
    })
  } catch (err) {
    log.warn('Antfly delete failed', err, { table: tableName, id })
  }
}

// ---------------------------------------------------------------------------
// Search (read)
// ---------------------------------------------------------------------------

/**
 * Hybrid search across Antfly tables.
 * Falls back to empty results when Antfly is disabled.
 */
export async function search(
  query: string,
  options: { table?: string; limit?: number; agent?: string } = {}
): Promise<SearchResult[]> {
  if (!baseUrl || !enabled()) return []

  const limit = options.limit || 10
  const tableName = options.table
    ? (TABLES[options.table as keyof typeof TABLES] || options.table)
    : undefined

  try {
    if (tableName) {
      return await searchTable(tableName, query, limit, options.agent)
    }

    // Search all Bakin tables and merge results
    const allResults: SearchResult[] = []
    const perTable = Math.ceil(limit / Object.keys(TABLES).length)

    for (const [key, tName] of Object.entries(TABLES)) {
      try {
        const results = await searchTable(tName, query, perTable, options.agent)
        allResults.push(...results.map(r => ({ ...r, table: key })))
      } catch {
        // Skip tables that don't exist yet
      }
    }

    return allResults
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  } catch (err) {
    log.error('Antfly search failed', err)
    return []
  }
}

async function searchTable(tableName: string, query: string, limit: number, agent?: string): Promise<SearchResult[]> {
  if (!baseUrl) return []

  const body: Record<string, unknown> = {
    full_text_search: { query },
    semantic_search: query,
    indexes: ['embeddings'],
    limit,
  }
  if (agent) {
    body.filter = { agent: { eq: agent } }
  }

  const res = await antflyFetch(`/tables/${tableName}/query`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

  if (!res.ok) return []

  const result = await res.json()
  // Antfly wraps query results in a responses[] array
  const response = result?.responses?.[0] || result
  if (!response?.hits?.hits) return []

  return response.hits.hits.map((hit: any) => ({
    id: hit._id || '',
    table: tableName,
    content: String(hit._source?.content || ''),
    score: hit._score || 0,
    metadata: hit._source || {},
  }))
}

// ---------------------------------------------------------------------------
// Sync hook for watcher.ts
// ---------------------------------------------------------------------------

/**
 * Sync hook — called by the file watcher on every content write.
 * Determines which table to index to based on the file path.
 */
export async function syncFile(relativePath: string, content: string): Promise<void> {
  if (!enabled()) return

  if (relativePath === 'TASKBOARD.md') {
    return
  }

  if (relativePath === 'MEMORY-LOG.md') {
    await index('decisions', {
      id: `decisions-${Date.now()}`,
      content,
      metadata: { source: relativePath },
    })
    return
  }

  if (relativePath.startsWith('projects/') && relativePath.endsWith('.md')) {
    const id = relativePath.replace(/\//g, '-').replace('.md', '')
    await index('content', { id, content, metadata: { source: relativePath, type: 'project' } })
    return
  }

  if (relativePath.startsWith('assets/') && !relativePath.endsWith('.meta.json')) {
    // Index asset sidecar metadata to beacon_assets table
    const metaPath = relativePath + '.meta.json' // will be handled when .meta.json is written
    return
  }

  if (relativePath.startsWith('assets/') && relativePath.endsWith('.meta.json')) {
    // Sidecar metadata file — index to beacon_assets
    try {
      const meta = JSON.parse(content)
      const assetPath = relativePath.replace('.meta.json', '')
      const pathParts = assetPath.split('/')
      const assetType = pathParts[1] || 'other'
      await index('assets', {
        id: assetPath,
        content: [meta.description || '', (meta.tags || []).join(' '), pathParts[pathParts.length - 1]].join(' '),
        metadata: {
          source: assetPath,
          type: assetType,
          agent: meta.agent || 'unknown',
          taskId: meta.taskId || null,
          tool: meta.tool || null,
        },
      })
    } catch {
      // Malformed sidecar — skip indexing
    }
    return
  }

  if (relativePath.startsWith('team/personas/') && relativePath.endsWith('.md')) {
    const id = `persona-${relativePath.replace('team/personas/', '').replace('.md', '')}`
    await index('content', { id, content, metadata: { source: relativePath, type: 'persona' } })
    return
  }
}

/**
 * Index a completed task to Antfly for historical search.
 */
export async function indexCompletedTask(task: {
  id: string
  title: string
  agent?: string
  description?: string
  log?: Array<{ timestamp: string; author: string; message: string }>
}): Promise<void> {
  const logText = task.log?.map(l => `[${l.timestamp} ${l.author}] ${l.message}`).join('\n') || ''
  await index('tasks', {
    id: task.id,
    content: `${task.title}\n\n${task.description || ''}\n\n${logText}`,
    metadata: { source: 'TASKBOARD.md', agent: task.agent, title: task.title },
  })
}

/**
 * Index an audit event.
 */
export async function indexAuditEvent(entry: {
  ts: string
  event: string
  agent: string
  data: Record<string, unknown>
}): Promise<void> {
  await index('audit', {
    id: `audit-${entry.ts}-${entry.event}`,
    content: `[${entry.ts}] ${entry.event} by ${entry.agent}: ${JSON.stringify(entry.data)}`,
    metadata: { event: entry.event, agent: entry.agent, ...entry.data },
  })
}

// ---------------------------------------------------------------------------
// Bulk reindex
// ---------------------------------------------------------------------------

/**
 * Reindex all content from disk into Antfly.
 * Called by `bakin reindex` or the /api/reindex endpoint.
 */
export async function reindexAll(contentDir: string): Promise<number> {
  if (!enabled()) {
    log.info('Antfly disabled — skipping reindex')
    return 0
  }

  const { readdirSync, readFileSync, existsSync } = await import('fs')
  const { join } = await import('path')
  let count = 0

  const memoryLog = join(contentDir, 'MEMORY-LOG.md')
  if (existsSync(memoryLog)) {
    await syncFile('MEMORY-LOG.md', readFileSync(memoryLog, 'utf-8'))
    count++
  }

  const projectsDir = join(contentDir, 'projects')
  if (existsSync(projectsDir)) {
    for (const file of readdirSync(projectsDir).filter(f => f.endsWith('.md'))) {
      await syncFile(`projects/${file}`, readFileSync(join(projectsDir, file), 'utf-8'))
      count++
    }
  }

  // Reindex asset sidecar metadata
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
      const id = `persona-${file.replace('.md', '')}`
      const content = readFileSync(join(personasDir, file), 'utf-8')
      await index('content', { id, content, metadata: { source: `team/personas/${file}`, type: 'persona' } })
      count++
    }
  }

  log.info('Reindex complete', { indexed: count })
  return count
}
