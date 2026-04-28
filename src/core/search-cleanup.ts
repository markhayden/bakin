/**
 * Search cleanup — periodic orphan BACKSTOP scan.
 *
 * The primary path for keeping search indexes in sync with the
 * filesystem is the watcher unlink hook (see search-registry.ts —
 * registerFileBackedContentType wires this automatically). This
 * scan only catches the rare cases where the watcher missed an event:
 * the process was down during a delete, the fs event was lost, etc.
 *
 * Default cadence is 7d (settings.search.settings.cleanupInterval) — long
 * because it's a backstop, not the main consistency mechanism.
 *
 * Scans search tables and checks each document against its plugin's
 * verifyExists() callback. Removes orphans that no longer exist at source.
 */
import { createLogger } from './logger'
import { getSettings } from './settings'
import { getContentTypes, getSearchAdapter } from './search-registry'

const log = createLogger('search-cleanup')

// ---------------------------------------------------------------------------
// Singleton timer (globalThis-backed)
// ---------------------------------------------------------------------------
const _g = globalThis as typeof globalThis & {
  __bakinSearchCleanupTimer?: ReturnType<typeof setInterval> | null
  __bakinSearchCleanupRunning?: boolean
}

export interface CleanupStats {
  table: string
  scanned: number
  orphans: number
  errors: number
}

/**
 * Run orphan cleanup across all registered content types.
 * Scans each table and checks verifyExists() for every document.
 */
export async function runCleanup(): Promise<CleanupStats[]> {
  if (_g.__bakinSearchCleanupRunning) {
    log.info('Cleanup already running — skipping')
    return []
  }

  _g.__bakinSearchCleanupRunning = true
  const allStats: CleanupStats[] = []

  try {
    const contentTypes = getContentTypes()
    const search = getSearchAdapter()
    if (!await search.available()) return []

    for (const [tableName, def] of contentTypes) {
      const stats: CleanupStats = { table: tableName, scanned: 0, orphans: 0, errors: 0 }

      try {
        const orphanKeys: string[] = []

        for await (const { key } of search.scan(tableName)) {
          stats.scanned++

          try {
            const exists = await def.verifyExists(key)
            if (!exists) {
              orphanKeys.push(key)
              stats.orphans++
            }
          } catch {
            stats.errors++
          }

          // Batch remove every 100 orphans to avoid accumulating too much
          if (orphanKeys.length >= 100) {
            await search.documents.batchRemove(tableName, orphanKeys.splice(0))
          }
        }

        // Remove remaining orphans
        if (orphanKeys.length > 0) {
          await search.documents.batchRemove(tableName, orphanKeys)
        }

        if (stats.orphans > 0) {
          log.info(`Backstop scan: ${tableName} — removed ${stats.orphans} orphans of ${stats.scanned} scanned`)
        }
      } catch (err) {
        log.error(`Cleanup failed for ${tableName}`, err)
        stats.errors++
      }

      allStats.push(stats)
    }

    return allStats
  } finally {
    _g.__bakinSearchCleanupRunning = false
  }
}

/**
 * Parse a Go-style duration string to milliseconds.
 * Supports: '24h', '12h', '90d', '30m', etc.
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) return 24 * 60 * 60 * 1000 // default 24h

  const value = parseInt(match[1], 10)
  switch (match[2]) {
    case 'ms': return value
    case 's': return value * 1000
    case 'm': return value * 60 * 1000
    case 'h': return value * 60 * 60 * 1000
    case 'd': return value * 24 * 60 * 60 * 1000
    default: return 24 * 60 * 60 * 1000
  }
}

/**
 * Start periodic orphan cleanup.
 * Interval is configured via settings.search.settings.cleanupInterval.
 */
export function startCleanupTimer(): void {
  if (_g.__bakinSearchCleanupTimer) return

  const settings = getSettings()
  const searchSettings = settings.search.settings
  if (!searchSettings.enabled) return

  const intervalMs = parseDuration(searchSettings.cleanupInterval)

  _g.__bakinSearchCleanupTimer = setInterval(() => {
    runCleanup().catch(err => {
      log.error('Periodic cleanup failed', err)
    })
  }, intervalMs)

  log.info(`Orphan backstop scan scheduled (interval: ${searchSettings.cleanupInterval}) — primary path is the watcher unlink hook`)
}

/**
 * Stop periodic cleanup.
 */
export function stopCleanupTimer(): void {
  if (_g.__bakinSearchCleanupTimer) {
    clearInterval(_g.__bakinSearchCleanupTimer)
    _g.__bakinSearchCleanupTimer = null
    log.info('Orphan backstop scan stopped')
  }
}
