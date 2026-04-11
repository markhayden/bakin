# Spec: AntflyDB Search System — Full Integration

**Status:** DRAFT v3 — awaiting final review
**Issue:** madeinwyo/bakin#3
**Date:** 2026-04-10

---

## 1. Objective

Make AntflyDB the single source of truth for all search in Bakin. Every piece of structured content — tasks, assets, projects, workflows, schedule jobs, team/agent data — is indexed into AntflyDB with rich schemas. All UI search bars perform hybrid search (semantic + full-text) with client-side fallback. The health plugin provides full transparency into indexing state and search health. The plugin harness exposes a `ctx.search` API so any plugin (core or addon) can register indexable content.

### Out of Scope
- **Agent wiring** — connecting agents to use the MCP search tools is a follow-up. The tools themselves ship in this work.
- **Memory system integration** — MEMORY-LOG.md / audit memory viewer is separate.
- **RAG / retrieval agents** — Antfly's `retrievalAgent()` and `chatAgent()` APIs are future work.
- **Graph indexes / joins / multimodal** — advanced Antfly features deferred to future phases.

### Success Criteria
1. Every plugin search bar returns results from Antfly within 200ms (p95).
2. All content types are indexed with rich, type-specific schemas (not just a blob `content` field).
3. Deletion of any content immediately removes it from the index.
4. Health plugin shows: table document counts, index health, last reindex time, embedding status.
5. Client-side fallback is seamless — user can't tell if Antfly is down.
6. Zero data loss on Antfly restart (all content is re-derivable from source — filesystem or SQLite).
7. Any addon plugin can index its content via `ctx.search` without touching core Antfly code.
8. Periodic orphan cleanup prevents stale data from accumulating.

---

## 2. Current State Analysis

### What Exists
- **5 tables** with stale `beacon_` prefix: tasks, decisions, audit, content, assets
- **Generic schema** — every table has the same 5 fields (id, content, source, agent, created_at)
- **Hybrid search** — full-text + semantic via `all-MiniLM-L6-v2` embeddings
- **Fire-and-forget indexing** — non-blocking, errors silently swallowed
- **File watcher sync** — projects, personas, asset sidecars, MEMORY-LOG.md
- **Direct HTTP REST** — not using `@antfly/sdk` despite it being in package.json
- **Server management** — `antfly-server.ts` auto-starts/stops the binary
- **Doctor check** — basic binary/connection health check
- **Only completed tasks indexed** — via `indexCompletedTask()` in task-service.ts

### Storage Model (Critical Context)
- **Tasks** → SQLite (`~/.openclaw/flows/registry.sqlite`) via `flow-store.ts`. NOT markdown files. Cannot rely on file watcher for task indexing — must hook into task-service mutations.
- **Assets** → Filesystem (`~/.bakin/assets/`) with `.meta.json` sidecars. File watcher works.
- **Projects** → Filesystem (`~/.bakin/projects/*.md`). File watcher works.
- **Workflows** → Filesystem (`~/.bakin/workflows/`). File watcher works.
- **Schedule** → OpenClaw bridge (cron jobs via `openclaw cron list`). Not file-based.
- **Team/Agents** → OpenClaw home (`~/.openclaw/`). Loaded via OpenClaw adapter.

### What's Missing
- **No rich schemas** — everything flattened into `content` text blob
- **No workflow/schedule/team indexing** — only tasks, assets, content, audit, decisions
- **No active task indexing** — only completed tasks; backlog/todo/doing invisible to search
- **No deletion sync** — stale entries persist forever
- **No UI integration** — all search bars use client-side `.includes()`
- **No aggregations** — not using Antfly's faceted search
- **No health metrics** — no visibility into index state
- **No plugin harness for search** — addon plugins can't register indexable content
- **No orphan cleanup** — no way to detect/remove stale index entries
- **No TTL configuration** — audit entries grow unbounded
- **SDK not used** — raw `fetch()` instead of type-safe `@antfly/sdk`

---

## 3. Architecture

### 3.1 Plugin Search API (`ctx.search`)

**This is the core architectural addition.** Every plugin — core and addon — indexes its content through the PluginContext, not by importing `antfly.ts` directly.

Add to `PluginContext`:

```typescript
export interface SearchAPI {
  /**
   * Register a content type this plugin will index.
   * Must be called during activate(). Creates the Antfly table if it doesn't exist.
   */
  registerContentType(def: SearchContentTypeDefinition): void

  /**
   * Index or update a document. Fire-and-forget.
   */
  index(key: string, doc: Record<string, unknown>): Promise<void>

  /**
   * Remove a document from the index.
   */
  remove(key: string): Promise<void>

  /**
   * Search this plugin's content type.
   */
  query(params: SearchQueryParams): Promise<SearchResponse>
}

export interface SearchContentTypeDefinition {
  /** Table name — auto-prefixed with `bakin_`. E.g., 'tasks' → 'bakin_tasks' */
  table: string
  /** JSON Schema for the document fields */
  schema: Record<string, SchemaField>
  /** Fields to include in full-text search */
  searchableFields: string[]
  /** Handlebars template for embedding generation */
  embeddingTemplate: string
  /** Optional: fields to expose as aggregatable facets */
  facets?: string[]
  /** Optional: TTL duration (Go format: '24h', '7d', '30d') */
  ttl?: string
  /** Optional: TTL field (defaults to 'created_at') */
  ttlField?: string
  /** Optional: chunking config for long documents */
  chunker?: {
    enabled: boolean          // default: false
    targetTokens?: number     // default: from settings (200)
    overlapTokens?: number    // default: from settings (25)
  }
  /**
   * Required: backfill function. Called during full/per-table reindex.
   * Must yield ALL documents for this content type from its source (SQLite, filesystem, OpenClaw).
   * This is what makes embedding model changes and fresh rebuilds possible.
   */
  reindex: () => AsyncGenerator<{ key: string; doc: Record<string, unknown> }>
  /**
   * Required: existence check. Called during orphan cleanup.
   * Returns true if the source document for this key still exists.
   */
  verifyExists: (key: string) => Promise<boolean>
}

export interface SchemaField {
  type: 'text' | 'keyword' | 'number' | 'boolean' | 'datetime' | 'array'
}
```

