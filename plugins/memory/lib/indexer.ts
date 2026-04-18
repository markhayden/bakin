/**
 * MemoryIndexer — skeleton.
 *
 * Owns the bakin_memory table's entire write path. Per-tier logic lands in
 * C3 (audit) → C4 (durable) → C5 (daily notes) → C6 (session + turn) →
 * C7 (checkpoint) → C8 (dream). This file stays small and is the single
 * place that orchestrates backfill, incremental append, and watcher events.
 *
 * Dependencies injected by the plugin shell (not imported as modules) so
 * tests can swap in fakes without deep mocking.
 */
import type { PluginContext } from '../../../src/lib/plugin-types'
import { createLogger } from '../../../src/core/logger'
import type { MemoryTier } from './types'

const log = createLogger('memory:indexer')

export interface IndexerOptions {
  backfillDays?: number
  skipSessionOverBytes?: number
  skipResetBackups?: boolean
}

export class MemoryIndexer {
  constructor(
    private readonly ctx: PluginContext,
    private readonly opts: IndexerOptions = {},
  ) {}

  /**
   * Full backfill across the selected tiers. Called once on plugin activation.
   * No-op until per-tier implementations land (C3+).
   */
  async backfill(tiers: readonly MemoryTier[] = []): Promise<void> {
    log.debug('backfill requested', { tiers, opts: this.opts })
    // Implemented per tier starting in C3.
  }

  /**
   * Reindex a single tier for a single agent (or all agents when omitted).
   */
  async indexTier(tier: MemoryTier, agent?: string): Promise<void> {
    log.debug('indexTier requested', { tier, agent })
    // Implemented per tier starting in C3.
  }

  /**
   * Respond to a watcher event (add/change/unlink). Filesystem path routing
   * to the correct tier lives here so the plugin shell stays dumb.
   */
  async handleWatcherEvent(path: string, kind: 'add' | 'change' | 'unlink'): Promise<void> {
    log.debug('watcher event', { path, kind })
    // Routing table filled in by subsequent commits.
  }
}
