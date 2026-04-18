/**
 * MemoryIndexer — writes rows into the `bakin_memory` Antfly table.
 *
 * Owns the table's entire write path across all tiers. Per-tier logic grows
 * commit by commit: C3 audit, C4 durable, C5 daily-notes, C6 session+turn,
 * C7 checkpoint, C8 dream. This file stays as one class so routing from
 * watcher events to the right tier indexer happens in one place.
 *
 * Dependencies are injected via `PluginContext` so tests can swap in fakes
 * without deep mocking.
 */
import { closeSync, existsSync, openSync, readSync, statSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@bakin/core/content-dir'
import type { PluginContext } from '../../../src/lib/plugin-types'
import { createLogger } from '../../../src/core/logger'
import type { MemoryRow, MemoryTier } from './types'
import { parseAuditLine } from './tier-parsers/audit-parser'
import { getOffset, setOffset } from './offsets'

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

  async backfill(tiers: readonly MemoryTier[] = []): Promise<void> {
    log.debug('backfill requested', { tiers, opts: this.opts })
    for (const tier of tiers) {
      await this.indexTier(tier)
    }
  }

  async indexTier(tier: MemoryTier, _agent?: string): Promise<void> {
    if (tier === 'audit') {
      await this.indexAuditTier()
      return
    }
    // C4+ tiers land in subsequent commits.
  }

  async handleWatcherEvent(path: string, kind: 'add' | 'change' | 'unlink'): Promise<void> {
    const auditPath = this.auditPath()
    if (path === auditPath) {
      if (kind === 'unlink') {
        setOffset(auditPath, 0)
        return
      }
      await this.indexAuditTier()
      return
    }
    // Other tiers add routing here in C4+.
  }

  // ─── Audit tier (C3) ──────────────────────────────────────────────────────

  private auditPath(): string {
    return join(getContentDir(), 'audit.jsonl')
  }

  private async indexAuditTier(): Promise<number> {
    const file = this.auditPath()
    if (!existsSync(file)) return 0

    const stats = statSync(file)
    let offset = getOffset(file)

    if (stats.size < offset) {
      log.info('audit.jsonl shrank — restarting from offset 0', {
        previous: offset,
        current: stats.size,
      })
      offset = 0
    }
    if (stats.size === offset) return 0

    const bytesToRead = stats.size - offset
    const buf = Buffer.alloc(bytesToRead)
    const fd = openSync(file, 'r')
    try {
      readSync(fd, buf, 0, bytesToRead, offset)
    } finally {
      closeSync(fd)
    }

    const text = buf.toString('utf-8')
    const rawLines = text.split('\n')
    // If the chunk ended mid-line (no trailing newline), keep that fragment
    // for the next pass — don't parse partial JSON.
    const trailingIncomplete = text.endsWith('\n') ? '' : (rawLines.pop() ?? '')

    let lineStart = offset
    let indexed = 0
    for (const line of rawLines) {
      const row = parseAuditLine(line, file, lineStart)
      if (row) {
        await this.writeRow(row)
        indexed += 1
      }
      lineStart += Buffer.byteLength(line, 'utf-8') + 1 // +1 for the '\n'
    }

    const newOffset = stats.size - Buffer.byteLength(trailingIncomplete, 'utf-8')
    setOffset(file, newOffset)
    return indexed
  }

  private async writeRow(row: MemoryRow): Promise<void> {
    const doc: Record<string, unknown> = {
      tier: row.tier,
      agent: row.agent,
      title: row.title,
      snippet: row.snippet,
      content: row.content,
      meta: row.meta,
      source_backend: row.sourceRef.backend,
      source_path: row.sourceRef.path,
      updated_at: row.updatedAt,
      created_at: row.createdAt,
    }
    await this.ctx.search.index(row.id, doc)
  }
}
