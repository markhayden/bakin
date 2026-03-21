/**
 * Antfly core module for Beacon.
 * Optional vector database integration — Beacon works without it.
 * When enabled, provides dual-write sync and hybrid search across all content.
 */
import { createLogger } from './logger'
import { getSettings } from './settings'

const log = createLogger('antfly')

let client: any = null
let isInitialized = false

// Table names for Beacon content
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

  try {
    const { AntflyClient } = await import('@antfly/sdk')
    client = new AntflyClient({
      baseUrl: settings.antfly.url,
      auth: settings.antfly.auth,
    })

    // Verify connection
    const status = await client.getStatus()
    log.info('Antfly connected', { url: settings.antfly.url, health: status?.health })

    // Ensure tables exist
    await ensureTables()
  } catch (err) {
    log.error('Failed to connect to Antfly — falling back to file-only mode', err)
    client = null
  }
}

async function ensureTables(): Promise<void> {
  const settings = getSettings()
  const baseUrl = settings.antfly.url

  // List existing tables
  let existingNames = new Set<string>()
  try {
    const res = await fetch(`${baseUrl}/tables`, { signal: AbortSignal.timeout(5000) })
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
      const res = await fetch(`${baseUrl}/tables/${tableName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          num_shards: 1,
          description: `Beacon ${key} — auto-created`,
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
            search: {
              name: 'search',
              type: 'full_text',
            },
            embeddings: {
              name: 'embeddings',
              type: 'embeddings',
              embedder: {
                provider: 'antfly',
                model: 'all-MiniLM-L6-v2',
              },
            },
          },
        }),
        signal: AbortSignal.timeout(10000),
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
  if (!client || !enabled()) return

  const tableName = TABLES[table as keyof typeof TABLES] || table

  try {
    await client.tables.batch(tableName, {
      inserts: {
        [doc.id]: {
          id: doc.id,
          content: doc.content,
          created_at: new Date().toISOString(),
          ...doc.metadata,
        },
      },
    })
  } catch (err) {
    log.warn('Antfly index failed (non-blocking)', err, { table: tableName, id: doc.id })
  }
}

/**
 * Delete a document from Antfly.
 */
export async function remove(table: string, id: string): Promise<void> {
  if (!client || !enabled()) return

  const tableName = TABLES[table as keyof typeof TABLES] || table
  try {
    await client.tables.batch(tableName, {
      deletes: [id],
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
  options: { table?: string; limit?: number } = {}
): Promise<SearchResult[]> {
  if (!client || !enabled()) {
    return []
  }

  const limit = options.limit || 10
  const tableName = options.table
    ? (TABLES[options.table as keyof typeof TABLES] || options.table)
    : undefined

  try {
    if (tableName) {
      return await searchTable(tableName, query, limit)
    }

    // Search all Beacon tables and merge results
    const allResults: SearchResult[] = []
    const perTable = Math.ceil(limit / Object.keys(TABLES).length)

    for (const [key, tName] of Object.entries(TABLES)) {
      try {
        const results = await searchTable(tName, query, perTable)
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

async function searchTable(tableName: string, query: string, limit: number): Promise<SearchResult[]> {
  if (!client) return []

  const result = await client.query({
    table: tableName,
    full_text_search: { query },
    semantic_search: query,
    indexes: ['embeddings'],
    limit,
  })

  if (!result?.hits?.hits) return []

  return result.hits.hits.map((hit) => ({
    id: hit._id || '',
    table: tableName,
    content: String((hit._source as Record<string, unknown>)?.content || ''),
    score: hit._score || 0,
    metadata: (hit._source as Record<string, unknown>) || {},
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
    // Task sync happens on completion, not on every write
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

  if (relativePath.startsWith('docs/') && relativePath.endsWith('.md')) {
    const id = relativePath.replace(/\//g, '-').replace('.md', '')
    await index('content', { id, content, metadata: { source: relativePath, type: 'doc' } })
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
 * Called by `beacon reindex` or the /api/reindex endpoint.
 */
export async function reindexAll(contentDir: string): Promise<number> {
  if (!enabled()) {
    log.info('Antfly disabled — skipping reindex')
    return 0
  }

  const { readdirSync, readFileSync, existsSync } = await import('fs')
  const { join } = await import('path')
  let count = 0

  // Index MEMORY-LOG.md
  const memoryLog = join(contentDir, 'MEMORY-LOG.md')
  if (existsSync(memoryLog)) {
    await syncFile('MEMORY-LOG.md', readFileSync(memoryLog, 'utf-8'))
    count++
  }

  // Index project docs
  const projectsDir = join(contentDir, 'projects')
  if (existsSync(projectsDir)) {
    for (const file of readdirSync(projectsDir).filter(f => f.endsWith('.md'))) {
      const rel = `projects/${file}`
      await syncFile(rel, readFileSync(join(projectsDir, file), 'utf-8'))
      count++
    }
  }

  // Index docs
  const docsDir = join(contentDir, 'docs')
  if (existsSync(docsDir)) {
    for (const file of readdirSync(docsDir).filter(f => f.endsWith('.md'))) {
      const rel = `docs/${file}`
      await syncFile(rel, readFileSync(join(docsDir, file), 'utf-8'))
      count++
    }
  }

  // Index team personas
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
