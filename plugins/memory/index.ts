/**
 * Memory plugin — server entry point (v2 rebuild, C2).
 *
 * Read-only observability over every OpenClaw memory tier plus Bakin's own
 * audit log, surfaced through a single `bakin_memory` Antfly table. Per-tier
 * routes, UI, and indexer logic land in subsequent commits (C3–C8).
 *
 * This file deliberately stays small: it (a) registers the `bakin_memory`
 * content type, (b) constructs the MemoryIndexer and hooks watcher events
 * into it, (c) wires the BakinCreate watch list. All tier-specific code
 * lives under plugins/memory/lib/.
 */
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { createLogger } from '../../src/core/logger'
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import { getContentDir } from '@bakin/core/content-dir'
import { join } from 'path'
import { MemoryIndexer } from './lib/indexer'

const log = createLogger('memory')

interface MemorySettings {
  backfillDays: number
  skipSessionOverBytes: number
  skipResetBackups: boolean
  lanceDbComparisonEnabled: boolean
}

const DEFAULTS: MemorySettings = {
  backfillDays: 30,
  skipSessionOverBytes: 10 * 1024 * 1024,
  skipResetBackups: true,
  lanceDbComparisonEnabled: true,
}

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
    ],
  },

  navItems: [
    { id: 'memory', label: 'Memory', icon: 'Brain', href: '/memory', order: 40 },
  ],

  contentFiles: [],

  activate(ctx: PluginContext) {
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

    // ─── Indexer (skeleton — real work ships in C3+) ────────────────────────
    const indexer = new MemoryIndexer(ctx, {
      backfillDays: settings.backfillDays,
      skipSessionOverBytes: settings.skipSessionOverBytes,
      skipResetBackups: settings.skipResetBackups,
    })

    // ─── Watcher paths (spec §Watcher paths) ────────────────────────────────
    // The indexer fans these out to per-tier handlers once those land.
    const watchPaths = [
      // Bakin side
      join(getContentDir(), 'audit.jsonl'),
      // OpenClaw: session identity
      getOpenClawPath('agents', '*', 'sessions', 'sessions.json'),
      // Transcripts + checkpoints live side-by-side under sessions/
      getOpenClawPath('agents', '*', 'sessions', '*.jsonl'),
      // Durable bootstrap files (main-agent workspace + subagent workspaces)
      getOpenClawPath('workspace', '*.md'),
      getOpenClawPath('workspaces', '*', '*.md'),
      // Daily notes + dream artifacts
      getOpenClawPath('workspace', 'memory', '**', '*'),
      getOpenClawPath('workspaces', '*', 'memory', '**', '*'),
    ]
    ctx.watchFiles(watchPaths)

    // Fan watcher events into the indexer. BakinEventBus handlers receive
    // (event, data) where data = { file, event, content }. Core's watcher
    // only covers ~/.bakin/ — OpenClaw filesystem watching for the tiers
    // under ~/.openclaw/ is owned by the indexer itself (lands in C3+).
    ctx.events.on('file.add', (_event, data) => {
      void indexer.handleWatcherEvent(String(data.file ?? ''), 'add')
    })
    ctx.events.on('file.change', (_event, data) => {
      void indexer.handleWatcherEvent(String(data.file ?? ''), 'change')
    })
    ctx.events.on('file.unlink', (_event, data) => {
      void indexer.handleWatcherEvent(String(data.file ?? ''), 'unlink')
    })

    // First-activate backfill runs in the background; indexer no-ops until C3+.
    void indexer.backfill().catch((err) => {
      log.warn('initial backfill failed', { err: err instanceof Error ? err.message : String(err) })
    })

    log.info('memory plugin activated', {
      backfillDays: settings.backfillDays,
      watchPaths: watchPaths.length,
    })
  },
}

export default memoryPlugin
