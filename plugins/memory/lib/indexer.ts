/**
 * MemoryIndexer — writes rows into the `bakin_memory` search table.
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
import type { RuntimeMemoryEntry } from '@bakin/core/adapters/runtime'
import type { PluginContext } from '@bakin/core/plugin-types'
import { createLogger } from '../../../src/core/logger'
import type { MemoryRow, MemoryTier } from './types'
import { parseAuditLine } from './tier-parsers/audit-parser'
import { parseDurableFile, rowId as durableRowId } from './tier-parsers/durable-parser'
import { parseSkillFile, rowId as skillRowId } from './tier-parsers/skill-parser'
import { parseDailyNote, rowId as dailyNoteRowId } from './tier-parsers/daily-note-parser'
import { parseSession, rowId as sessionRowId } from './tier-parsers/session-parser'
import { parseTurnLine } from './tier-parsers/turn-parser'
import { parseCheckpoint, rowId as checkpointRowId } from './tier-parsers/checkpoint-parser'
import {
  classifyDreamSignal,
  parsePhaseDoc,
  parseDreamSignal,
  rowId as dreamRowId,
} from './tier-parsers/dream-parser'
import {
  CANONICAL_DURABLE_FILES,
} from './durable-kinds'
import {
  entryMtimeMs,
  entrySizeBytes,
  getRuntimeMemoryEntry,
  listRuntimeMemoryEntries,
  metadataBoolean,
  metadataString,
  resolvedSourceKind,
} from './runtime-memory'
import { getOffset, setOffset } from './offsets'

const DEFAULT_SKIP_SESSION_BYTES = 10 * 1024 * 1024
const HEAD_CHUNK_BYTES = 4 * 1024 * 1024
const HEAD_CHUNK_MAX_ROWS = 2000
const DAY_MS = 86_400_000

const log = createLogger('memory:indexer')

export interface IndexerOptions {
  backfillDays?: number
  skipSessionOverBytes?: number
  skipResetBackups?: boolean
  /** Drop turn rows older than this many days at write time. 0/undefined = keep all. */
  turnRetentionDays?: number
  /** Drop audit rows older than this many days at write time. 0/undefined = keep all. */
  auditRetentionDays?: number
}

export class MemoryIndexer {
  private indexedUpdatedAt: Map<string, number> | null = null
  private indexedUpdatedAtLoad: Promise<void> | null = null

  constructor(
    private readonly ctx: PluginContext,
    private readonly opts: IndexerOptions = {},
  ) {}

  async backfill(tiers: readonly MemoryTier[] = []): Promise<void> {
    log.debug('backfill requested', { tiers, opts: this.opts })
    await this.ensureIndexedUpdatedAt()
    for (const tier of tiers) {
      await this.indexTier(tier)
    }
  }

  /**
   * Drop the indexed-updatedAt dedupe cache so the next write reloads it from
   * the live table. MUST be called whenever table contents were reset
   * underneath this indexer (schema migration, resetContentType, reindex) —
   * a stale cache makes writeRow() skip every row and the table stays empty
   * until restart.
   */
  invalidateIndexedCache(): void {
    this.indexedUpdatedAt = null
    this.indexedUpdatedAtLoad = null
  }

  private async ensureIndexedUpdatedAt(): Promise<Map<string, number>> {
    if (this.indexedUpdatedAt) return this.indexedUpdatedAt
    if (!this.indexedUpdatedAtLoad) {
      this.indexedUpdatedAtLoad = this.loadIndexedUpdatedAt()
    }
    await this.indexedUpdatedAtLoad
    return this.indexedUpdatedAt ?? new Map()
  }

  private async loadIndexedUpdatedAt(): Promise<void> {
    const indexed = new Map<string, number>()
    this.indexedUpdatedAt = indexed
    const maintenance = this.ctx.search.maintenance
    if (!maintenance || !await maintenance.available()) return
    try {
      for await (const { key, document } of maintenance.scan({ fields: ['updated_at'] })) {
        const updatedAt = Number(document.updated_at ?? 0)
        if (Number.isFinite(updatedAt)) indexed.set(key, updatedAt)
      }
    } catch (err) {
      log.warn('existing memory index scan failed; backfill will write rows conservatively', {
        err: err instanceof Error ? err.message : String(err),
      })
      indexed.clear()
    }
  }

