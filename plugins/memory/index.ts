/**
 * Memory plugin — server entry point (v2 rebuild, C2).
 *
 * Read-only observability over every runtime memory tier plus Bakin's own
 * audit log, surfaced through a single `bakin_memory` search table. Per-tier
 * routes, UI, and indexer logic land in subsequent commits (C3–C8).
 *
 * This file deliberately stays small: it (a) registers the `bakin_memory`
 * content type, (b) constructs the MemoryIndexer and hooks watcher events
 * into it, (c) wires the BakinCreate watch list. All tier-specific code
 * lives under plugins/memory/lib/.
 */
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { createLogger } from '../../src/core/logger'
import { getContentDir } from '@bakin/core/content-dir'
import { join } from 'path'
import { MemoryIndexer } from './lib/indexer'
import { definePlugin } from '@bakin/core/routing'
import { auditRoute } from './lib/routes/audit'
import { durableListRoute, durableDetailRoute } from './lib/routes/durable'
import {
  dailyNotesListRoute,
  dailyNotesDetailRoute,
  dailyNotesCompareSearchRoute,
} from './lib/routes/daily-notes'
import {
  sessionsListRoute,
  sessionDetailRoute,
  sessionTurnsRoute,
  turnsListRoute,
} from './lib/routes/sessions'
import { checkpointsListRoute, checkpointDetailRoute } from './lib/routes/checkpoints'
import { dreamsListRoute, dreamDetailRoute } from './lib/routes/dreams'
import { statusRoute } from './lib/routes/status'
import { recentRoute } from './lib/routes/recent'
import { cleanupFindRoute, cleanupDispatchRoute, cleanupVerifyRoute } from './lib/routes/cleanup'
import { createMemorySearchTool } from './mcp/search'
import { createMemoryGetSessionTool } from './mcp/get-session'
import { createMemoryGetTurnTool } from './mcp/get-turn'
import { createMemoryListAgentsTool } from './mcp/list-agents'
import { createMemoryStatusTool } from './mcp/status'
import { migrateIfNeeded } from './lib/memory-migration'
import { resetAllOffsets } from './lib/offsets'
import type { MemoryTier } from './lib/types'
import { startTtlTimer, stopTtlTimer } from './lib/ttl-prune'
import { checkSearchTables } from './lib/health-checks'

const log = createLogger('memory')

interface MemorySettings {
  backfillDays: number
  skipSessionOverBytes: number
  skipResetBackups: boolean
  runtimeComparisonEnabled: boolean
  turnRetentionDays: number
  auditRetentionDays: number
}

/** Every tier the initial backfill and full reindex derive from source. */
const MEMORY_BACKFILL_TIERS: readonly MemoryTier[] = [
  'audit',
  'durable',
  'daily_note',
  'session',
  'turn',
  'checkpoint',
  'dream',
]

const DEFAULTS: MemorySettings = {
  backfillDays: 30,
  skipSessionOverBytes: 10 * 1024 * 1024,
  skipResetBackups: true,
  runtimeComparisonEnabled: true,
  turnRetentionDays: 7,
  auditRetentionDays: 30,
}

// onReady needs access to the per-activation indexer. Keep module-level
// handles so the lifecycle hook can find what activate() just built, and
// so watcher events can short-circuit until the table is guaranteed to
// exist.
let deferredBackfill: (() => Promise<void>) | null = null
let activeIndexer: MemoryIndexer | null = null
let ready = false
let eventDisposers: Array<() => void> = []

function clearEventSubscriptions(): void {
  for (const dispose of eventDisposers) {
    dispose()
  }
  eventDisposers = []
}

const routes = [
  auditRoute,
  durableListRoute,
  durableDetailRoute,
  dailyNotesListRoute,
  dailyNotesDetailRoute,
  dailyNotesCompareSearchRoute,
  sessionsListRoute,
  sessionDetailRoute,
  sessionTurnsRoute,
  turnsListRoute,
  checkpointsListRoute,
  checkpointDetailRoute,
  dreamsListRoute,
  dreamDetailRoute,
  statusRoute,
  recentRoute,
  cleanupFindRoute,
  cleanupDispatchRoute,
  cleanupVerifyRoute,
]