**Usage in a plugin's `activate()`:**

```typescript
activate(ctx: PluginContext) {
  ctx.search.registerContentType({
    table: 'tasks',
    schema: {
      title:       { type: 'text' },
      description: { type: 'text' },
      status:      { type: 'keyword' },
      agent:       { type: 'keyword' },
      priority:    { type: 'keyword' },
      project:     { type: 'keyword' },
      tags:        { type: 'array' },
      created_at:  { type: 'datetime' },
      updated_at:  { type: 'datetime' },
    },
    searchableFields: ['title', 'description'],
    embeddingTemplate: '{{title}} {{description}}',
    facets: ['status', 'agent', 'priority'],
  })

  // Later, on mutation:
  ctx.search.index(`task:${taskId}`, { title, description, status, agent, ... })
  ctx.search.remove(`task:${taskId}`)
}
```

**How it works internally:**
- `registerContentType()` stores the definition in a central registry and creates the Antfly table (with schema + indexes) if it doesn't exist.
- `index()` delegates to `antfly.indexDocument()` with the plugin's registered table.
- `remove()` delegates to `antfly.removeDocument()`.
- `query()` delegates to `antfly.search()` scoped to the plugin's table.
- If Antfly is disabled, all operations are no-ops / return empty results.
- The cross-table `/api/search` endpoint queries across ALL registered content types.

**Addon plugin example:**
```typescript
// ~/.bakin/plugins/my-addon/index.ts
export default {
  id: 'my-addon',
  name: 'My Custom Plugin',
  version: '1.0.0',
  activate(ctx) {
    ctx.search.registerContentType({
      table: 'my_addon_items',  // → bakin_my_addon_items
      schema: { title: { type: 'text' }, category: { type: 'keyword' } },
      searchableFields: ['title'],
      embeddingTemplate: '{{title}}',
    })
    // Now this addon's content is searchable via /api/search cross-table
  }
}
```

### 3.2 Table Design

7 tables for core plugins, all with `bakin_` prefix. Addon plugins create additional tables via `ctx.search.registerContentType()`.

| Table | Source | Key Format | Storage Type |
|-------|--------|------------|-------------|
| `bakin_tasks` | SQLite (flow_runs) | `task:{taskId}` | Database |
| `bakin_assets` | .meta.json sidecars | `asset:{type}/{taskId}/{filename}` | Filesystem |
| `bakin_projects` | Project .md files | `project:{slug}` | Filesystem |
| `bakin_workflows` | Workflow JSON files | `wf:{id}` / `wf-run:{id}` | Filesystem |
| `bakin_schedule` | OpenClaw cron bridge | `schedule:{jobId}` | OpenClaw |
| `bakin_team` | OpenClaw agent configs | `agent:{agentId}` | OpenClaw |
| `bakin_audit` | audit.jsonl | `audit:{ts}-{event}` | Filesystem |

**No migration from `beacon_`** — wipe existing tables on first startup with new code. Single-user system, full reindex rebuilds everything.

### 3.3 Schema Design

Each table gets purpose-built fields. Keyword fields enable exact filtering + aggregations. Text fields enable full-text search. Handlebars templates control what gets embedded.

**Common pattern per table:**
```typescript
{
  num_shards: 1,
  schema: {
    default_type: tableType,
    document_schemas: {
      [tableType]: {
        schema: {
          type: 'object',
          properties: { /* per-table fields */ },
          'x-antfly-include-in-all': searchableFields,
        }
      }
    }
  },
  indexes: {
    search: { name: 'search', type: 'full_text' },
    embeddings: {
      name: 'embeddings',
      type: 'embeddings',
      template: embeddingTemplate,
      embedder: { provider: 'antfly', model: 'all-MiniLM-L6-v2' }
    }
  }
}
```

### 3.4 SDK Migration

Replace all raw `fetch()` calls in `antfly.ts` with the `@antfly/sdk` `AntflyClient` (v0.0.14):

```typescript
import { AntflyClient } from '@antfly/sdk'

const client = new AntflyClient({
  baseUrl: settings.antfly.url,
  auth: settings.antfly.auth ? { type: 'basic', ...settings.antfly.auth } : undefined,
})
```

Benefits: type safety, auto-generated types, built-in error handling, query builders.

### 3.5 Indexing Pipeline

**For filesystem-backed content (assets, projects, workflows):**
```
File Write / Change (watcher event or API mutation)
  → Plugin hook or direct ctx.search.index()
  → antfly.indexDocument(table, key, structuredDoc)
  → POST /tables/{table}/batch { inserts: { [key]: doc } }

File Unlink (watcher event or API delete)
  → Plugin hook or direct ctx.search.remove()
  → antfly.removeDocument(table, key)
  → POST /tables/{table}/batch { deletes: [key] }
```

**For SQLite-backed content (tasks):**
```
Task Mutation (create/update/move/delete via task-service.ts)
  → ctx.search.index() or ctx.search.remove() called in task-service
  → Same Antfly write path as above
```

**For OpenClaw-backed content (schedule, team):**
```
Data Fetched from OpenClaw (API route handler or doctor sync)
  → ctx.search.index() with fresh data
  → Periodic sync on doctor cadence ensures freshness
```

**Critical:** The file watcher must handle `unlink` events in addition to `add`/`change`.

### 3.6 Hybrid Search & Tuning

Antfly's default hybrid search uses **Reciprocal Rank Fusion (RRF)** to combine BM25 full-text scores with semantic similarity scores. This is the default and a good starting point.

**Tuning knobs to expose (in settings, not hardcoded):**

