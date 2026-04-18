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
import { parseDurableFile, rowId as durableRowId } from './tier-parsers/durable-parser'
import { parseDailyNote, rowId as dailyNoteRowId } from './tier-parsers/daily-note-parser'
import { parseSession, rowId as sessionRowId } from './tier-parsers/session-parser'
import { parseTurnLine } from './tier-parsers/turn-parser'
import { parseCheckpoint, rowId as checkpointRowId } from './tier-parsers/checkpoint-parser'
import {
  CANONICAL_DURABLE_FILES,
  checkpointJsonlStat,
  dailyNotePath,
  dailyNoteMtime,
  dailyNoteSize,
  durableFilePath,
  listAgentIds,
  listCheckpointJsonlFiles,
  listDailyNotes,
  listSessionJsonlFiles,
  matchCheckpointJsonlPath,
  matchDailyNotePath,
  matchDurablePath,
  matchSessionJsonlPath,
  matchSessionStorePath,
  readCheckpoint,
  readDailyNote,
  readDurableFile,
  readSessionStore,
  sessionJsonlStat,
  sessionStorePath,
} from './openclaw-adapter'
import { gatewayCall } from './openclaw-gateway'
import { getOffset, setOffset } from './offsets'

const DEFAULT_SKIP_SESSION_BYTES = 10 * 1024 * 1024
const HEAD_CHUNK_BYTES = 4 * 1024 * 1024
const HEAD_CHUNK_MAX_ROWS = 2000

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
    if (tier === 'durable') {
      await this.indexDurableTier()
      return
    }
    if (tier === 'daily_note') {
      await this.indexDailyNoteTier()
      return
    }
    if (tier === 'session') {
      await this.indexSessionTier()
      return
    }
    if (tier === 'turn') {
      await this.indexTurnTier()
      return
    }
    if (tier === 'checkpoint') {
      await this.indexCheckpointTier()
      return
    }
    // C8+ tiers land in subsequent commits.
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

    const durable = matchDurablePath(path)
    if (durable) {
      if (kind === 'unlink') {
        await this.removeDurableFile(durable.agent, durable.basename)
      } else {
        await this.indexDurableFile(durable.agent, durable.basename)
      }
      return
    }

    const daily = matchDailyNotePath(path)
    if (daily) {
      if (kind === 'unlink') {
        await this.removeDailyNote(daily.agent, daily.filename)
      } else {
        await this.indexDailyNote(daily.agent, daily.filename)
      }
      return
    }

    const sessionStore = matchSessionStorePath(path)
    if (sessionStore) {
      if (kind !== 'unlink') await this.indexSessionsForAgent(sessionStore.agent)
      return
    }

    const sessionJsonl = matchSessionJsonlPath(path)
    if (sessionJsonl) {
      if (sessionJsonl.isReset) return
      if (kind === 'unlink') {
        setOffset(path, 0)
        return
      }
      const stat = sessionJsonlStat(path)
      if (!stat) return
      await this.indexSessionJsonl(sessionJsonl.agent, sessionJsonl.sessionId, path, stat.size)
      return
    }

    const checkpoint = matchCheckpointJsonlPath(path)
    if (checkpoint) {
      if (kind === 'unlink') {
        await this.removeCheckpointFile(checkpoint.agent, checkpoint.sessionId, checkpoint.checkpointId)
      } else {
        await this.indexCheckpointFile(
          checkpoint.agent,
          checkpoint.sessionId,
          checkpoint.checkpointId,
          checkpoint.filename,
          path,
        )
      }
      return
    }
    // Other tiers add routing here in C8+.
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

  // ─── Durable tier (C4) ────────────────────────────────────────────────────

  private readonly lastDurableChunkCount = new Map<string, number>()

  private durableKey(agent: string, basename: string): string {
    return `${agent}::${basename}`
  }

  private async indexDurableTier(): Promise<void> {
    for (const agent of listAgentIds()) {
      for (const basename of CANONICAL_DURABLE_FILES) {
        await this.indexDurableFile(agent, basename)
      }
    }
  }

  private async indexDurableFile(agent: string, basename: string): Promise<void> {
    const body = readDurableFile(agent, basename)
    if (body === null) return

    const path = durableFilePath(agent, basename)
    let mtimeMs = Date.now()
    try {
      if (existsSync(path)) mtimeMs = statSync(path).mtimeMs
    } catch { /* keep fallback */ }

    const rows = parseDurableFile(agent, basename, body, path, mtimeMs)

    const prevCount = this.lastDurableChunkCount.get(this.durableKey(agent, basename)) ?? 0
    if (rows.length < prevCount) {
      for (let i = rows.length; i < prevCount; i += 1) {
        await this.ctx.search.remove(durableRowId(agent, basename, i))
      }
    }

    for (const row of rows) {
      await this.writeRow(row)
    }
    this.lastDurableChunkCount.set(this.durableKey(agent, basename), rows.length)
  }

  private async removeDurableFile(agent: string, basename: string): Promise<void> {
    const count = this.lastDurableChunkCount.get(this.durableKey(agent, basename)) ?? 0
    for (let i = 0; i < count; i += 1) {
      await this.ctx.search.remove(durableRowId(agent, basename, i))
    }
    this.lastDurableChunkCount.delete(this.durableKey(agent, basename))
  }

  // ─── Daily-note tier (C5) ─────────────────────────────────────────────────

  private async indexDailyNoteTier(): Promise<void> {
    for (const agent of listAgentIds()) {
      for (const filename of listDailyNotes(agent)) {
        await this.indexDailyNote(agent, filename)
      }
    }
  }

  private async indexDailyNote(agent: string, filename: string): Promise<void> {
    const body = readDailyNote(agent, filename)
    if (body === null) return
    const path = dailyNotePath(agent, filename)
    const mtimeMs = dailyNoteMtime(agent, filename) ?? Date.now()
    const sizeBytes = dailyNoteSize(agent, filename)

    const row = parseDailyNote(agent, filename, body, path, mtimeMs, sizeBytes)
    if (row === null) return
    await this.writeRow(row)
  }

  private async removeDailyNote(agent: string, filename: string): Promise<void> {
    await this.ctx.search.remove(dailyNoteRowId(agent, filename))
  }

  // ─── Session tier (C6) ────────────────────────────────────────────────────

  private readonly lastSessionKeys = new Map<string, Set<string>>()

  private async indexSessionTier(): Promise<void> {
    for (const agent of listAgentIds()) {
      await this.indexSessionsForAgent(agent)
    }
  }

  private async indexSessionsForAgent(agent: string): Promise<void> {
    const raw = await this.loadSessionMap(agent)
    if (raw === null) return

    const cutoff = this.backfillCutoffMs()
    const srcPath = sessionStorePath(agent)
    const seen = new Set<string>()

    for (const [key, value] of Object.entries(raw)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const s = value as Record<string, unknown>
      const updatedAt = typeof s.updatedAt === 'number' ? s.updatedAt : null
      if (cutoff !== null && updatedAt !== null && updatedAt < cutoff) continue
      const row = parseSession(agent, key, value, srcPath)
      if (row) {
        await this.writeRow(row)
        seen.add(key)
      }
    }

    const prev = this.lastSessionKeys.get(agent) ?? new Set<string>()
    for (const prevKey of prev) {
      if (!seen.has(prevKey)) {
        await this.ctx.search.remove(sessionRowId(agent, prevKey))
      }
    }
    this.lastSessionKeys.set(agent, seen)
  }

  private async loadSessionMap(agent: string): Promise<Record<string, unknown> | null> {
    try {
      const resp = await gatewayCall<unknown>('sessions.list', { agentId: agent })
      const map = this.extractSessionMap(resp)
      if (map) return map
    } catch (err) {
      log.debug('session gateway failed, falling back to FS', {
        agent,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    const fs = readSessionStore(agent)
    if (!fs || typeof fs !== 'object' || Array.isArray(fs)) return null
    return fs as Record<string, unknown>
  }

  private extractSessionMap(resp: unknown): Record<string, unknown> | null {
    if (!resp || typeof resp !== 'object' || Array.isArray(resp)) return null
    const r = resp as Record<string, unknown>
    const nested = r.sessions
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Record<string, unknown>
    }
    return r
  }

  private backfillCutoffMs(): number | null {
    const days = this.opts.backfillDays
    if (typeof days !== 'number' || days <= 0) return null
    return Date.now() - days * 86_400_000
  }

  // ─── Turn tier (C6) ───────────────────────────────────────────────────────

  private async indexTurnTier(): Promise<void> {
    for (const agent of listAgentIds()) {
      for (const file of listSessionJsonlFiles(agent)) {
        if (file.isReset) continue
        await this.indexSessionJsonl(agent, file.sessionId, file.path, file.size)
      }
    }
  }

  private async indexSessionJsonl(
    agent: string,
    sessionId: string,
    path: string,
    reportedSize: number,
  ): Promise<void> {
    if (!existsSync(path)) return
    const sessionKey = `agent:${agent}:${sessionId}`
    const threshold = this.opts.skipSessionOverBytes ?? DEFAULT_SKIP_SESSION_BYTES
    if (reportedSize > threshold) {
      await this.indexSessionJsonlHead(agent, sessionId, sessionKey, path)
      return
    }
    await this.indexSessionJsonlIncremental(agent, sessionId, sessionKey, path)
  }

  private async indexSessionJsonlHead(
    agent: string,
    sessionId: string,
    sessionKey: string,
    path: string,
  ): Promise<void> {
    const realSize = statSync(path).size
    const readBytes = Math.min(realSize, HEAD_CHUNK_BYTES)
    const buf = Buffer.alloc(readBytes)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buf, 0, readBytes, 0)
    } finally {
      closeSync(fd)
    }
    const text = buf.toString('utf-8')
    const rawLines = text.split('\n')
    if (!text.endsWith('\n')) rawLines.pop()

    let lineStart = 0
    let indexed = 0
    for (const line of rawLines) {
      if (indexed >= HEAD_CHUNK_MAX_ROWS) break
      const row = parseTurnLine(agent, sessionId, sessionKey, line, lineStart)
      if (row) {
        await this.writeRow(row)
        indexed += 1
      }
      lineStart += Buffer.byteLength(line, 'utf-8') + 1
    }
    log.info('session jsonl oversize — indexed head-only', { agent, sessionId, indexed })
  }

  private async indexSessionJsonlIncremental(
    agent: string,
    sessionId: string,
    sessionKey: string,
    path: string,
  ): Promise<void> {
    const stats = statSync(path)
    let offset = getOffset(path)
    if (stats.size < offset) {
      log.info('session jsonl shrank — restarting from offset 0', {
        path,
        previous: offset,
        current: stats.size,
      })
      offset = 0
    }
    if (stats.size === offset) return

    const bytesToRead = stats.size - offset
    const buf = Buffer.alloc(bytesToRead)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buf, 0, bytesToRead, offset)
    } finally {
      closeSync(fd)
    }
    const text = buf.toString('utf-8')
    const rawLines = text.split('\n')
    const trailingIncomplete = text.endsWith('\n') ? '' : (rawLines.pop() ?? '')

    let lineStart = offset
    for (const line of rawLines) {
      const row = parseTurnLine(agent, sessionId, sessionKey, line, lineStart)
      if (row) await this.writeRow(row)
      lineStart += Buffer.byteLength(line, 'utf-8') + 1
    }

    const newOffset = stats.size - Buffer.byteLength(trailingIncomplete, 'utf-8')
    setOffset(path, newOffset)
  }

  // ─── Checkpoint tier (C7) ─────────────────────────────────────────────────

  private async indexCheckpointTier(): Promise<void> {
    for (const agent of listAgentIds()) {
      for (const file of listCheckpointJsonlFiles(agent)) {
        await this.indexCheckpointFile(
          agent,
          file.sessionId,
          file.checkpointId,
          file.filename,
          file.path,
        )
      }
    }
  }

  private async indexCheckpointFile(
    agent: string,
    sessionId: string,
    checkpointId: string,
    filename: string,
    path: string,
  ): Promise<void> {
    const body = readCheckpoint(agent, filename)
    if (body === null) return
    const mtimeMs = checkpointJsonlStat(path)?.mtimeMs ?? Date.now()
    const row = parseCheckpoint(agent, sessionId, checkpointId, filename, body, path, mtimeMs)
    if (row === null) return
    await this.writeRow(row)
  }

  private async removeCheckpointFile(
    agent: string,
    sessionId: string,
    checkpointId: string,
  ): Promise<void> {
    await this.ctx.search.remove(checkpointRowId(agent, sessionId, checkpointId))
  }

  // ─── Shared write ─────────────────────────────────────────────────────────

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
