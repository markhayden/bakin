/**
 * Search Registry core — the globalThis-backed singleton state, table
 * provisioning, per-plugin table resolution, and the shared query/result
 * mappers. The feature surfaces (search-plugin-api, search-reindex,
 * search-query) build on this; `search-registry.ts` re-exports everything as
 * the stable public barrel.
 *
 * Uses globalThis so every reach into this module shares one registry.
 */
import type {
  SearchContentTypeDefinition,
  SearchIndexDefinition,
  SearchQueryParams,
  SearchResponse,
  SearchResult,
} from '../../packages/core/src/plugin-types'
import type {
  AggregationRequest,
  Filter,
  FacetCount,
  Query,
  SearchAdapter,
  SearchHit,
  TableConfig,
} from '@bakin/core/adapters/search'
import { createLogger } from './logger'
import { broadcast } from './sse'
import {
  ensureTable as ensureVersionedTable,
  rebuildTable as rebuildVersionedTable,
  resumeMigrations as resumeVersionedMigrations,
  tableStatus as versionedTableStatus,
  listTableStates as listVersionedTableStates,
  queryTarget,
  type TableEnsureDef,
} from '@bakin/core/search/tables'
import { getAppServices } from './app-services-store'

const log = createLogger('search-registry-core')

// ---------------------------------------------------------------------------
// Registry singleton (globalThis-backed)
// ---------------------------------------------------------------------------
export interface RegistryState {
  /** Map of full table name → content type definition */
  contentTypes: Map<string, SearchContentTypeDefinition & { pluginId: string }>
  /** Map of pluginId → full table name */
  pluginTables: Map<string, string>
  /** File-backed watcher hook disposers by full table name. */
  fileBackedWiring: Map<string, { pluginId: string; dispose: () => void }>
  /** Whether tables have been created during this startup */
  tablesCreated: boolean
}

const _g = globalThis as typeof globalThis & {
  __bakinSearchRegistry?: RegistryState
}

export function getRegistry(): RegistryState {
  if (!_g.__bakinSearchRegistry) {
    _g.__bakinSearchRegistry = {
      contentTypes: new Map(),
      pluginTables: new Map(),
      fileBackedWiring: new Map(),
      tablesCreated: false,
    }
  }
  return _g.__bakinSearchRegistry
}

export function getSearchAdapter(): SearchAdapter {
  return getAppServices().search
}

// ---------------------------------------------------------------------------
// Table name resolution
// ---------------------------------------------------------------------------
export const TABLE_PREFIX = 'bakin_'

export function fullTableName(table: string): string {
  return table.startsWith(TABLE_PREFIX) ? table : `${TABLE_PREFIX}${table}`
}

export function disposeFileBackedWiring(tableName: string): void {
  const registry = getRegistry()
  const wiring = registry.fileBackedWiring.get(tableName)
  if (!wiring) return
  registry.fileBackedWiring.delete(tableName)
  try {
    wiring.dispose()
  } catch (err) {
    log.warn('File-backed watcher cleanup failed', err, { tableName, pluginId: wiring.pluginId })
  }
}

function forgetContentType(tableName: string, def?: { pluginId: string }): boolean {
  const registry = getRegistry()
  const existing = def ?? registry.contentTypes.get(tableName)
  const removed = registry.contentTypes.delete(tableName)
  disposeFileBackedWiring(tableName)
  if (existing) {
    if (registry.pluginTables.get(existing.pluginId) === tableName) {
      registry.pluginTables.delete(existing.pluginId)
    }
  }
  return removed
}

// ---------------------------------------------------------------------------
// Table creation from schema
// ---------------------------------------------------------------------------

/**
 * Compute the effective list of vector indexes for a content type. When
 * `def.indexes` is set, returns it as-is. Otherwise synthesizes a single
 * default index named `embeddings` from the top-level `embeddingTemplate`
 * — this keeps older content type definitions on stable search table
 * schemas even when they do not declare explicit indexes.
 */
function getEffectiveIndexes(def: SearchContentTypeDefinition): SearchIndexDefinition[] {
  if (def.indexes && def.indexes.length > 0) {
    return def.indexes
  }
  return [
    {
      name: 'embeddings',
      embedderRef: 'default',
      embeddingTemplate: def.embeddingTemplate,
      chunker: def.chunker,
    },
  ]
}