```typescript
antfly: {
  enabled: boolean
  url: string
  auth?: { username: string; password: string }
  // NEW tuning options
  search: {
    /** Weight for semantic vs. full-text results. Default: RRF (auto). */
    strategy: 'rrf' | 'semantic_only' | 'full_text_only'
    /** Default result limit per query. Default: 20. */
    defaultLimit: number
    /** Reranker config. Default: none (use RRF). */
    reranker?: { provider: string; model: string; threshold?: number }
  }
  /** TTL for audit table entries. Default: '90d'. Set '' to disable. */
  auditTtl: string
  /** Orphan cleanup interval. Default: '24h'. */
  cleanupInterval: string
}
```

This means we can tune search behavior without code changes — just update `settings.json`. The reranker option is there for when we want it (Antfly 0.1.1 added auto-reranking) but defaults to off.

---

## 4. Plugin Indexing — What Gets Indexed and When

### 4.1 Tasks Plugin (SQLite Source)

**When indexed:**
- Task created → index
- Task updated (title, description, agent, priority change) → re-index
- Task moved between columns (status change) → re-index
- Task progress logged → re-index (log content becomes searchable)
- Task deleted → remove from index
- Task archived → re-index (status=archived, still searchable)

**Source:** `flow-store.ts` reads from `~/.openclaw/flows/registry.sqlite`. Task mutations flow through `task-service.ts` which already has side-effect hooks (audit, SSE broadcast, existing Antfly call). We add `ctx.search.index()` alongside these.

**Fields:**
```typescript
{
  title: task.title,
  description: task.description || '',
  status: task.column,        // backlog, todo, inProgress, review, blocked, done, archived
  priority: task.priority || '',
  agent: task.agent || '',
  column: task.column,
  project: task.projectId || '',
  tags: task.tags || [],
  log_text: task.log?.map(l => l.message).join(' ') || '',  // Searchable log content
  created_at: task.createdAt,
  updated_at: task.updatedAt || task.createdAt,
}
```

**Embedding template:** `{{title}} {{description}} {{log_text}}`
**Facets:** `status`, `agent`, `priority`, `project`

### 4.2 Assets Plugin (Filesystem Source)

**When indexed:**
- Asset sidecar `.meta.json` written → index
- Sidecar updated → re-index
- Asset trashed → remove from index
- Asset restored from trash → re-index
- Asset permanently deleted → remove from index

**Fields:**
```typescript
{
  filename: meta.filename,
  description: meta.description || '',
  type: assetType,             // images, video, audio, text, plans, data
  agent: meta.agent || '',
  taskId: meta.taskId || '',
  tool: meta.tool || '',
  tags: meta.tags || [],
  size: meta.size || 0,
  created_at: meta.createdAt,
}
```

**Embedding template:** `{{filename}} {{description}} {{tags}}`
**Facets:** `type`, `agent`, `tool`

### 4.3 Projects Plugin (Filesystem Source)

**When indexed:**
- Project .md created → index
- Project updated → re-index
- Project deleted → remove from index

**Fields:**
```typescript
{
  title: project.title,
  description: project.description || '',
  status: project.status,     // draft, active, completed, archived
  body: project.body || '',   // Full markdown body for deep search
  checklist_total: project.checklistTotal || 0,
  checklist_done: project.checklistDone || 0,
  created_at: project.createdAt,
  updated_at: project.updatedAt,
}
```

**Embedding template:** `{{title}} {{description}}`
**Facets:** `status`

### 4.4 Workflows Plugin (Filesystem Source)

**When indexed:**
- Template saved → index
- Instance started → index
- Instance step completed → re-index
- Instance completed/failed → re-index

**Fields (template):**
```typescript
{
  name: template.name,
  description: template.description || '',
  doc_type: 'template',
  steps_total: template.steps?.length || 0,
  created_at: template.createdAt,
}
```

**Fields (instance/run):**
```typescript
{
  name: instance.name,
  description: '',
  doc_type: 'instance',
  status: instance.status,     // running, completed, failed, paused
  steps_total: instance.totalSteps,
  steps_done: instance.completedSteps,
  agent: instance.agent || '',
  created_at: instance.startedAt,
}
```

**Embedding template:** `{{name}} {{description}}`
**Facets:** `doc_type`, `status`

### 4.5 Schedule Plugin (OpenClaw Source)

**When indexed:**
- Job list fetched from OpenClaw → index all jobs
- Job created/updated via Bakin UI → re-index
- Job deleted → remove from index
- Doctor periodic sync → re-index all (catches external changes)

**Fields:**
```typescript
{
  displayName: job.displayName,
  agentId: job.agentId,
  cron: job.cron,
  humanSchedule: job.humanSchedule || '',
  enabled: job.enabled,
  prompt: job.prompt || '',
  lastRun: job.lastRun || '',
  nextRun: job.nextRun || '',
  created_at: job.createdAt || '',
}
```

**Embedding template:** `{{displayName}} {{prompt}}`
**Facets:** `agentId`, `enabled`

### 4.6 Team Plugin (OpenClaw Source)

**When indexed:**
- Agent list loaded from OpenClaw → index all agents
- Heartbeat received → re-index (updates status)
- Agent config changed → re-index
- Agent removed → remove from index

**Fields:**
```typescript
{
  name: agent.name,
  role: agent.role || '',
  status: agent.status || 'offline',
  model: agent.model || '',
  skills: agent.skills || [],
  tools_count: agent.tools?.length || 0,
  last_heartbeat: agent.lastHeartbeat || '',
}
```

**Embedding template:** `{{name}} {{role}}`
**Facets:** `status`, `model`

### 4.7 Audit (High-Volume, TTL-Managed)

**When indexed:** On every `appendAudit()` call (fire-and-forget, same as today).

**Fields:**
```typescript
{
  event: entry.event,
  agent: entry.agent,
  channel: entry.channel,
  content: `${entry.event} by ${entry.agent}: ${JSON.stringify(entry.data)}`,
  created_at: entry.ts,
}
```

**Embedding template:** `{{content}}`
**Facets:** `event`, `agent`, `channel`
**TTL:** Configurable via `settings.antfly.auditTtl` (default: `'90d'`). Antfly auto-cleans expired entries every 30s.

---

## 5. Search API

### 5.1 Cross-Table Search Endpoint

