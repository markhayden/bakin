/**
 * Memory plugin — server entry point (v2 rebuild, C2).
 *
 * Read-only observability over every OpenClaw memory tier plus Bakin's own
 * audit log, surfaced through a single `bakin_memory` search table. Per-tier
 * routes, UI, and indexer logic land in subsequent commits (C3–C8).
 *
 * This file deliberately stays small: it (a) registers the `bakin_memory`
 * content type, (b) constructs the MemoryIndexer and hooks watcher events
 * into it, (c) wires the BakinCreate watch list. All tier-specific code
 * lives under plugins/memory/lib/.
 */
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { createLogger } from '../../src/core/logger'
import { getContentDir } from '@bakin/core/content-dir'
import { join } from 'path'
import { MemoryIndexer } from './lib/indexer'
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
import { createMemorySearchTool } from './mcp/search'
import { createMemoryGetSessionTool } from './mcp/get-session'
import { createMemoryGetTurnTool } from './mcp/get-turn'
import { createMemoryListAgentsTool } from './mcp/list-agents'
import { createMemoryStatusTool } from './mcp/status'
import { migrateIfNeeded } from './lib/memory-migration'
import { pruneExpired, startTtlTimer, stopTtlTimer } from './lib/ttl-prune'
import { checkSearchTables } from './lib/health-checks'

const log = createLogger('memory')

interface MemorySettings {
  backfillDays: number
  skipSessionOverBytes: number
  skipResetBackups: boolean
  lanceDbComparisonEnabled: boolean
  turnRetentionDays: number
  auditRetentionDays: number
}

const DEFAULTS: MemorySettings = {
  backfillDays: 30,
  skipSessionOverBytes: 10 * 1024 * 1024,
  skipResetBackups: true,
  lanceDbComparisonEnabled: true,
  turnRetentionDays: 7,
  auditRetentionDays: 30,
}

// onReady needs access to the per-activation indexer. Keep module-level
// handles so the lifecycle hook can find what activate() just built, and
// so watcher events can short-circuit until the table is guaranteed to
// exist.
let deferredBackfill: (() => Promise<void>) | null = null
let ready = false