function buildTableConfig(def: SearchContentTypeDefinition): TableConfig {
  return {
    fields: def.schema,
    // Capability legs (D17): the adapter maps text-embedding → its default
    // text embedder and media-embedding → its media embedder; the engine's
    // own full-text leg is implied. Leg names are the scoreBreakdown keys.
    legs: [
      { name: 'full_text', capability: 'full-text' as const, fields: def.searchableFields },
      ...getEffectiveIndexes(def).map((idx) => ({
        name: idx.name,
        capability: (idx.mediaUrlField ? 'media-embedding' : 'text-embedding') as 'media-embedding' | 'text-embedding',
        fields: def.searchableFields,
        template: idx.embeddingTemplate,
        mediaUrlField: idx.mediaUrlField,
        weight: idx.weight,
        chunker: idx.chunker,
      })),
    ],
    adapterOptions: {
      defaultType: def.table,
      description: `Bakin ${def.table} - auto-created by search registry`,
      searchableFields: def.searchableFields,
      facets: def.facets,
      ttl: def.ttl,
      ttlField: def.ttlField,
      numShards: 1,
    },
  }
}

/**
 * Ensure one table exists. Throws on creation failure so callers can
 * surface the error rather than silently treating it like "already
 * existed". The adapter owns provider-specific create semantics, so we
 * re-list after create to disambiguate "skipped, already there" from
 * "tried and failed".
 */
function toVersionedDef(def: SearchContentTypeDefinition): TableEnsureDef {
  return {
    logical: fullTableName(def.table),
    schemaVersion: def.schemaVersion ?? 1,
    config: buildTableConfig(def),
    reindex: async function* () {
      if (!def.reindex) return
      for await (const item of def.reindex()) {
        yield { key: item.key, doc: item.doc }
      }
    },
  }
}

function adapterFingerprint(search: SearchAdapter): string {
  return search.mappingFingerprint?.() ?? 'legacy-adapter'
}

/** Physical table queries/scans hit right now (blue during migrations). */
export function resolvePhysicalTable(logical: string): string {
  return queryTarget(logical) ?? logical
}

function broadcastRebuild(type: 'search.rebuild.start' | 'search.rebuild.progress' | 'search.rebuild.complete', logical: string, extra?: Record<string, unknown>): void {
  try {
    broadcast({ type, table: logical, ...extra })
  } catch {
    // SSE not up (tests) — progress is best-effort display only
  }
}

async function ensureTable(search: SearchAdapter, def: SearchContentTypeDefinition): Promise<'created' | 'exists'> {
  const logical = fullTableName(def.table)
  const result = await ensureVersionedTable(search, toVersionedDef(def), adapterFingerprint(search))
  if (result === 'migrated' || result === 'parked') {
    log.info('content-type layout changed — blue/green migration ran', { logical, result })
  }
  return result === 'created' ? 'created' : 'exists'
}

/** Per-table rebuild outcome — the ONE shape the /api/reindex route and the CLI share. */
export interface ReindexTableOutcome {
  table: string
  result: string
  indexed?: number
  error?: string
}

export interface RebuildOpts {
  /**
   * Force fresh generations for every targeted table. Without it (the
   * default since 2026-07-21), a pass is a REPAIR: parked migrations are
   * resumed, tables whose engine-side physical vanished (data-dir wipe,
   * engine reset) are rebuilt, drifted layouts migrate via plain ensure —
   * and healthy tables are NOT touched. The old force-everything default
   * churned a healthy table through five generations in one evening.
   */
  force?: boolean
}

/** Concurrent tables per rebuild pass. Backfills still serialize on the
 * migration chain (embed-load bound); this bounds how many tables can sit
 * in their (cheap, off-chain) converge phase simultaneously. */
const REBUILD_CONCURRENCY = 3

let rebuildInFlight: Promise<ReindexTableOutcome[]> | null = null

/**
 * Blue/green rebuild pass (the /api/reindex + `bakin reindex` path).
 * Queries keep answering from the old physical throughout; SSE
 * `search.rebuild.*` events drive the health page's live progress.
 * SINGLE-FLIGHT: overlapping calls coalesce into the running pass —
 * stacked passes used to regenerate every table once per kick.
 */