```
GET /api/search?q={query}&table={table}&limit={n}&filters={json}
```

This is the foundation for future agentic search. Searches across ALL registered content types (core + addon plugins) when no `table` is specified.

**Response shape:**
```typescript
{
  results: Array<{
    id: string
    table: string       // 'tasks' | 'assets' | 'projects' | 'my_addon_items' | ...
    score: number
    fields: Record<string, unknown>
  }>
  aggregations?: Record<string, Array<{ value: string; count: number }>>
  meta: {
    query: string
    total: number
    took_ms: number
    source: 'antfly' | 'fallback'
    tables_searched: string[]
  }
}
```

When searching cross-table:
- Distribute limit across all tables proportionally
- Merge results by score
- Return `tables_searched` so caller knows scope

### 5.2 Per-Plugin Search Routes

Each plugin registers a scoped search route via `ctx.registerRoute()`:

```
GET /api/plugins/{pluginId}/search?q={query}&limit={n}&{plugin-specific-filters}
```

Each route:
1. Calls `ctx.search.query()` with structured filters
2. Falls back to existing client-side filtering if Antfly is disabled
3. Returns results in the shape the plugin's UI expects
4. Includes aggregations for facet counts

### 5.3 Aggregation Support

Plugins that register `facets` in their content type definition get server-side aggregation counts. These power `FacetFilter` counts in the UI.

```typescript
// Antfly query with aggregations
{
  semantic_search: query,
  full_text_search: { query },
  aggregations: {
    status: { type: 'terms', field: 'status', size: 10 },
    agent:  { type: 'terms', field: 'agent', size: 20 },
  }
}

// Response
{
  aggregations: {
    status: { buckets: [{ key: 'doing', doc_count: 12 }, ...] },
    agent:  { buckets: [{ key: 'pixel', doc_count: 8 }, ...] },
  }
}
```

---

## 6. UI Integration

### 6.1 Shared Search Hook

`src/hooks/use-antfly-search.ts`:

```typescript
export function useAntflySearch<T>(
  endpoint: string,
  params: Record<string, string | undefined>,
  options?: {
    debounceMs?: number           // default: 250
    fallbackData?: T[]
    fallbackFilter?: (item: T, query: string) => boolean
    enabled?: boolean             // default: true
  }
): {
  results: T[]
  isLoading: boolean
  isAntfly: boolean               // true = Antfly results, false = fallback
  aggregations?: Record<string, Array<{ value: string; count: number }>>
  meta?: { took_ms: number; total: number }
}
```

**Behavior:**
1. On query change, immediately apply client-side fallback filter (optimistic, feels instant).
2. After debounce (250ms), fire request to search endpoint.
3. When response arrives, replace results with Antfly results.
4. If request fails, keep client-side results (user never sees error).
5. `isAntfly` flag for debugging/health awareness.

### 6.2 Plugin-by-Plugin UI Wiring

Each plugin replaces its `useMemo(() => data.filter(...))` with `useAntflySearch()`:

```typescript
// Before
const filtered = useMemo(() =>
  allTasks.filter(t => t.title.includes(search)), [allTasks, search])

// After
const { results, aggregations } = useAntflySearch<Task>(
  '/api/plugins/tasks/search',
  { q: search, status: statusFilter, agent: agentFilter },
  { fallbackData: allTasks, fallbackFilter: (t, q) => t.title.includes(q) }
)
```

Wire `FacetFilter` counts from `aggregations` when available.
All existing URL state (`?q=`, `?status=`, etc.) stays — these become search params.

**Plugins to update:**
- Tasks — `plugins/tasks/components/task-filters.tsx` / `kanban-board.tsx`
- Assets — `plugins/assets/components/assets-page.tsx`
- Projects — `plugins/projects/components/project-grid.tsx`
- Workflows — `plugins/workflows/components/workflows-page.tsx`
- Schedule — `plugins/schedule/components/schedule-page.tsx`
- Memory (audit) — `plugins/memory/components/audit-timeline.tsx`
- Memory (log) — `plugins/memory/components/memory-log.tsx`
- Team — `plugins/team/components/team-grid.tsx` (if search exists)

### 6.3 Result Inclusion Policy

Everything that appears in the UI is returned in search results. Disabled schedule jobs, archived projects, completed tasks — all included by default. Structured keyword fields enable filtering them out when desired, but the default is inclusive.

---

## 7. Setup, Lifecycle & Configuration

### 7.1 Initial Setup Flow

`bakin setup antfly` or `bakin init`:

1. **Check for existing instance** — hit configured URL health endpoint.
   - If running: use it. Print "Using existing Antfly at {url}".
   - If not running: continue.
2. **Check for binary** — `ANTFLY_PATH` → homebrew → `/usr/local/bin` → `~/.antfly/bin`.
   - If not found: prompt to install (`brew install --cask antflydb/antfly/antfly`).
3. **Start server** — `antfly swarm` with `ANTFLY_DATA_DIR=~/.antfly/data`.
4. **Wipe any old `beacon_*` tables** — clean slate.
5. **Create `bakin_*` tables** — from registered content type definitions.
6. **Full reindex** — index all existing content.
7. **Verify** — run test search, confirm results.
8. **Enable in settings** — `antfly.enabled = true`.

### 7.2 External Antfly Instances

If user runs their own Antfly (another project, shared server):
- **Table namespacing** — `bakin_` prefix prevents collisions.
- **No server spawn** — if already running, Bakin connects as client only.
- **Auth support** — configurable username/password in settings.

### 7.3 Startup Sequence

```
1. Load settings
2. If antfly.enabled:
   a. antflyServer.start()           — spawn or detect external
   b. antfly.initialize(client)      — create SDK client
   c. During plugin activation, each plugin calls ctx.search.registerContentType()
      → tables created/verified
   d. watcher.registerSyncHook()     — file change → index
   e. watcher.registerUnlinkHook()   — file delete → remove  ← NEW
   f. Start orphan cleanup timer
3. Continue with Next.js
```

### 7.4 Graceful Degradation