const memoryPlugin: BakinPlugin = {
  id: 'memory',
  name: 'Memory',
  version: '2.0.0',

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
        key: 'lanceDbComparisonEnabled',
        type: 'boolean',
        label: 'Compare against LanceDB recall',
        description: 'Show OpenClaw daily-note vector recall alongside Antfly results.',
        default: DEFAULTS.lanceDbComparisonEnabled,
      },
      {
        key: 'turnRetentionDays',
        type: 'number',
        label: 'Turn retention (days)',
        description: 'Turns older than this are dropped at write time and pruned daily. OpenClaw still owns the source JSONL.',
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
    const settings = { ...DEFAULTS, ...(ctx.getSettings<Partial<MemorySettings>>() ?? {}) }

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
        // Per-tier reindex streams land in C3–C8. For now there's nothing
        // to yield — the table exists but stays empty until a later commit
        // wires its first tier.
      },
      verifyExists: async () => true,
    })

    // ─── Indexer ────────────────────────────────────────────────────────────
    const indexer = new MemoryIndexer(ctx, {
      backfillDays: settings.backfillDays,
      skipSessionOverBytes: settings.skipSessionOverBytes,
      skipResetBackups: settings.skipResetBackups,
      turnRetentionDays: settings.turnRetentionDays,
      auditRetentionDays: settings.auditRetentionDays,
    })

    // ─── Routes ─────────────────────────────────────────────────────────────
    ctx.registerRoute(auditRoute)
    ctx.registerRoute(durableListRoute)
    ctx.registerRoute(durableDetailRoute)
    ctx.registerRoute(dailyNotesListRoute)
    ctx.registerRoute(dailyNotesDetailRoute)
    ctx.registerRoute(dailyNotesCompareSearchRoute)
    ctx.registerRoute(sessionsListRoute)
    ctx.registerRoute(sessionDetailRoute)
    ctx.registerRoute(sessionTurnsRoute)
    ctx.registerRoute(turnsListRoute)
    ctx.registerRoute(checkpointsListRoute)
    ctx.registerRoute(checkpointDetailRoute)
    ctx.registerRoute(dreamsListRoute)
    ctx.registerRoute(dreamDetailRoute)
    ctx.registerRoute(statusRoute)
    ctx.registerRoute(recentRoute)

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
    ctx.events.on('file.add', (_event, data) => {
      if (!ready) return
      void indexer.handleWatcherEvent(String(data.file ?? ''), 'add')
    })
    ctx.events.on('file.change', (_event, data) => {
      if (!ready) return
      void indexer.handleWatcherEvent(String(data.file ?? ''), 'change')
    })
    ctx.events.on('file.unlink', (_event, data) => {
      if (!ready) return
      void indexer.handleWatcherEvent(String(data.file ?? ''), 'unlink')
    })

    // Defer the initial backfill until onReady(). activate() runs BEFORE
    // createRegisteredTables() in server.ts, so writes issued here would
    // silently fail ("Endpoint not found: /api/v1/tables/bakin_memory/batch")
    // while offsets still advanced — that exact race once produced an empty
    // dashboard on every subsequent boot (Apr 2026 incident). onReady() is
    // the first lifecycle hook that is guaranteed to fire after tables exist.
    deferredBackfill = async () => {
      // Per-plugin schema migration. Bumping MEMORY_SCHEMA_VERSION drops the
      // table + clears offsets so the backfill below re-derives everything
      // under the current write-time filters (TTL, parser rules, etc.). Runs
      // before backfill so the freshly-recreated table is what gets written.
      try {
        const { migrated, from, to } = await migrateIfNeeded()
        if (migrated) log.info('memory schema migrated', { from, to })
      } catch (err) {
        log.warn('memory migration failed — proceeding with backfill anyway', {
          err: err instanceof Error ? err.message : String(err),
        })
      }

      try {
        await indexer.backfill([
          'audit',
          'durable',
          'daily_note',
          'session',
          'turn',
          'checkpoint',
          'dream',
        ])
      } catch (err) {
        log.warn('initial backfill failed', {
          err: err instanceof Error ? err.message : String(err),
        })
      }

      // TTL prune: arm the daily timer first so a slow initial prune can't
      // block the recurring one, then fire the one-shot prune. The one-shot
      // catches rows older than the window that slipped through via edge-case
      // write paths; after that, the daily timer handles ongoing aging.
      const ttl = {
        turnRetentionDays: settings.turnRetentionDays,
        auditRetentionDays: settings.auditRetentionDays,
      }
      startTtlTimer(ttl)
      try {
        await pruneExpired(ttl)
      } catch (err) {
        log.warn('initial ttl prune failed', {
          err: err instanceof Error ? err.message : String(err),
        })
      }
      // Runtime memory watcher paths are the live-update path. Runtime-native
      // subscriptions can be added to the adapter contract if another backend
      // needs push events that do not map to files.
    }

    // ─── Health check (migrated out of core/doctor.ts per #139 C5) ──────
    ctx.registerHealthCheck({
      id: 'search-tables',
      name: 'Search table stats',
      run: () => checkSearchTables(),
    })

    log.info('memory plugin activated', {
      backfillDays: settings.backfillDays,
      watchPaths: watchPaths.length,
    })
  },

  async onReady() {
    ready = true
    const run = deferredBackfill
    deferredBackfill = null
    if (!run) return
    // Fire-and-forget — onReady awaits each plugin sequentially, and the
    // audit+durable+daily-note tiers can take several seconds on a warm
    // install. Blocking startup behind them is a bad trade.
    void run()
  },

  async onShutdown() {
    ready = false
    deferredBackfill = null
    stopTtlTimer()
  },
}

export default memoryPlugin