export function rebuildRegisteredTables(tableName?: string, opts?: RebuildOpts): Promise<ReindexTableOutcome[]> {
  if (rebuildInFlight) {
    log.info('reindex requested while a pass is running — attaching to it')
    return rebuildInFlight
  }
  const pass = runRebuildPass(tableName, opts).finally(() => {
    rebuildInFlight = null
  })
  rebuildInFlight = pass
  return pass
}

async function runRebuildPass(tableName?: string, opts?: RebuildOpts): Promise<ReindexTableOutcome[]> {
  const registry = getRegistry()
  const search = getSearchAdapter()
  const targets = Array.from(registry.contentTypes.entries())
    .filter(([logical, def]) => !tableName || logical === tableName || def.table === tableName)

  const results: ReindexTableOutcome[] = []
  const queue = [...targets]
  const workers = Array.from({ length: Math.min(REBUILD_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift()
      if (!next) return
      results.push(await rebuildOneTable(search, next[0], next[1], opts))
    }
  })
  await Promise.all(workers)
  return results
}

async function rebuildOneTable(
  search: SearchAdapter,
  logical: string,
  def: SearchContentTypeDefinition & { pluginId: string },
  opts?: RebuildOpts,
): Promise<ReindexTableOutcome> {
  broadcastRebuild('search.rebuild.start', logical)
  try {
    let indexed = 0
    const ensureOpts = {
      onProgress: (phase: string, backfillDone?: number) => {
        if (backfillDone !== undefined) indexed = backfillDone
        broadcastRebuild('search.rebuild.progress', logical, { phase, indexed: backfillDone ?? 0 })
      },
    }
    const vdef = toVersionedDef(def)
    const fingerprint = adapterFingerprint(search)
    let result: string
    if (opts?.force) {
      result = await rebuildVersionedTable(search, vdef, fingerprint, ensureOpts)
    } else {
      result = await repairOneTable(search, vdef, fingerprint, ensureOpts)
    }
    broadcastRebuild('search.rebuild.complete', logical, { result, indexed })
    return { table: logical, result, indexed }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    broadcastRebuild('search.rebuild.complete', logical, { error: message })
    return { table: logical, result: 'failed', error: message }
  }
}

/**
 * Repair semantics for one table: resume a parked/in-flight migration
 * (recorded target, no re-embed thanks to the resume fast path); force a
 * fresh generation ONLY when the registry's physical is missing
 * engine-side (data-dir wipe / engine reset — the post-nuke case); plain
 * ensure otherwise, which is a no-op for healthy tables and a normal
 * migration for drifted layouts.
 */
async function repairOneTable(
  search: SearchAdapter,
  vdef: ReturnType<typeof toVersionedDef>,
  fingerprint: string,
  ensureOpts: { onProgress: (phase: string, backfillDone?: number) => void },
): Promise<string> {
  const state = versionedTableStatus(vdef.logical)
  if (state?.state === 'migrating') {
    const outcomes = await resumeVersionedMigrations(search, [vdef], fingerprint, ensureOpts)
    const outcome = outcomes.find((o) => o.logical === vdef.logical)
    if (outcome && outcome.result !== 'skipped') return `resumed:${outcome.result}`
  }
  if (state) {
    const stats = await search.tables.stats(state.physical).catch(() => null)
    if (!stats) {
      log.warn('registry physical missing engine-side — forcing a fresh generation', {
        logical: vdef.logical,
        physical: state.physical,
      })
      return rebuildVersionedTable(search, vdef, fingerprint, ensureOpts)
    }
  }
  return ensureVersionedTable(search, vdef, fingerprint, ensureOpts)
}

/** Boot-time continuation of crash/park-interrupted migrations (D5). */
export async function resumeTableMigrations(): Promise<void> {
  const registry = getRegistry()
  const search = getSearchAdapter()
  const defs = Array.from(registry.contentTypes.values()).map(toVersionedDef)
  await resumeVersionedMigrations(search, defs, adapterFingerprint(search))
}

// ---------------------------------------------------------------------------
// Migration pump — parked work self-heals (2026-07-21 five-lens review)
// ---------------------------------------------------------------------------