Antfly is always optional. Every code path:
- Checks `enabled()` first
- Wraps in try/catch, logs warning, returns fallback
- Never blocks user actions on Antfly writes (fire-and-forget)
- Never crashes on failure — source of truth is filesystem/SQLite

### 7.5 Reindex

- **Full reindex** — `POST /api/reindex` or `bakin reindex`. Iterates all registered content types, reads from source, indexes to Antfly.
- **Per-table reindex** — `POST /api/reindex?table=tasks`. Useful for targeted rebuilds.
- **Incremental sync** — file watcher for filesystem content, mutation hooks for SQLite/OpenClaw.
- **Orphan cleanup** — runs on configurable interval (default: 24h). Scans Antfly documents, verifies source exists, removes orphans.

### 7.6 Settings Addition

```typescript
antfly: {
  enabled: boolean           // default: false
  url: string                // default: 'http://localhost:8080'
  auth?: { username: string; password: string }
  search: {
    strategy: 'rrf' | 'semantic_only' | 'full_text_only'  // default: 'rrf'
    defaultLimit: number                                    // default: 20
    reranker?: { provider: string; model: string; threshold?: number }
  }
  embedder: {
    provider: string         // default: 'antfly' (built-in Termite)
    model: string            // default: 'all-MiniLM-L6-v2'
  }
  chunking: {
    defaultTargetTokens: number   // default: 200
    defaultOverlapTokens: number  // default: 25
  }
  auditTtl: string           // default: '90d', '' to disable
  cleanupInterval: string    // default: '24h'
}
```

**Embedder change workflow:** When `embedder.provider` or `embedder.model` changes:
1. On next startup, detect mismatch vs. existing table index config
2. Drop and recreate embeddings indexes on all tables with new config
3. Trigger full reindex (re-embeds all documents with new model)
4. CLI: `bakin reindex --rebuild` does this manually

---

## 8. Health & Observability

### 8.1 Health Plugin — Search Section

Add a "Search" section to the health plugin:

**Status Card:**
- Connection status (connected / disconnected / disabled)
- Server mode (managed / external)
- Antfly version
- Embedding model in use

**Table Overview:**
| Table | Documents | Index Health | Last Indexed | Embeddings |
|-------|-----------|-------------|--------------|------------|
| bakin_tasks | 247 | healthy | 2 min ago | 247/247 |
| bakin_assets | 1,204 | healthy | 30s ago | 1,204/1,204 |
| ... | ... | ... | ... | ... |

Includes addon plugin tables — any table registered via `ctx.search.registerContentType()` appears here.

**Metrics:**
- Total documents across all tables
- Avg query latency (rolling, tracked from search responses)
- Last full reindex: timestamp, duration, document count
- Last orphan cleanup: timestamp, removed count
- Audit TTL status

**Actions:**
- "Reindex All" button
- "Reindex Table" per-row
- "Run Cleanup" — trigger orphan cleanup
- "Clear Table" per-row (with confirmation dialog)

### 8.2 Doctor Checks (Enhanced)

Expand `checkAntfly()` in `doctor.ts`:

1. **Binary installed?**
2. **Connection healthy?**
3. **All expected `bakin_*` tables exist?**
4. **Tables have correct indexes (full_text + embeddings)?**
5. **Any tables empty when source content exists?** (stale data warning)
6. **Orphan count** — sample check for stale entries

### 8.3 Health API

```
GET /api/antfly/health
```

```typescript
{
  status: 'connected' | 'disconnected' | 'disabled'
  mode: 'managed' | 'external'
  version: string
  tables: Array<{
    name: string
    documentCount: number
    indexHealth: 'healthy' | 'degraded' | 'error'
    lastIndexed: string
    embeddingsComplete: boolean
    source: string              // plugin ID that registered it
  }>
  metrics: {
    totalDocuments: number
    avgQueryLatencyMs: number
    lastReindexAt: string
    lastReindexDuration: number
    lastReindexCount: number
    lastCleanupAt: string
    lastCleanupRemoved: number
  }
}
```

---

## 9. Deletion & Cleanup

### 9.1 Real-Time Deletion

- **Filesystem content** — watcher `unlink` event → `ctx.search.remove()`
- **SQLite content (tasks)** — task-service delete handler → `ctx.search.remove()`
- **OpenClaw content** — periodic sync detects removed items → `ctx.search.remove()`
- **API delete routes** — call `ctx.search.remove()` as side effect

### 9.2 Periodic Orphan Cleanup

Runs on configurable interval (default: 24h):

1. For each registered content type:
   a. Scan all documents in Antfly table (via `client.tables.scanAll()`)
   b. For each document, ask the owning plugin to verify it still exists
   c. Delete orphaned entries
   d. Log: "Cleanup: removed {n} orphans from {table}"
2. Track last cleanup time + removed count in metrics

Plugins implement a `verifyExists(key: string): Promise<boolean>` callback when registering content types:

```typescript
ctx.search.registerContentType({
  table: 'tasks',
  // ...
  verifyExists: async (key) => {
    const taskId = key.replace('task:', '')
    return await taskExists(taskId)
  }
})
```

### 9.3 Trash Handling (Assets)

- Trashed → remove from index immediately
- Restored → re-index
- Permanently deleted → already removed (no-op)

---

## 10. Testing Strategy

### 10.1 Unit Tests
- **`antfly.ts` (core module)** — mock SDK client, verify table creation, document indexing, search queries, deletion
- **`ctx.search` API** — mock antfly module, verify plugin registration, indexing, removal
- **`use-antfly-search.ts` hook** — mock fetch, verify debounce, fallback, aggregation merging
- **Schema definitions** — snapshot tests per content type

### 10.2 Integration Tests
- **Round-trip** — register content type → index → search → verify
- **Deletion** — index → remove → search → verify gone
- **Orphan cleanup** — index → delete source → run cleanup → verify removed
- **Fallback** — disable Antfly → verify client-side search still works
- **Cross-table** — index to multiple tables → cross-table search → verify merged results

