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
import { recordRoute } from './lib/routes/record'
import { cleanupFindRoute, cleanupDispatchRoute, cleanupVerifyRoute } from './lib/routes/cleanup'
import { createMemorySearchTool } from './mcp/search'
import { createMemoryGetSessionTool } from './mcp/get-session'
import { createMemoryGetTurnTool } from './mcp/get-turn'
import { createMemoryListAgentsTool } from './mcp/list-agents'
import { createMemoryStatusTool } from './mcp/status'
import { DEFAULTS, indexerOptionsFrom, resolveSettings } from './lib/settings'
import { startTtlTimer, stopTtlTimer } from './lib/ttl-prune'

const log = createLogger('memory')

// onReady needs access to the per-activation indexer. Keep module-level
// handles so the lifecycle hook can find what activate() just built, and
// so watcher events can short-circuit until the table is guaranteed to
// exist.
let deferredBackfill: (() => Promise<void>) | null = null
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
  recordRoute,
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

    const settings = resolveSettings(ctx)

    // ─── Indexer ────────────────────────────────────────────────────────────
    const indexer = new MemoryIndexer(ctx, indexerOptionsFrom(settings))

    // ─── Search: unified bakin_memory table ─────────────────────────────────
    ctx.search.registerContentType({
      table: 'memory',
      schemaVersion: 1,
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
        // Blue/green backfill source: the side-effect-free enumerator
        // re-derives every row from source files WITHOUT touching offsets
        // or live state. MUST fail loudly when the MEMORY surface is down —
        // non-audit tiers read through ctx.runtime.memory, and silently
        // yielding nothing would let a thin green table converge and flip.
        // Probe the surface enumeration actually needs, NOT ping(): on Pi,
        // ping is a turn-serveability (credential) probe while memory reads
        // are credential-free local files — a credential-less Pi install can
        // serve a complete backfill and must not park forever.
        try {
          await ctx.runtime.memory.listTiers()
        } catch (err) {
          throw new Error(
            `runtime memory surface unavailable — memory backfill would be incomplete; migration stays parked (${err instanceof Error ? err.message : String(err)})`,
          )
        }
        yield* indexer.enumerateAll()
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

    // No boot backfill (D5/D6): initial population is the blue/green
    // create-time seeding via reindex(); live updates ride the watcher
    // tailer through the outbox; offline growth is the doctor's stat-sweep.
    // TTL prune stays timer-only (first run ~1h after boot, then daily).
    deferredBackfill = async () => {
      ready = true
      startTtlTimer(ctx.search, {
        turnRetentionDays: settings.turnRetentionDays,
        auditRetentionDays: settings.auditRetentionDays,
      })
    }

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
    clearEventSubscriptions()
    stopTtlTimer()
  },
})

export default memoryPlugin
