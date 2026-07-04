/**
 * Memory plugin settings — single source for the defaults and for deriving
 * MemoryIndexer options, shared by activate() and any route that needs a
 * fresh indexer (e.g. /record). Keeping this out of index.ts avoids a
 * routes → index import cycle.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import type { IndexerOptions } from './indexer'

export interface MemorySettings {
  backfillDays: number
  skipSessionOverBytes: number
  skipResetBackups: boolean
  runtimeComparisonEnabled: boolean
  turnRetentionDays: number
  auditRetentionDays: number
}

export const DEFAULTS: MemorySettings = {
  backfillDays: 30,
  skipSessionOverBytes: 10 * 1024 * 1024,
  skipResetBackups: true,
  runtimeComparisonEnabled: true,
  turnRetentionDays: 7,
  auditRetentionDays: 30,
}

export function resolveSettings(ctx: PluginContext): MemorySettings {
  return { ...DEFAULTS, ...(ctx.getSettings<Partial<MemorySettings>>() ?? {}) }
}

/** The subset of settings the indexer consumes — THE one mapping, used by
 *  both activate() and the /record route. */
export function indexerOptionsFrom(settings: MemorySettings): IndexerOptions {
  return {
    backfillDays: settings.backfillDays,
    skipSessionOverBytes: settings.skipSessionOverBytes,
    skipResetBackups: settings.skipResetBackups,
    turnRetentionDays: settings.turnRetentionDays,
    auditRetentionDays: settings.auditRetentionDays,
  }
}

export function resolveIndexerOptions(ctx: PluginContext): IndexerOptions {
  return indexerOptionsFrom(resolveSettings(ctx))
}