All tests MUST mock `getContentDir` per CLAUDE.md testing rules. Also mock `getOpenClawPath` for tests touching task/schedule/team data.

### 10.3 E2E Tests (Manual)
- Start Bakin with Antfly enabled
- Create task, search for it, move it, verify updated in search
- Upload asset, search by description
- Delete item, verify gone from search
- Check health plugin Search section
- Trigger reindex, verify counts
- Run orphan cleanup

---

## 11. Implementation Phases

### Phase 1: Foundation (Core Infrastructure)
1. Add `SearchAPI` and `SearchContentTypeDefinition` to `PluginContext` types
2. Implement `ctx.search` provider backed by `antfly.ts`
3. Rewrite `antfly.ts` to use `@antfly/sdk` `AntflyClient`
4. Implement content type registry (stores definitions, creates tables)
5. Add `unlink` handler to watcher for deletion sync
6. Add orphan cleanup timer + logic
7. Add search tuning + TTL settings to `BakinSettings`
8. Wipe old `beacon_*` tables on startup
9. Tests for core infrastructure

### Phase 2: Plugin Indexing (Wire All Content Types)
10. Tasks plugin — register content type + index on all mutations in task-service
11. Assets plugin — register content type + index on sidecar write/delete
12. Projects plugin — register content type + index on file write/delete
13. Workflows plugin — register content type + index on template/instance changes
14. Schedule plugin — register content type + index on job CRUD + periodic sync
15. Team plugin — register content type + index on agent load/heartbeat
16. Audit — register content type with TTL + index on appendAudit
17. Update `reindexAll` to use content type registry

### Phase 3: Search API, MCP Tools & CLI
18. Enhance `/api/search` — cross-table (multi-query), structured filters, aggregations
19. Add per-plugin `/search` routes (registered via `ctx.registerRoute()`)
20. Add `/api/antfly/health` endpoint
21. Register MCP exec tools (search_query, search_table, search_lookup, search_facets, search_similar, search_reindex, search_stats)
22. Enhance CLI commands (search with filters/json, search:facets, search:similar, search:stats, reindex --table/--rebuild, search:cleanup)
23. Tests for search API + MCP tools

### Phase 4: UI Integration
22. Create `useAntflySearch` hook with debounce + fallback
23. Wire Tasks search + facets
24. Wire Assets search + facets
25. Wire Projects search + facets
26. Wire Workflows search
27. Wire Schedule search + facets
28. Wire Memory (audit + log) search
29. Wire FacetFilter to use aggregation counts

### Phase 5: Health & Observability
30. Add Search section to health plugin UI
31. Enhance doctor checks (tables, schemas, stale data)
32. Track + display search latency metrics
33. Add reindex + cleanup controls in UI

---

## 12. MCP Tools & CLI Commands

### 12.1 MCP Exec Tools

Registered via `ctx.registerExecTool()` in a search plugin (or core). These ship now; agent wiring is follow-up.

| Tool | Parameters | Returns | Purpose |
|------|-----------|---------|---------|
| `bakin_exec_search_query` | `query: string`, `table?: string`, `filters?: Record<string, string>`, `limit?: number` | `{ results: SearchResult[], aggregations, meta }` | Cross-table or scoped semantic search |
| `bakin_exec_search_table` | `table: string`, `query: string`, `filters?: Record<string, string>`, `limit?: number`, `facets?: string[]` | `{ results, aggregations }` | Search within a specific content type with facets |
| `bakin_exec_search_lookup` | `table: string`, `key: string` | `{ found: boolean, fields: Record<string, unknown> }` | Get a specific indexed document by key |
| `bakin_exec_search_facets` | `table: string`, `facets: string[]`, `query?: string` | `{ facets: Record<string, Array<{ value, count }>> }` | Get available filter values + counts |
| `bakin_exec_search_similar` | `table: string`, `key: string`, `limit?: number` | `{ results: SearchResult[] }` | Find semantically similar documents to a given one |
| `bakin_exec_search_reindex` | `table?: string`, `rebuild?: boolean` | `{ ok: boolean, indexed: number, duration_ms: number }` | Trigger full/per-table reindex. `rebuild` drops+recreates indexes. |
| `bakin_exec_search_stats` | none | `{ status, tables: [...], metrics: {...} }` | Index health and table stats |

**Parameter design principles:**
- Structured `filters` object so agents can narrow results precisely, not just via query phrasing
- Return typed `fields` per result, not just a content blob — agents need `{ id, title, status, agent }` not raw text
- `facets` param lets agents discover filterable dimensions without prior knowledge

### 12.2 CLI Commands

```bash
# Search
bakin search "query"                                    # cross-table (enhanced)
bakin search "query" --table tasks                      # per-table
bakin search "query" --table assets --type images       # with filters
bakin search "query" --json                             # JSON output for piping

# Discovery
bakin search:facets tasks                               # list facet values for a table
bakin search:facets tasks --facet agent                  # specific facet
bakin search:similar task:abc123                         # find similar documents
bakin search:stats                                      # table counts, health, last reindex

# Maintenance
bakin reindex                                           # full reindex (enhanced)
bakin reindex --table tasks                             # per-table
bakin reindex --rebuild                                 # drop + recreate indexes (embedder change)
bakin search:cleanup                                    # trigger orphan cleanup manually
```

---

## 13. Advanced Antfly Features

### 13.1 Chunking

For long documents (task logs, project markdown bodies), Antfly can split content into semantic chunks before embedding. Each chunk gets its own embedding vector, improving retrieval precision for specific passages.

**Per content type opt-in:**
```typescript
ctx.search.registerContentType({
  table: 'tasks',
  // ...
  chunker: {
    enabled: true,            // Off by default — most Bakin content is short
    targetTokens: 200,        // Chunk size target
    overlapTokens: 25,        // Overlap between chunks for context continuity
  }
})
```

**Recommended:** Enable for `bakin_tasks` (log text can be extensive) and `bakin_projects` (markdown bodies). Disable for short-field content types (schedule, team, audit).

### 13.2 Atomic Transforms