/** Pump cadence; mirrors the outbox safety tick's role for writes. */
const MIGRATION_PUMP_INTERVAL_MS = 5 * 60 * 1000
/** Consecutive failed resume attempts per table before the pump stands down
 * (the parked state stays visible to the doctor, which owns escalation). */
const MIGRATION_PUMP_MAX_ATTEMPTS = 5
/** Fast wedge-watchdog cadence — only bites while migrations are in flight. */
const WEDGE_WATCH_INTERVAL_MS = 30 * 1000
/** In-flight work + a heartbeat this stale = the engine wedged under load. */
const WEDGE_STALE_MS = 2 * 60 * 1000
/** Never bounce the engine twice inside this window. */
const WEDGE_RESTART_DEBOUNCE_MS = 5 * 60 * 1000

let pumpTimer: ReturnType<typeof setInterval> | null = null
let wedgeTimer: ReturnType<typeof setInterval> | null = null
let lastWedgeRestartAt = 0
const pumpAttempts = new Map<string, number>()

/**
 * Start the migration pump: every cycle, resume any PARKED migration whose
 * table is still registered. Parked work previously waited for a server
 * boot or a human re-kick — the outbox got a safety tick, migrations never
 * did. Attempt-capped per table; a success resets the counter.
 */
export function startMigrationPump(): void {
  if (pumpTimer) return
  pumpTimer = setInterval(() => {
    void pumpParkedMigrations().catch((err: unknown) => {
      log.warn('migration pump cycle failed', { err: err instanceof Error ? err.message : String(err) })
    })
  }, MIGRATION_PUMP_INTERVAL_MS)
  pumpTimer.unref?.()
  wedgeTimer = setInterval(() => {
    void wedgeWatchTick().catch((err: unknown) => {
      log.warn('wedge watchdog tick failed', { err: err instanceof Error ? err.message : String(err) })
    })
  }, WEDGE_WATCH_INTERVAL_MS)
  wedgeTimer.unref?.()
}

export function stopMigrationPump(): void {
  if (pumpTimer) clearInterval(pumpTimer)
  if (wedgeTimer) clearInterval(wedgeTimer)
  pumpTimer = null
  wedgeTimer = null
  pumpAttempts.clear()
  lastWedgeRestartAt = 0
}

/**
 * Fast wedge watchdog (2026-07-22 soak finding): the engine repeatedly
 * wedges UNDER REBUILD LOAD — SendFailed storms, zero embed batches, every
 * in-flight backfill frozen — while still answering health probes. The
 * doctor's canary catches that on a ~30-minute cadence; mid-rebuild it
 * must be ~a minute. While migrations are in flight, a stale progress
 * heartbeat (backfill chunks, converge movement, outbox landings all
 * silent) bounces the engine via the adapter's own restartEngine, then
 * pumps parked work immediately. Debounced; no-op for adapters that don't
 * supervise their engine (guest/child modes return restartEngine
 * undefined).
 */
async function wedgeWatchTick(): Promise<void> {
  const inFlight = listVersionedTableStates().some(
    (s) => s.state === 'migrating' && s.phase !== 'parked',
  )
  if (!inFlight) return
  const { lastSearchEngineProgressAt } = await import('@bakin/core/search/progress')
  const staleFor = Date.now() - lastSearchEngineProgressAt()
  if (staleFor < WEDGE_STALE_MS) return
  if (Date.now() - lastWedgeRestartAt < WEDGE_RESTART_DEBOUNCE_MS) return

  const search = getSearchAdapter()
  if (!search.restartEngine) return
  lastWedgeRestartAt = Date.now()
  log.warn('engine wedged under migration load — bouncing it', { staleForMs: staleFor })
  try {
    await search.restartEngine()
  } catch (err) {
    log.warn('wedge watchdog engine restart failed', { err: err instanceof Error ? err.message : String(err) })
    return
  }
  const { noteSearchEngineProgress } = await import('@bakin/core/search/progress')
  noteSearchEngineProgress()
  // Parked work resumes right away instead of waiting for the slow tick.
  void pumpParkedMigrations().catch(() => {})
}