  async indexTier(tier: MemoryTier): Promise<void> {
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
    if (tier === 'dream') {
      await this.indexDreamTier()
      return
    }
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

    const match = await this.ctx.runtime.memory.resolvePath(path)
    if (!match?.agentId) return
    const sourceKind = resolvedSourceKind(match)
    if (!sourceKind) return

    if (sourceKind === 'durable') {
      const basename = metadataString(match, 'basename') ?? match.id
      if (kind === 'unlink') await this.removeDurableFile(match.agentId, basename)
      else await this.indexDurableFile(match.agentId, basename)
      return
    }

    if (sourceKind === 'skill') {
      const skillName = metadataString(match, 'skillName') ?? match.id
      if (kind === 'unlink') await this.removeSkillFile(match.agentId, skillName)
      else await this.indexSkillFile(match.agentId, skillName)
      return
    }

    if (sourceKind === 'daily_note') {
      const filename = metadataString(match, 'filename') ?? match.id
      if (kind === 'unlink') await this.removeDailyNote(match.agentId, filename)
      else await this.indexDailyNote(match.agentId, filename)
      return
    }

    if (sourceKind === 'session_store') {
      if (kind !== 'unlink') await this.indexSessionsForAgent(match.agentId)
      return
    }

    if (sourceKind === 'session_jsonl') {
      if (metadataBoolean(match, 'isReset')) return
      if (kind === 'unlink') {
        setOffset(path, 0)
        return
      }
      const stat = await this.ctx.runtime.memory.statEntry(match.tierId, match.id, { agentId: match.agentId })
      if (!stat) return
      await this.indexSessionJsonl(match.agentId, match.id, match.tierId, match.path, stat.size)
      return
    }

    if (sourceKind === 'checkpoint') {
      const sessionId = metadataString(match, 'sessionId')
      const checkpointId = metadataString(match, 'checkpointId')
      const filename = metadataString(match, 'filename') ?? match.id
      if (!sessionId || !checkpointId) return
      if (kind === 'unlink') {
        await this.removeCheckpointFile(match.agentId, sessionId, checkpointId)
      } else {
        await this.indexCheckpointFile(match.agentId, sessionId, checkpointId, filename)
      }
      return
    }

    if (sourceKind === 'dream_phase') {
      const phase = metadataString(match, 'phase')
      const filename = metadataString(match, 'filename')
      if (!phase || !filename) return
      if (kind === 'unlink') await this.removePhaseDoc(match.agentId, phase, filename)
      else await this.indexPhaseDoc(match.agentId, phase, filename)
      return
    }

    if (sourceKind === 'dream_signal') {
      const relPath = metadataString(match, 'relPath') ?? match.id
      if (kind === 'unlink') await this.removeDreamSignal(match.agentId, relPath)
      else await this.indexDreamSignal(match.agentId, relPath)
    }
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

  private async listRuntimeAgentIds(): Promise<string[]> {
    return (await this.ctx.runtime.agents.list()).map((agent) => agent.id)
  }

  private durableKey(agent: string, basename: string): string {
    return `${agent}::${basename}`
  }

  private async indexDurableTier(): Promise<void> {
    for (const agent of await this.listRuntimeAgentIds()) {
      for (const basename of CANONICAL_DURABLE_FILES) {
        await this.indexDurableFile(agent, basename)
      }
      await this.indexSkillsForAgent(agent)
    }
  }

  private async indexDurableFile(agent: string, basename: string): Promise<void> {
    const entry = await getRuntimeMemoryEntry(this.ctx, 'durable', basename, agent)
    if (!entry) return

    const rows = parseDurableFile(agent, basename, entry.content, entry.path ?? basename, entryMtimeMs(entry))

    const prevCount = this.lastDurableChunkCount.get(this.durableKey(agent, basename)) ?? 0
    if (rows.length < prevCount) {
      for (let i = rows.length; i < prevCount; i += 1) {
        await this.removeRow(durableRowId(agent, basename, i))
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
      await this.removeRow(durableRowId(agent, basename, i))
    }
    this.lastDurableChunkCount.delete(this.durableKey(agent, basename))
  }

  // ─── Skills (sub-flavor of durable, kind=skill) ───────────────────────────

  private readonly lastSkillChunkCount = new Map<string, number>()

  private skillKey(agent: string, skillName: string): string {
    return `${agent}::skill::${skillName}`
  }

  private async indexSkillsForAgent(agent: string): Promise<void> {
    const files = await listRuntimeMemoryEntries(this.ctx, 'skill', agent)
    const seen = new Set<string>()
    for (const file of files) {
      seen.add(file.id)
      await this.indexSkillFile(agent, file.id)
    }
    // Drop chunks for skills the agent removed between passes. Scan the
    // chunk-count map for this agent and tombstone any key not seen above.
    const prefix = `${agent}::skill::`
    for (const key of Array.from(this.lastSkillChunkCount.keys())) {
      if (!key.startsWith(prefix)) continue
      const skillName = key.slice(prefix.length)
      if (seen.has(skillName)) continue
      await this.removeSkillFile(agent, skillName)
    }
  }

  private async indexSkillFile(agent: string, skillName: string): Promise<void> {
    const entry = await getRuntimeMemoryEntry(this.ctx, 'skill', skillName, agent)
    if (!entry) return

    const rows = parseSkillFile(agent, skillName, entry.content, entry.path ?? skillName, entryMtimeMs(entry))

    const prevCount = this.lastSkillChunkCount.get(this.skillKey(agent, skillName)) ?? 0
    if (rows.length < prevCount) {
      for (let i = rows.length; i < prevCount; i += 1) {
        await this.removeRow(skillRowId(agent, skillName, i))
      }
    }

    for (const row of rows) {
      await this.writeRow(row)
    }
    this.lastSkillChunkCount.set(this.skillKey(agent, skillName), rows.length)
  }

  private async removeSkillFile(agent: string, skillName: string): Promise<void> {
    const count = this.lastSkillChunkCount.get(this.skillKey(agent, skillName)) ?? 0
    for (let i = 0; i < count; i += 1) {
      await this.removeRow(skillRowId(agent, skillName, i))
    }
    this.lastSkillChunkCount.delete(this.skillKey(agent, skillName))
  }

  // ─── Daily-note tier (C5) ─────────────────────────────────────────────────

  private async indexDailyNoteTier(): Promise<void> {
    for (const agent of await this.listRuntimeAgentIds()) {
      for (const entry of await listRuntimeMemoryEntries(this.ctx, 'daily_note', agent)) {
        await this.indexDailyNote(agent, entry.id)
      }
    }
  }

  private async indexDailyNote(agent: string, filename: string): Promise<void> {
    const entry = await getRuntimeMemoryEntry(this.ctx, 'daily_note', filename, agent)
    if (!entry) return

    const row = parseDailyNote(
      agent,
      filename,
      entry.content,
      entry.path ?? filename,
      entryMtimeMs(entry),
      entrySizeBytes(entry),
    )
    if (row === null) return
    await this.writeRow(row)
  }

  private async removeDailyNote(agent: string, filename: string): Promise<void> {
    await this.removeRow(dailyNoteRowId(agent, filename))
  }

  // ─── Session tier (C6) ────────────────────────────────────────────────────

  private readonly lastSessionKeys = new Map<string, Set<string>>()

  private async indexSessionTier(): Promise<void> {
    for (const agent of await this.listRuntimeAgentIds()) {
      await this.indexSessionsForAgent(agent)
    }
  }

  private async indexSessionsForAgent(agent: string): Promise<void> {
    const loaded = await this.loadSessionMap(agent)
    if (loaded === null) return

    const cutoff = this.backfillCutoffMs()
    const srcPath = loaded.sourcePath
    const seen = new Set<string>()

    for (const [key, value] of Object.entries(loaded.map)) {
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
        await this.removeRow(sessionRowId(agent, prevKey))
      }
    }
    this.lastSessionKeys.set(agent, seen)
  }

  private async loadSessionMap(agent: string): Promise<{ map: Record<string, unknown>; sourcePath: string } | null> {
    const entry = await getRuntimeMemoryEntry(this.ctx, 'session_store', 'sessions.json', agent)
    if (!entry) return null
    try {
      const parsed = JSON.parse(entry.content) as unknown
      const map = this.extractSessionMap(parsed)
      if (map) return { map, sourcePath: entry.path ?? `runtime:${agent}:sessions.json` }
    } catch (err) {
      log.debug('session store parse failed', {
        agent,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    return null
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
    for (const agent of await this.listRuntimeAgentIds()) {
      for (const file of await listRuntimeMemoryEntries(this.ctx, 'session_jsonl', agent)) {
        if (metadataBoolean(file, 'isReset')) continue
        await this.indexSessionJsonl(
          agent,
          metadataString(file, 'sessionId') ?? file.id,
          file.tierId,
          file.path ?? `runtime:${file.tierId}:${agent}:${file.id}`,
          entrySizeBytes(file),
        )
      }
    }
  }

  private async indexSessionJsonl(
    agent: string,
    sessionId: string,
    tierId: string,
    path: string,
    reportedSize: number,
  ): Promise<void> {
    const sessionKey = `agent:${agent}:${sessionId}`
    const threshold = this.opts.skipSessionOverBytes ?? DEFAULT_SKIP_SESSION_BYTES
    if (reportedSize > threshold) {
      await this.indexSessionJsonlHead(agent, sessionId, sessionKey, tierId)
      return
    }
    await this.indexSessionJsonlIncremental(agent, sessionId, sessionKey, tierId, path)
  }

  private async indexSessionJsonlHead(
    agent: string,
    sessionId: string,
    sessionKey: string,
    tierId: string,
  ): Promise<void> {
    const stat = await this.ctx.runtime.memory.statEntry(tierId, sessionId, { agentId: agent })
    if (!stat) return
    const readBytes = Math.min(stat.size, HEAD_CHUNK_BYTES)
    const range = await this.ctx.runtime.memory.readEntryRange(tierId, sessionId, {
      agentId: agent,
      offset: 0,
      length: readBytes,
    })
    if (!range) return
    const text = range.content
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
    tierId: string,
    path: string,
  ): Promise<void> {
    const stats = await this.ctx.runtime.memory.statEntry(tierId, sessionId, { agentId: agent })
    if (!stats) return
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
    const range = await this.ctx.runtime.memory.readEntryRange(tierId, sessionId, {
      agentId: agent,
      offset,
      length: bytesToRead,
    })
    if (!range) return
    const text = range.content
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
    for (const agent of await this.listRuntimeAgentIds()) {
      for (const file of await listRuntimeMemoryEntries(this.ctx, 'checkpoint', agent)) {
        const sessionId = metadataString(file, 'sessionId')
        const checkpointId = metadataString(file, 'checkpointId')
        const filename = metadataString(file, 'filename') ?? file.id
        if (!sessionId || !checkpointId) continue
        await this.indexCheckpointFile(
          agent,
          sessionId,
          checkpointId,
          filename,
        )
      }
    }
  }

  private async indexCheckpointFile(
    agent: string,
    sessionId: string,
    checkpointId: string,
    filename: string,
  ): Promise<void> {
    const entry = await getRuntimeMemoryEntry(this.ctx, 'checkpoint', filename, agent)
    if (!entry) return
    const row = parseCheckpoint(
      agent,
      sessionId,
      checkpointId,
      filename,
      entry.content,
      entry.path ?? filename,
      entryMtimeMs(entry),
    )
    if (row === null) return
    await this.writeRow(row)
  }

  private async removeCheckpointFile(
    agent: string,
    sessionId: string,
    checkpointId: string,
  ): Promise<void> {
    await this.removeRow(checkpointRowId(agent, sessionId, checkpointId))
  }

  // ─── Dream tier (C8) ──────────────────────────────────────────────────────

  private async indexDreamTier(): Promise<void> {
    for (const agent of await this.listRuntimeAgentIds()) {
      for (const file of await listRuntimeMemoryEntries(this.ctx, 'dream_phase', agent)) {
        const phase = metadataString(file, 'phase')
        const filename = metadataString(file, 'filename')
        if (!phase || !filename) continue
        await this.indexPhaseDoc(agent, phase, filename)
      }
      for (const file of await listRuntimeMemoryEntries(this.ctx, 'dream_signal', agent)) {
        const relPath = metadataString(file, 'relPath') ?? file.id
        await this.indexDreamSignal(agent, relPath)
      }
    }
  }

  private async indexPhaseDoc(
    agent: string,
    phase: string,
    filename: string,
    knownEntry?: RuntimeMemoryEntry,
  ): Promise<void> {
    const entry = knownEntry ?? await getRuntimeMemoryEntry(this.ctx, 'dream_phase', `${phase}/${filename}`, agent)
    if (!entry) return
    const row = parsePhaseDoc(agent, phase, filename, entry.content, entry.path ?? `${phase}/${filename}`, entryMtimeMs(entry))
    if (row === null) return
    await this.writeRow(row)
  }

  private async indexDreamSignal(
    agent: string,
    relPath: string,
    knownEntry?: RuntimeMemoryEntry,
  ): Promise<void> {
    const entry = knownEntry ?? await getRuntimeMemoryEntry(this.ctx, 'dream_signal', relPath, agent)
    if (!entry) return
    const row = parseDreamSignal(agent, relPath, entry.content, entry.path ?? relPath, entryMtimeMs(entry))
    if (row === null) return
    await this.writeRow(row)
  }

  private async removePhaseDoc(agent: string, phase: string, filename: string): Promise<void> {
    const m = /^(\d{4}-\d{2}-\d{2})(?:[-.].*)?\.md$/.exec(filename)
    if (!m) return
    const date = m[1]
    await this.removeRow(dreamRowId(agent, 'phase_doc', `${phase}|${date}`))
  }

  private async removeDreamSignal(agent: string, relPath: string): Promise<void> {
    const c = classifyDreamSignal(relPath)
    if (!c) return
    const key = c.date ?? c.artifactType
    await this.removeRow(dreamRowId(agent, c.artifactType, key))
  }

  // ─── Shared write ─────────────────────────────────────────────────────────

  /**
   * TTL filter. Returns true when the row is older than the tier's retention
   * window and should be skipped at write time. Turns hit this aggressively
   * (default 7d) because they dominate the table; audits get 30d because the
   * operational log is cheap and useful for longer incident forensics.
   * Tiers with no retention configured always pass.
   */
  private isExpired(row: MemoryRow): boolean {
    const days = this.retentionDays(row.tier)
    if (!days || days <= 0) return false
    if (!Number.isFinite(row.updatedAt) || row.updatedAt <= 0) return false
    return row.updatedAt < Date.now() - days * DAY_MS
  }

  private retentionDays(tier: MemoryTier): number | undefined {
    if (tier === 'turn') return this.opts.turnRetentionDays
    if (tier === 'audit') return this.opts.auditRetentionDays
    return undefined
  }

  private async writeRow(row: MemoryRow): Promise<void> {
    if (this.isExpired(row)) return
    const indexedUpdatedAt = await this.ensureIndexedUpdatedAt()
    const existingUpdatedAt = indexedUpdatedAt.get(row.id)
    if (existingUpdatedAt !== undefined && existingUpdatedAt >= row.updatedAt) return
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
    if (row.kind !== undefined) doc.kind = row.kind
    // Promote sessionId out of the meta JSON blob into a real filterable
    // field: "turns/checkpoints for session X" can only work as a filter —
    // meta is not a searchable field, so a q=sessionId full-text match over
    // title/snippet/content never matched anything.
    if (row.sourceRef.sessionId) doc.sessionId = row.sourceRef.sessionId
    await this.ctx.search.index(row.id, doc)
    indexedUpdatedAt.set(row.id, row.updatedAt)
  }

  private async removeRow(key: string): Promise<void> {
    await this.ctx.search.remove(key)
    this.indexedUpdatedAt?.delete(key)
  }
}