Antfly supports MongoDB-style atomic updates (`$set`, `$inc`, `$push`) without re-indexing the full document. Use for high-frequency field updates:

```typescript
// Instead of read → modify → re-index for a status change:
await client.tables.batch('bakin_tasks', {
  transforms: [{
    key_prefix: `task:${taskId}`,
    operations: [
      { op: '$set', value: { status: 'inProgress', updated_at: new Date().toISOString() } }
    ]
  }]
})
```

**Use cases:**
- Task status/column changes (high frequency)
- Agent heartbeat updates (very high frequency)
- Log append without re-embedding entire document

**Trade-off:** Transforms update stored fields but do NOT re-trigger embedding. For fields that affect semantic meaning (title, description), use full re-index. For metadata-only changes (status, updated_at), use transforms.

Expose on `SearchAPI`:
```typescript
/** Atomic field update without re-embedding. For metadata-only changes. */
transform(key: string, operations: TransformOp[]): Promise<void>
```

### 13.3 Multi-Query

Antfly can execute multiple queries in a single request. Instead of N serial HTTP calls for cross-table search, send one:

```typescript
const results = await client.multiquery({
  queries: [
    { table: 'bakin_tasks', semantic_search: query, limit: 5 },
    { table: 'bakin_assets', semantic_search: query, limit: 5 },
    { table: 'bakin_projects', semantic_search: query, limit: 5 },
    // ...all registered tables
  ]
})
```

This should power the cross-table `/api/search` endpoint for better latency.

### 13.4 Secrets in Embedder Config

Antfly supports `${ENV_VAR}` syntax in embedder configuration for API keys:

```typescript
embedder: {
  provider: 'openai',
  model: 'text-embedding-3-small',
  api_key: '${OPENAI_API_KEY}'     // Resolved from environment at runtime
}
```

This means users can switch to OpenAI or other hosted embedders without putting API keys in `settings.json`. The `embedder` settings field stores the provider/model, and the API key comes from env vars.

### 13.5 Reranking (Wiring)

Already designed in settings (`antfly.search.reranker`). Wire into search queries:

```typescript
const queryBody = {
  semantic_search: query,
  full_text_search: { query },
  // Only add if configured
  ...(rerankerConfig && {
    reranker: {
      provider: rerankerConfig.provider,
      model: rerankerConfig.model,
      threshold: rerankerConfig.threshold || 0.0
    }
  })
}
```

Supported providers: `cohere` (rerank-english-v3.0), `ollama`, `termite` (local), `antfly` (built-in).

### 13.6 Features Deferred

| Feature | Why Defer |
|---------|-----------|
| **Graph indexes** | Needs schema redesign, entity relationship model not defined yet |
| **Cross-table joins** | Complex query engine work; cross-table search covers 90% of use cases |
| **Multimodal embeddings** | Cool for image search in assets, but metadata search is sufficient for now |
| **S3 backup/restore** | Antfly data is fully rebuildable from source; not urgent for single-user |
| **Search quality evaluation** | Useful once we have enough queries to build a test set |

---

## 14. Backfill & Reindex Architecture

### 14.1 Plugin Reindex Contract

Every `SearchContentTypeDefinition` MUST provide a `reindex()` async generator. This is the plugin's promise that it can rebuild its entire search index from source.

**Tasks example (SQLite source):**
```typescript
reindex: async function* () {
  const allTasks = await readAllTasks()  // Read from flow_runs SQLite table
  for (const task of allTasks) {
    yield {
      key: `task:${task.id}`,
      doc: {
        title: task.title,
        description: task.description || '',
        status: task.column,
        agent: task.agent || '',
        // ... all fields
      }
    }
  }
}
```

**Assets example (filesystem source):**
```typescript
reindex: async function* () {
  const assetsDir = join(getContentDir(), 'assets')
  for (const type of readdirSync(assetsDir)) {
    for (const taskDir of readdirSync(join(assetsDir, type))) {
      for (const file of readdirSync(join(assetsDir, type, taskDir))) {
        if (!file.endsWith('.meta.json')) continue
        const meta = JSON.parse(readFileSync(join(assetsDir, type, taskDir, file), 'utf-8'))
        yield { key: `asset:${type}/${taskDir}/${file.replace('.meta.json', '')}`, doc: { ... } }
      }
    }
  }
}
```

### 14.2 Reindex Modes

| Mode | Trigger | What Happens |
|------|---------|-------------|
| **Full reindex** | `POST /api/reindex`, `bakin reindex`, health UI button | Iterate all registered content types, call each `reindex()` generator, upsert all documents |
| **Per-table reindex** | `POST /api/reindex?table=tasks`, `bakin reindex --table tasks` | Call single content type's `reindex()` generator |
| **Rebuild** | `bakin reindex --rebuild`, embedder config change on startup | Drop + recreate all embeddings indexes with current config, then full reindex |
| **Per-table rebuild** | `bakin reindex --table tasks --rebuild` | Drop + recreate indexes for one table, then reindex it |

### 14.3 Embedder Change Detection

On startup, compare `settings.antfly.embedder` against the stored embedder config on each table's embeddings index. If they differ:

1. Log: "Embedder config changed (was: X, now: Y) — rebuild required"
2. Prompt user or auto-rebuild based on setting
3. Drop embeddings indexes, recreate with new config
4. Trigger full reindex

Store the active embedder config in Antfly table metadata or in `~/.bakin/plugin-settings/search.json` for comparison.

---

## 15. Commit Strategy

### Per-Task Commits

Each task (T1–T20) gets its own commit. Large tasks split into sub-commits. All on the same branch (`feat/antfly-search`).

```
feat(search): T1.1 — extend BakinSettings with search tuning fields
feat(search): T1.2 — add SearchAPI types to PluginContext
feat(search): T1.3 — rewrite antfly.ts to use @antfly/sdk
feat(search): T2 — ctx.search provider and content type registry
feat(search): T3 — watcher unlink + orphan cleanup
feat(search): T4 — tasks plugin indexing
feat(search): T5 — assets plugin indexing
...
```