/** One pump cycle (exported for tests + the doctor's repair path). */
export async function pumpParkedMigrations(
  opts?: { convergePollMs?: number; zeroProgressParkMs?: number },
): Promise<Array<{ logical: string; result: string }>> {
  const registry = getRegistry()
  const search = getSearchAdapter()
  const defs = Array.from(registry.contentTypes.values()).map(toVersionedDef)
  const states = listVersionedTableStates()
  const parked = states.filter((s) => s.state === 'migrating' && s.phase === 'parked')

  const outcomes: Array<{ logical: string; result: string }> = []

  const eligible = parked.filter((s) => (pumpAttempts.get(s.logical) ?? 0) < MIGRATION_PUMP_MAX_ATTEMPTS)
  if (eligible.length > 0) {
    const eligibleDefs = defs.filter((d) => eligible.some((s) => s.logical === d.logical))
    outcomes.push(...await resumeVersionedMigrations(search, eligibleDefs, adapterFingerprint(search), { ...opts, onlyParked: true }))
  }

  // ACTIVE rows whose physical vanished engine-side have no other owner
  // until a human reindexes: boot ignores them (D5) and resume only sees
  // 'migrating' rows. A crash mid-repair-pass strands exactly this shape
  // (soak cycle 5 finding). Availability-guarded so an engine OUTAGE can
  // never masquerade as mass table loss: stats null while the engine is
  // down means "unreachable", not "missing".
  if (await search.available().catch(() => false)) {
    for (const state of states.filter((s) => s.state === 'active')) {
      const def = defs.find((d) => d.logical === state.logical)
      if (!def) continue
      if ((pumpAttempts.get(state.logical) ?? 0) >= MIGRATION_PUMP_MAX_ATTEMPTS) continue
      const stats = await search.tables.stats(state.physical).catch(() => null)
      if (stats !== null) continue
      log.warn('migration pump: active physical missing engine-side — regenerating', {
        logical: state.logical,
        physical: state.physical,
      })
      const result = await rebuildVersionedTable(search, def, adapterFingerprint(search), opts)
        .catch((err: unknown) => {
          log.warn('migration pump regeneration failed', {
            logical: state.logical,
            err: err instanceof Error ? err.message : String(err),
          })
          return 'failed' as const
        })
      outcomes.push({ logical: state.logical, result })
    }
  }

  for (const outcome of outcomes) {
    if (outcome.result === 'migrated' || outcome.result === 'unchanged') {
      pumpAttempts.delete(outcome.logical)
      log.info('migration pump completed recorded work', outcome)
    } else {
      const attempts = (pumpAttempts.get(outcome.logical) ?? 0) + 1
      pumpAttempts.set(outcome.logical, attempts)
      if (attempts >= MIGRATION_PUMP_MAX_ATTEMPTS) {
        log.warn('migration pump standing down for table — repeated failures; doctor owns escalation', {
          logical: outcome.logical,
          attempts,
        })
      }
    }
  }
  return outcomes
}

// ---------------------------------------------------------------------------
// Table provisioning
// ---------------------------------------------------------------------------

export interface EnsureTablesResult {
  created: number
  failures: Array<{ table: string; pluginId: string; error: string }>
}

/**
 * Ensure every registered content type has a corresponding search table.
 * Idempotent — re-lists adapter tables on every call so it self-heals when
 * the search backend is wiped, restarted, or otherwise drifts from Bakin's registry.
 *
 * Returns both the count of tables created and any per-table failures so
 * callers (notably the `/api/reindex` handler) can surface real errors
 * instead of reporting `indexed: 0` for tables that never got created.
 */
export async function ensureRegisteredTables(): Promise<EnsureTablesResult> {
  const registry = getRegistry()
  const search = getSearchAdapter()

  let created = 0
  const failures: Array<{ table: string; pluginId: string; error: string }> = []
  for (const [tableName, def] of registry.contentTypes) {
    try {
      // Blue/green registry rows are the existence check — a matching row
      // is ZERO adapter calls (boot-does-nothing, D5). Engine-side drift
      // (wiped index) is the doctor's count-mismatch check, never a boot scan.
      const status = await ensureTable(search, def)
      if (status === 'created') created++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`Failed to create table for ${def.table}`, err)
      failures.push({ table: tableName, pluginId: def.pluginId, error: msg })
    }
  }

  // Only mark the registry as fully provisioned when every table created
  // cleanly. If any failed, leave the flag false so the next call retries
  // them rather than short-circuiting on the cached "done" signal.
  if (failures.length === 0) {
    registry.tablesCreated = true
  }
  return { created, failures }
}