const memoryPlugin: BakinPlugin = definePlugin({
  id: 'memory',
  name: 'Memory',
  version: '2.0.0',
  routes,

  settingsSchema: {
    fields: [
      {
        key: 'backfillDays',
        type: 'number',
        label: 'Backfill window (days)',
        description: 'On first activation, index this many days of history across all tiers.',
        default: DEFAULTS.backfillDays,
      },
      {
        key: 'skipSessionOverBytes',
        type: 'number',
        label: 'Skip sessions over (bytes)',
        description: 'Transcripts larger than this are skipped to keep the indexer responsive.',
        default: DEFAULTS.skipSessionOverBytes,
      },
      {
        key: 'skipResetBackups',
        type: 'boolean',
        label: 'Skip .reset backup transcripts',
        description: 'Historical reset backups are not live state; skip by default.',
        default: DEFAULTS.skipResetBackups,
      },
      {
        key: 'runtimeComparisonEnabled',
        type: 'boolean',
        label: 'Compare against runtime recall',
        description: 'Show runtime daily-note recall alongside Bakin search results.',
        default: DEFAULTS.runtimeComparisonEnabled,
      },
      {
        key: 'turnRetentionDays',
        type: 'number',
        label: 'Turn retention (days)',
        description: 'Turns older than this are dropped at write time and pruned daily. The runtime still owns the source transcript.',
        default: DEFAULTS.turnRetentionDays,
      },
      {
        key: 'auditRetentionDays',
        type: 'number',
        label: 'Audit retention (days)',
        description: 'Audit rows older than this are dropped at write time and pruned daily.',
        default: DEFAULTS.auditRetentionDays,
      },
    ],
  },

  navItems: [
    { id: 'memory', label: 'Memory', icon: 'Brain', href: '/memory', order: 40 },
  ],

  contentFiles: [],

  async activate(ctx: PluginContext) {
    clearEventSubscriptions()

    const settings = { ...DEFAULTS, ...(ctx.getSettings<Partial<MemorySettings>>() ?? {}) }

    // ─── Indexer ────────────────────────────────────────────────────────────
    const indexer = new MemoryIndexer(ctx, {
      backfillDays: settings.backfillDays,
      skipSessionOverBytes: settings.skipSessionOverBytes,
      skipResetBackups: settings.skipResetBackups,
      turnRetentionDays: settings.turnRetentionDays,
      auditRetentionDays: settings.auditRetentionDays,
    })
    activeIndexer = indexer

    // ─── Search: unified bakin_memory table ─────────────────────────────────
    ctx.search.registerContentType({
      table: 'memory',
      schema: {
        tier: { type: 'keyword' },
        agent: { type: 'keyword' },
        kind: { type: 'keyword' },
        eventType: { type: 'keyword' },
        phase: { type: 'keyword' },
        date: { type: 'keyword' },
        sessionId: { type: 'keyword' },
        title: { type: 'text' },
        snippet: { type: 'text' },
        content: { type: 'text' },
        meta: { type: 'text' },
        source_backend: { type: 'keyword' },
        source_path: { type: 'keyword' },
        updated_at: { type: 'datetime' },
        created_at: { type: 'datetime' },
      },
      searchableFields: ['title', 'snippet', 'content'],
      rerankField: 'content',
      embeddingTemplate: '{{tier}} {{agent}} {{title}} {{snippet}}',
      facets: ['tier', 'agent', 'kind', 'eventType', 'phase', 'date'],
      reindex: async function* () {
        // Memory rows are derived from source files through the indexer
        // (per-tier parsers, TTL filters, persisted byte offsets) rather than
        // a stream of {key, doc} rows, so a reindex resets the incremental
        // state and re-derives everything, REWRITING every row (rewriteAll
        // bypasses the write dedupe — a reindex must repair drifted row
        // content, not just fill gaps). Rows are written directly via
        // ctx.search.index as a side effect and nothing is yielded, so the
        // reindex progress UI reports 0 for this table by design. Without
        // this, `bakin reindex` could never repopulate bakin_memory after a
        // table loss.
        resetAllOffsets()
        indexer.invalidateIndexedCache()
        await indexer.backfill(MEMORY_BACKFILL_TIERS, { rewriteAll: true })
      },
      verifyExists: async () => true,
    })

    // ─── Routes ─────────────────────────────────────────────────────────────
    // Routes are declared at module scope on plugin.routes (T11). The plugin
    // loader registers them into state.routes before activate() runs.

    // ─── MCP exec tools (spec §Feature 10) ──────────────────────────────────
    ctx.registerExecTool(createMemorySearchTool(ctx))
    ctx.registerExecTool(createMemoryGetSessionTool(ctx))
    ctx.registerExecTool(createMemoryGetTurnTool(ctx))
    ctx.registerExecTool(createMemoryListAgentsTool(ctx))
    ctx.registerExecTool(createMemoryStatusTool(ctx))

    // ─── Watcher paths (spec §Watcher paths) ────────────────────────────────
    // Provider-owned paths are supplied by the runtime adapter; this plugin
    // only contributes Bakin's own audit log path.
    const watchPaths = [
      join(getContentDir(), 'audit.jsonl'),
      ...(await ctx.runtime.memory.watchPaths()),
    ]
    ctx.watchFiles(watchPaths)

    // Fan watcher events into the indexer. BakinEventBus handlers receive
    // (event, data) where data = { file, event, content }. Core's watcher
    // only covers Bakin-owned files; runtime filesystem watching for
    // provider-owned tiers is owned by the indexer itself.
    // Events that fire before onReady() would hit a missing table, so we
    // gate them behind the same ready flag as the initial backfill.
    eventDisposers.push(ctx.events.on('file.add', (_event, data) => {
      if (!ready) return
      void indexer.handleWatcherEvent(String(data.file ?? ''), 'add')
    }))
    eventDisposers.push(ctx.events.on('file.change', (_event, data) => {
      if (!ready) return
      void indexer.handleWatcherEvent(String(data.file ?? ''), 'change')
    }))
    eventDisposers.push(ctx.events.on('file.unlink', (_event, data) => {
      if (!ready) return
      void indexer.handleWatcherEvent(String(data.file ?? ''), 'unlink')
    }))

    // Defer the initial backfill until onReady(). activate() runs BEFORE
    // createRegisteredTables() in server.ts, so writes issued here would
    // silently fail ("Endpoint not found: /api/v1/tables/bakin_memory/batch")
    // while offsets still advanced — that exact race once produced an empty
    // dashboard on every subsequent boot (Apr 2026 incident). onReady() is
    // the first lifecycle hook that is guaranteed to fire after tables exist.
    deferredBackfill = async () => {
      // Boot may proceed past a slow/wedged search bootstrap (bounded boot
      // budget). Writing before tables exist silently drops rows while byte
      // offsets advance — the failure that once produced a permanently empty
      // dashboard — so wait for the bootstrap to actually settle first.
      if (ctx.search.whenReady && !await ctx.search.whenReady()) {
        log.warn('search bootstrap never became ready — skipping memory backfill this boot (offsets untouched; next boot retries)')
        return
      }

      // Per-plugin schema migration. Bumping MEMORY_SCHEMA_VERSION drops the
      // table + clears offsets so the backfill below re-derives everything
      // under the current write-time filters (TTL, parser rules, etc.). Runs
      // before backfill so the freshly-recreated table is what gets written.
      try {
        const { migrated, from, to } = await migrateIfNeeded(ctx.search)
        if (migrated) {
          log.info('memory schema migrated', { from, to })
          // The table was dropped and recreated: any dedupe cache loaded from
          // the pre-drop table would make the backfill skip every row.
          indexer.invalidateIndexedCache()
        }
      } catch (err) {
        log.warn('memory migration failed — proceeding with backfill anyway', {
          err: err instanceof Error ? err.message : String(err),
        })
      }

      // Watcher events stay gated until the migration decided the table's
      // fate — an event racing the drop would seed the indexer's dedupe cache
      // from the doomed table and the backfill would then skip every row,
      // leaving memory empty until the next restart.
      ready = true

      try {
        await indexer.backfill(MEMORY_BACKFILL_TIERS)
      } catch (err) {
        log.warn('initial backfill failed', {
          err: err instanceof Error ? err.message : String(err),
        })
      }

      // TTL prune: timer only — first run ~1h after boot, then daily. No
      // boot-time one-shot: pruning is a full-table scan, boot is when antfly
      // is busiest converging, and write-time TTL filtering (isExpired in the
      // indexer) already keeps expired rows from being (re)written during the
      // backfill that just ran.
      startTtlTimer(ctx.search, {
        turnRetentionDays: settings.turnRetentionDays,
        auditRetentionDays: settings.auditRetentionDays,
      })
      // Runtime memory watcher paths are the live-update path. Runtime-native
      // subscriptions can be added to the adapter contract if another backend
      // needs push events that do not map to files.
    }

    // ─── Health check (migrated out of core/doctor.ts per #139 C5) ──────
    ctx.registerHealthCheck({
      id: 'search-tables',
      name: 'Search table stats',
      run: () => checkSearchTables(ctx.search.health?.bind(ctx.search)),
    })

    log.info('memory plugin activated', {
      backfillDays: settings.backfillDays,
      watchPaths: watchPaths.length,
    })
  },

  async onReady() {
    const run = deferredBackfill
    deferredBackfill = null
    if (!run) {
      ready = true
      return
    }
    // Fire-and-forget — onReady awaits each plugin sequentially, and the
    // audit+durable+daily-note tiers can take several seconds on a warm
    // install. Blocking startup behind them is a bad trade. `ready` flips
    // inside run() once the schema migration has settled (see the race note
    // there); watcher events arriving earlier are dropped, same as pre-boot.
    void run()
  },

  async onShutdown() {
    ready = false
    deferredBackfill = null
    // Snapshot the dedupe cache with everything the watcher wrote since the
    // backfill's save — the next boot's count validation then accepts it.
    activeIndexer?.persistIndexedCache()
    activeIndexer = null
    clearEventSubscriptions()
    stopTtlTimer()
  },
}) as unknown as BakinPlugin

export default memoryPlugin