### Checkpoint Tags

After each checkpoint passes, tag the commit:

```
git tag search-checkpoint-1   # Foundation complete
git tag search-checkpoint-2   # All plugins indexing
git tag search-checkpoint-3   # Search API complete
git tag search-checkpoint-4   # UI integration complete
git tag search-checkpoint-5   # Ship-ready
```

### Rollback Strategy

- **Per-task rollback:** `git revert <commit>` for any single task
- **Per-phase rollback:** Reset to checkpoint tag
- **Graceful degradation:** Even partial implementation is safe — Antfly disabled = no-op everywhere, client-side fallback in UI

### Branch Strategy

Single feature branch `feat/antfly-search`. No per-task PRs (would be churn for a single-user project). Merge to main after checkpoint 5 passes.

---

## 16. Documentation Strategy

### 16.1 Knowledge Docs (`.claude/knowledge/`)

These are the files Claude Code reads to understand the system. Search is now core infrastructure — it needs the same depth as the plugin system and storage model docs.

**New files to create:**

| File | Contents | Written After |
|------|----------|--------------|
| `search-system.md` | Architecture overview: ctx.search API, content type registry, indexing pipeline, hybrid search, graceful degradation, cross-table search. The "how search works in Bakin" doc. | Phase 1 (T1–T3) |
| `search-plugin-guide.md` | How to make a plugin searchable: `registerContentType()`, schema design, `reindex()` generator, `verifyExists()`, chunking, transforms, facets. Includes complete examples for core and addon plugins. | Phase 2 (T4–T10) |
| `search-api-reference.md` | API surface: REST endpoints (`/api/search`, `/api/plugins/{id}/search`, `/api/reindex`, `/api/antfly/health`), MCP exec tools (all 7), CLI commands. Request/response shapes, filter syntax, aggregation format. | Phase 3 (T11–T11b) |

**Existing files to update:**

| File | What Changes | When |
|------|-------------|------|
| `storage-model.md` | Replace the 3-line "Antfly Indexing" section with a proper summary + pointer to `search-system.md`. Add deletion sync and the fact that tasks are SQLite-backed (not file-watched). | Phase 1 |
| `plugin-system.md` | Add `ctx.search` to the PluginContext documentation. Document `registerContentType()` alongside `registerExecTool()`, `registerRoute()`, etc. | Phase 1 (T2) |
| `tasks-plugin.md` | Replace "Completed tasks are indexed in Antfly" with accurate description: all tasks indexed on every mutation, rich schema, facets. | Phase 2 (T4) |
| `assets-plugin.md` | Update Antfly section: structured sidecar indexing, trash removal, type facets. | Phase 2 (T5) |
| `url-state-deep-linking.md` | Add notes about `useAntflySearch` hook and how search params flow to API. | Phase 4 (T12) |
| `shared-ui-patterns.md` | Add `useAntflySearch` hook pattern and FacetFilter aggregation counts. | Phase 4 (T19) |

### 16.2 CLAUDE.md Updates

Update the main CLAUDE.md to reflect the search system as core infrastructure:

- **Architecture section:** Replace "Search: Antfly SDK for full-text indexing" with a proper paragraph covering: hybrid search (semantic + BM25), `ctx.search` plugin API, 7 indexed content types, cross-table search, MCP tools, client-side fallback.
- **Key Patterns section:** Add "Search Indexing" pattern alongside SSE Broadcasting, Agent Activity, etc.
- **Directory Map:** Add `src/core/search-registry.ts`, `src/core/search-cleanup.ts`, `scripts/lib/search-tools.ts` to the repo structure.
- **Plugin System section:** Mention `ctx.search` as part of plugin context.

### 16.3 Skills (`.claude/skills/`)

**New skill to create:**

| Skill | Purpose | Written After |
|-------|---------|--------------|
| `add-search-to-plugin.md` | Step-by-step skill for making any plugin (core or addon) searchable. Covers: schema design, content type registration, mutation hooks, reindex generator, verifyExists, chunking decision, facet selection. | Phase 2 |

This parallels the existing `create-plugin.md` and `audit-plugin.md` skills.

### 16.4 When Docs Are Written

Docs are NOT written upfront. They're written as a deliverable of each phase:

- **Phase 1 commits:** `docs(search): add search-system.md knowledge doc` + update `storage-model.md`, `plugin-system.md`, CLAUDE.md
- **Phase 2 commits:** `docs(search): add search-plugin-guide.md` + `add-search-to-plugin` skill + update `tasks-plugin.md`, `assets-plugin.md`
- **Phase 3 commits:** `docs(search): add search-api-reference.md`
- **Phase 4 commits:** `docs(search): update url-state and shared-ui-patterns`

Each doc commit follows its implementation commit — you write code, then document what you built.

### 16.5 Doc Quality Bar

Each knowledge doc must:
- Start with a 2-3 sentence summary of what this doc covers
- Include concrete code examples (not just interface definitions)
- Reference exact file paths for implementation
- Cover error/fallback behavior, not just the happy path
- Be self-contained — a reader shouldn't need to read the spec to understand the doc

---

## 17. Boundaries

### Always Do
- Graceful degradation — Antfly down = client-side fallback, never error
- Fire-and-forget indexing — never block user actions
- Namespace with `bakin_` prefix
- Delete from index when content is deleted
- Expose search via `ctx.search` — no direct antfly imports from plugins
- Mock `getContentDir` and `getOpenClawPath` in all tests
- Include all visible content in search results (disabled, archived, etc.)

### Ask First
- Changing embedding model or provider
- Adding Antfly advanced features (RAG, graph, joins) to UI
- Changes to `BakinSettings` schema beyond what's spec'd
- New tables beyond what plugins register

### Never Do
- Make Antfly required — always optional
- Store data only in Antfly — it's a search index, not primary store
- Skip client-side fallback in search UI
- Index sensitive data (tokens, keys, passwords)
- Hardcode `~/.bakin/` or `~/.antfly/` paths
- Import `antfly.ts` directly from plugins — use `ctx.search`