/**
 * Create tables for all registered content types.
 * Called during server startup after all plugins have activated.
 */
export async function createRegisteredTables(): Promise<EnsureTablesResult> {
  const registry = getRegistry()
  if (registry.tablesCreated) return { created: 0, failures: [] }
  const { created, failures } = await ensureRegisteredTables()
  log.info(`Search tables ready: ${registry.contentTypes.size} content types (${created} created)`)
  if (failures.length > 0) {
    log.error(`Search table creation failures: ${failures.length}`, { failures })
  }
  return { created, failures }
}

/**
 * Get all registered content types (for reindex, health, etc.).
 */
export function getContentTypes(): Map<string, SearchContentTypeDefinition & { pluginId: string }> {
  return getRegistry().contentTypes
}

/**
 * Purge a single content type — drop the underlying search table (atomic
 * delete-all) and remove the in-memory registration. Used by
 * `bakin plugins remove` (#119) to tear down a plugin's index entries
 * before deleting the plugin itself.
 *
 * Accepts either the bare content-type name (`memory`) or the prefixed
 * full table name (`bakin_memory`). Returns the row count present at
 * purge time (best-effort via search adapter table stats; 0 when stats are unavailable
 * or the search adapter is unavailable).
 *
 * No-op + returns 0 when the search adapter is unavailable — the in-memory registration
 * still gets cleared so the plugin can re-register on next install.
 */
export async function purgeContentType(name: string): Promise<number> {
  const registry = getRegistry()
  const search = getSearchAdapter()
  const tableName = fullTableName(name)
  const def = registry.contentTypes.get(tableName)

  if (!await search.available()) {
    if (def) forgetContentType(tableName, def)
    return 0
  }

  const physical = resolvePhysicalTable(tableName)
  let removed = 0
  try {
    const stats = await search.tables.stats(physical)
    removed = stats?.documents ?? 0
  } catch (err) {
    log.warn('purgeContentType: failed to read row count before drop', err, { tableName })
  }

  try {
    await search.tables.drop(physical)
  } catch (err) {
    log.error('purgeContentType: table drop failed', err, { tableName })
    throw err
  }

  // Tear down ALL durable state, not just the engine table: the registry
  // row (a survivor here resurrects the table on the next rebuild pass —
  // the bakin_messaging_brainstorm leak) and any undelivered journal rows.
  const { removeTableRegistration } = await import('@bakin/core/search/tables')
  const { purgeTable } = await import('@bakin/core/search/outbox')
  for (const leftover of removeTableRegistration(tableName)) {
    if (leftover !== physical) {
      await search.tables.drop(leftover).catch(() => {})
    }
  }
  purgeTable(tableName)

  if (def) forgetContentType(tableName, def)

  log.info(`Purged content type ${tableName} (${removed} docs)`)
  return removed
}

/**
 * Remove a plugin's in-memory search registrations and file watcher hooks
 * without dropping the underlying search tables. This is the hot-reload path:
 * the plugin will immediately re-register its content types on activate, and
 * preserving the table avoids destructive dev-loop behavior on every save.
 */
export function unregisterContentTypesByPlugin(pluginId: string): number {
  const registry = getRegistry()
  const ownedTables = [...registry.contentTypes.entries()]
    .filter(([, def]) => def.pluginId === pluginId)
    .map(([tableName, def]) => ({ tableName, def }))

  for (const { tableName, def } of ownedTables) {
    forgetContentType(tableName, def)
  }
  return ownedTables.length
}

/**
 * Get the full table name a plugin's `/search` route and MCP plugin-param
 * routing resolve to — the plugin's PRIMARY content type. Returns null when the
 * plugin has registered no content type. A plugin with multiple content types
 * (one direct primary + secondary file-backed types, e.g. team) resolves to its
 * primary; it no longer throws (the dispatch layers route to one table per plugin,
 * and secondary file-backed types are indexed directly, not via this path).
 */
export function getTableForPlugin(pluginId: string): string | null {
  return getRegistry().pluginTables.get(pluginId) ?? null
}

/**
 * Get the effective vector index names for a table. Used by query callers
 * to know which indexes to target when running semantic search. Returns
 * ['embeddings'] for tables with no registration (e.g. unknown or legacy
 * tables) so queries degrade gracefully rather than targeting nothing.
 */
export function getIndexNames(tableName: string): string[] {
  const def = getRegistry().contentTypes.get(tableName)
  if (!def) return ['embeddings']
  return getEffectiveIndexes(def).map(i => i.name)
}

/**
 * Get the rerank field for a table, or undefined if the content type did
 * not declare one. Callers that pass this to the search adapter will have the
 * cross-encoder reranker attached only when a field is set.
 */
export function getRerankField(tableName: string): string | undefined {
  return getRegistry().contentTypes.get(tableName)?.rerankField
}

/**
 * Get the full-text searchable fields for a table. The adapter builds the
 * full-text leg as a per-field match over these (a default single-field/_all
 * query matches nothing). Returns [] for unknown tables.
 */
export function getSearchableFields(tableName: string): string[] {
  return getRegistry().contentTypes.get(tableName)?.searchableFields ?? []
}

/**
 * Get per-index fusion weights for a table, keyed by index name, or undefined
 * when no index declares a custom weight. Passed to the adapter as
 * `merge_config.weights` so hybrid search can favor a reliable index leg.
 */
export function getIndexWeights(tableName: string): Record<string, number> | undefined {
  const def = getRegistry().contentTypes.get(tableName)
  if (!def) return undefined
  const weights: Record<string, number> = {}
  for (const idx of getEffectiveIndexes(def)) {
    if (typeof idx.weight === 'number') weights[idx.name] = idx.weight
  }
  return Object.keys(weights).length > 0 ? weights : undefined
}

// ---------------------------------------------------------------------------
// Shared query/result mappers (used by search-plugin-api + search-query)
// ---------------------------------------------------------------------------

export function adapterHitToPluginResult(hit: SearchHit, tableName: string): SearchResult {
  // Surface the per-index score breakdown (BM25 / text-embedding / visual)
  // minus the rerank entry, which has its own field. Powers the debug overlay.
  const { rerank, ...indexScores } = hit.scoreBreakdown ?? {}
  return {
    id: hit.key,
    table: tableName,
    score: hit.score,
    fields: hit.document,
    rerankScore: rerank,
    ...(Object.keys(indexScores).length > 0 ? { indexScores } : {}),
  }
}

export function filtersFromRecord(filters?: Record<string, string | boolean | number>): Filter[] | undefined {
  if (!filters || Object.keys(filters).length === 0) return undefined
  return Object.entries(filters).map(([field, value]) => ({ field, op: 'eq', value }))
}

function normalizeAggregationType(type: string | undefined): AggregationRequest['type'] {
  switch (type) {
    case 'sum':
    case 'avg':
    case 'min':
    case 'max':
    case 'histogram':
      return type
    default:
      return 'count'
  }
}

export function aggregationsFromRecord(input?: Record<string, unknown>): AggregationRequest[] | undefined {
  if (!input || Object.keys(input).length === 0) return undefined
  const aggregations: AggregationRequest[] = []
  for (const [name, raw] of Object.entries(input)) {
    const item = raw as { type?: string; field?: string; interval?: string | number }
    if (!item.field) continue
    aggregations.push({
      name,
      type: item.type === 'date_histogram' ? 'histogram' : normalizeAggregationType(item.type),
      field: item.field,
      ...(item.interval === undefined ? {} : { interval: item.interval }),
    })
  }
  return aggregations.length > 0 ? aggregations : undefined
}

export function mapSearchStrategy(strategy: SearchQueryParams['strategy']): Query['strategy'] {
  switch (strategy) {
    case 'full_text_only': return 'fts'
    case 'semantic_only': return 'vector'
    case 'rrf': return 'hybrid'
    default: return undefined
  }
}

export function mapFacetCounts(facets: Record<string, FacetCount[]> | undefined): SearchResponse['aggregations'] {
  if (!facets) return undefined
  const mapped: NonNullable<SearchResponse['aggregations']> = {}
  for (const [field, counts] of Object.entries(facets)) {
    mapped[field] = counts.map((count) => ({
      value: String(count.value),
      count: count.count,
    }))
  }
  return mapped
}

/**
 * Reset the registry (for testing).
 */
export function resetSearchRegistry(): void {
  _g.__bakinSearchRegistry = undefined
}
