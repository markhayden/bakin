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
import { MEMORY_TIERS } from './types'
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

/**
 * Build the search document for a memory row. Shared by the live write path
 * (`writeRow`) and the side-effect-free enumerator (`enumerateAll`) so a
 * blue/green backfill emits exactly the docs the live path writes.
 */
export function buildMemoryDoc(row: MemoryRow): Record<string, unknown> {
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
  return doc
}

interface JsonlChunk {
  rows: MemoryRow[]
  /** Byte offset just past the last complete line consumed from the chunk. */
  newOffset: number
}

/**
 * Parse a chunk of JSONL text whose first byte sits at `startOffset` in the
 * source file. A trailing partial line (chunk ended mid-write, no '\n') is
 * excluded from both the rows and `newOffset` so an incremental pass
 * re-reads it next time. `maxRows` caps parsed rows (head-only indexing of
 * oversize sessions).
 */
function parseJsonlChunk(
  text: string,
  startOffset: number,
  parseLine: (line: string, lineStart: number) => MemoryRow | null,
  maxRows?: number,
): JsonlChunk {
  const rawLines = text.split('\n')
  // If the chunk ended mid-line (no trailing newline), keep that fragment
  // for the next pass — don't parse partial JSON.
  const trailingIncomplete = text.endsWith('\n') ? '' : (rawLines.pop() ?? '')

  const rows: MemoryRow[] = []
  let lineStart = startOffset
  for (const line of rawLines) {
    if (maxRows !== undefined && rows.length >= maxRows) break
    const row = parseLine(line, lineStart)
    if (row) rows.push(row)
    lineStart += Buffer.byteLength(line, 'utf-8') + 1 // +1 for the '\n'
  }

  const newOffset =
    startOffset + Buffer.byteLength(text, 'utf-8') - Buffer.byteLength(trailingIncomplete, 'utf-8')
  return { rows, newOffset }
}

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
  private backfillInFlight: Promise<void> | null = null

  constructor(
    private readonly ctx: PluginContext,
    private readonly opts: IndexerOptions = {},
  ) {}

  /**
   * Index the given tiers. Whole-corpus passes SERIALIZE: overlapping runs
   * would interleave offset resets with in-flight offset advances and share
   * the chunk-count maps. Every row is written unconditionally — the search
   * outbox's acked-hash dedupe drops unchanged content downstream.
   */
  async backfill(tiers: readonly MemoryTier[] = []): Promise<void> {
    while (this.backfillInFlight) {
      await this.backfillInFlight.catch(() => {})
    }
    const run = this.runBackfill(tiers)
    this.backfillInFlight = run
    try {
      await run
    } finally {
      if (this.backfillInFlight === run) this.backfillInFlight = null
    }
  }

  private async runBackfill(tiers: readonly MemoryTier[]): Promise<void> {
    log.debug('backfill requested', { tiers, opts: this.opts })
    for (const tier of tiers) {
      await this.indexTier(tier)
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
    const chunk = this.collectAuditRows(getOffset(file))
    if (!chunk) return 0

    for (const row of chunk.rows) {
      await this.writeRow(row)
    }
    setOffset(file, chunk.newOffset)
    return chunk.rows.length
  }

  /**
   * Read audit.jsonl from `startOffset` and parse rows. Pure w.r.t. persisted
   * state — no offset reads/writes — shared by the live incremental path and
   * `enumerateAll` (which passes offset 0). Returns null when there is
   * nothing to consume (missing file / no new bytes), so the live path can
   * skip its offset write exactly as before.
   */
  private collectAuditRows(startOffset: number): JsonlChunk | null {
    const file = this.auditPath()
    if (!existsSync(file)) return null

    const stats = statSync(file)
    let offset = startOffset
    if (stats.size < offset) {
      log.info('audit.jsonl shrank — restarting from offset 0', {
        previous: offset,
        current: stats.size,
      })
      offset = 0
    }
    if (stats.size === offset) return null

    const bytesToRead = stats.size - offset
    const buf = Buffer.alloc(bytesToRead)
    const fd = openSync(file, 'r')
    try {
      readSync(fd, buf, 0, bytesToRead, offset)
    } finally {
      closeSync(fd)
    }

    return parseJsonlChunk(buf.toString('utf-8'), offset, (line, lineStart) =>
      parseAuditLine(line, file, lineStart),
    )
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

  /** Fetch + parse one durable file. Null when the entry is missing. */
  private async collectDurableFileRows(agent: string, basename: string): Promise<MemoryRow[] | null> {
    const entry = await getRuntimeMemoryEntry(this.ctx, 'durable', basename, agent)
    if (!entry) return null
    return parseDurableFile(agent, basename, entry.content, entry.path ?? basename, entryMtimeMs(entry))
  }

  private async indexDurableFile(agent: string, basename: string): Promise<void> {
    const rows = await this.collectDurableFileRows(agent, basename)
    if (rows === null) return

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

  /** Fetch + parse one skill file. Null when the entry is missing. */
  private async collectSkillFileRows(agent: string, skillName: string): Promise<MemoryRow[] | null> {
    const entry = await getRuntimeMemoryEntry(this.ctx, 'skill', skillName, agent)
    if (!entry) return null
    return parseSkillFile(agent, skillName, entry.content, entry.path ?? skillName, entryMtimeMs(entry))
  }

  private async indexSkillFile(agent: string, skillName: string): Promise<void> {
    const rows = await this.collectSkillFileRows(agent, skillName)
    if (rows === null) return

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

  /** Fetch + parse one daily note. Null when missing or not a daily-note filename. */
  private async collectDailyNoteRow(agent: string, filename: string): Promise<MemoryRow | null> {
    const entry = await getRuntimeMemoryEntry(this.ctx, 'daily_note', filename, agent)
    if (!entry) return null
    return parseDailyNote(
      agent,
      filename,
      entry.content,
      entry.path ?? filename,
      entryMtimeMs(entry),
      entrySizeBytes(entry),
    )
  }

  private async indexDailyNote(agent: string, filename: string): Promise<void> {
    const row = await this.collectDailyNoteRow(agent, filename)
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

  /**
   * Load + parse the agent's session roster, applying the backfill cutoff.
   * Returns the session-map key alongside each row because the live path
   * tracks roster membership by key for orphan removal. Null when the
   * roster is missing/unparseable.
   */
  private async collectSessionRows(agent: string): Promise<Array<{ key: string; row: MemoryRow }> | null> {
    const loaded = await this.loadSessionMap(agent)
    if (loaded === null) return null

    const cutoff = this.backfillCutoffMs()
    const collected: Array<{ key: string; row: MemoryRow }> = []
    for (const [key, value] of Object.entries(loaded.map)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const s = value as Record<string, unknown>
      const updatedAt = typeof s.updatedAt === 'number' ? s.updatedAt : null
      if (cutoff !== null && updatedAt !== null && updatedAt < cutoff) continue
      const row = parseSession(agent, key, value, loaded.sourcePath)
      if (row) collected.push({ key, row })
    }
    return collected
  }

  private async indexSessionsForAgent(agent: string): Promise<void> {
    const collected = await this.collectSessionRows(agent)
    if (collected === null) return

    const seen = new Set<string>()
    for (const { key, row } of collected) {
      await this.writeRow(row)
      seen.add(key)
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

  /**
   * Head-only parse of an oversize session JSONL: first HEAD_CHUNK_BYTES,
   * capped at HEAD_CHUNK_MAX_ROWS parsed rows. Pure w.r.t. persisted state;
   * shared by the live path and `enumerateAll`. Null when the entry is gone.
   */
  private async collectSessionJsonlHeadRows(
    agent: string,
    sessionId: string,
    sessionKey: string,
    tierId: string,
  ): Promise<MemoryRow[] | null> {
    const stat = await this.ctx.runtime.memory.statEntry(tierId, sessionId, { agentId: agent })
    if (!stat) return null
    const readBytes = Math.min(stat.size, HEAD_CHUNK_BYTES)
    const range = await this.ctx.runtime.memory.readEntryRange(tierId, sessionId, {
      agentId: agent,
      offset: 0,
      length: readBytes,
    })
    if (!range) return null
    const chunk = parseJsonlChunk(
      range.content,
      0,
      (line, lineStart) => parseTurnLine(agent, sessionId, sessionKey, line, lineStart),
      HEAD_CHUNK_MAX_ROWS,
    )
    return chunk.rows
  }

  private async indexSessionJsonlHead(
    agent: string,
    sessionId: string,
    sessionKey: string,
    tierId: string,
  ): Promise<void> {
    const rows = await this.collectSessionJsonlHeadRows(agent, sessionId, sessionKey, tierId)
    if (rows === null) return
    for (const row of rows) {
      await this.writeRow(row)
    }
    log.info('session jsonl oversize — indexed head-only', { agent, sessionId, indexed: rows.length })
  }

  /**
   * Read a session JSONL from `startOffset` and parse rows. Pure w.r.t.
   * persisted state — the caller owns offset persistence. Null when there is
   * nothing to consume (missing entry / no new bytes / range read failed).
   */
  private async collectSessionJsonlRows(
    agent: string,
    sessionId: string,
    sessionKey: string,
    tierId: string,
    path: string,
    startOffset: number,
  ): Promise<JsonlChunk | null> {
    const stats = await this.ctx.runtime.memory.statEntry(tierId, sessionId, { agentId: agent })
    if (!stats) return null
    let offset = startOffset
    if (stats.size < offset) {
      log.info('session jsonl shrank — restarting from offset 0', {
        path,
        previous: offset,
        current: stats.size,
      })
      offset = 0
    }
    if (stats.size === offset) return null

    const bytesToRead = stats.size - offset
    const range = await this.ctx.runtime.memory.readEntryRange(tierId, sessionId, {
      agentId: agent,
      offset,
      length: bytesToRead,
    })
    if (!range) return null
    return parseJsonlChunk(range.content, offset, (line, lineStart) =>
      parseTurnLine(agent, sessionId, sessionKey, line, lineStart),
    )
  }

  private async indexSessionJsonlIncremental(
    agent: string,
    sessionId: string,
    sessionKey: string,
    tierId: string,
    path: string,
  ): Promise<void> {
    const chunk = await this.collectSessionJsonlRows(agent, sessionId, sessionKey, tierId, path, getOffset(path))
    if (!chunk) return

    for (const row of chunk.rows) {
      await this.writeRow(row)
    }
    setOffset(path, chunk.newOffset)
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

  /** Fetch + parse one checkpoint file. Null when missing or unparseable. */
  private async collectCheckpointRow(
    agent: string,
    sessionId: string,
    checkpointId: string,
    filename: string,
  ): Promise<MemoryRow | null> {
    const entry = await getRuntimeMemoryEntry(this.ctx, 'checkpoint', filename, agent)
    if (!entry) return null
    return parseCheckpoint(
      agent,
      sessionId,
      checkpointId,
      filename,
      entry.content,
      entry.path ?? filename,
      entryMtimeMs(entry),
    )
  }

  private async indexCheckpointFile(
    agent: string,
    sessionId: string,
    checkpointId: string,
    filename: string,
  ): Promise<void> {
    const row = await this.collectCheckpointRow(agent, sessionId, checkpointId, filename)
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

  /** Fetch + parse one dream phase doc. Null when missing or unparseable. */
  private async collectPhaseDocRow(
    agent: string,
    phase: string,
    filename: string,
    knownEntry?: RuntimeMemoryEntry,
  ): Promise<MemoryRow | null> {
    const entry = knownEntry ?? await getRuntimeMemoryEntry(this.ctx, 'dream_phase', `${phase}/${filename}`, agent)
    if (!entry) return null
    return parsePhaseDoc(agent, phase, filename, entry.content, entry.path ?? `${phase}/${filename}`, entryMtimeMs(entry))
  }

  private async indexPhaseDoc(
    agent: string,
    phase: string,
    filename: string,
    knownEntry?: RuntimeMemoryEntry,
  ): Promise<void> {
    const row = await this.collectPhaseDocRow(agent, phase, filename, knownEntry)
    if (row === null) return
    await this.writeRow(row)
  }

  /** Fetch + parse one dream signal artifact. Null when missing or unparseable. */
  private async collectDreamSignalRow(
    agent: string,
    relPath: string,
    knownEntry?: RuntimeMemoryEntry,
  ): Promise<MemoryRow | null> {
    const entry = knownEntry ?? await getRuntimeMemoryEntry(this.ctx, 'dream_signal', relPath, agent)
    if (!entry) return null
    return parseDreamSignal(agent, relPath, entry.content, entry.path ?? relPath, entryMtimeMs(entry))
  }

  private async indexDreamSignal(
    agent: string,
    relPath: string,
    knownEntry?: RuntimeMemoryEntry,
  ): Promise<void> {
    const row = await this.collectDreamSignalRow(agent, relPath, knownEntry)
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
    // Unconditional write: the search outbox's acked-hash dedupe drops
    // unchanged rows before they reach the engine, so the old scan-loaded
    // indexed-updatedAt cache (and its persisted snapshot) is gone.
    await this.ctx.search.index(row.id, buildMemoryDoc(row))
  }

  private async removeRow(key: string): Promise<void> {
    await this.ctx.search.remove(key)
  }

  // ─── Side-effect-free enumeration (blue/green backfill source) ────────────

  /**
   * Yield every `{key, doc}` the live indexing path would write for the
   * current source corpus, across all tiers, WITHOUT touching persisted
   * state: no offset reads/writes, no search-adapter calls, no
   * chunk-count/roster bookkeeping. Restartable —
   * every call re-reads sources from byte 0.
   *
   * Write-time policy filters DO apply (TTL retention, session backfill
   * cutoff, oversize head-chunking) so the emitted set matches what a fresh
   * backfill would write.
   */
  async *enumerateAll(): AsyncGenerator<{ key: string; doc: Record<string, unknown> }> {
    for (const tier of MEMORY_TIERS) {
      yield* this.enumerateTier(tier)
    }
  }

  async *enumerateTier(tier: MemoryTier): AsyncGenerator<{ key: string; doc: Record<string, unknown> }> {
    if (tier === 'audit') {
      const chunk = this.collectAuditRows(0)
      if (chunk) yield* this.emitRows(chunk.rows)
      return
    }
    if (tier === 'durable') {
      yield* this.enumerateDurableTier()
      return
    }
    if (tier === 'daily_note') {
      yield* this.enumerateDailyNoteTier()
      return
    }
    if (tier === 'session') {
      yield* this.enumerateSessionTier()
      return
    }
    if (tier === 'turn') {
      yield* this.enumerateTurnTier()
      return
    }
    if (tier === 'checkpoint') {
      yield* this.enumerateCheckpointTier()
      return
    }
    if (tier === 'dream') {
      yield* this.enumerateDreamTier()
      return
    }
  }

  /** Apply the shared write-time TTL policy and map rows to {key, doc}. */
  private *emitRows(rows: readonly MemoryRow[]): Generator<{ key: string; doc: Record<string, unknown> }> {
    for (const row of rows) {
      if (this.isExpired(row)) continue
      yield { key: row.id, doc: buildMemoryDoc(row) }
    }
  }

  private async *enumerateDurableTier(): AsyncGenerator<{ key: string; doc: Record<string, unknown> }> {
    for (const agent of await this.listRuntimeAgentIds()) {
      for (const basename of CANONICAL_DURABLE_FILES) {
        const rows = await this.collectDurableFileRows(agent, basename)
        if (rows) yield* this.emitRows(rows)
      }
      for (const file of await listRuntimeMemoryEntries(this.ctx, 'skill', agent)) {
        const rows = await this.collectSkillFileRows(agent, file.id)
        if (rows) yield* this.emitRows(rows)
      }
    }
  }

  private async *enumerateDailyNoteTier(): AsyncGenerator<{ key: string; doc: Record<string, unknown> }> {
    for (const agent of await this.listRuntimeAgentIds()) {
      for (const entry of await listRuntimeMemoryEntries(this.ctx, 'daily_note', agent)) {
        const row = await this.collectDailyNoteRow(agent, entry.id)
        if (row) yield* this.emitRows([row])
      }
    }
  }

  private async *enumerateSessionTier(): AsyncGenerator<{ key: string; doc: Record<string, unknown> }> {
    for (const agent of await this.listRuntimeAgentIds()) {
      const collected = await this.collectSessionRows(agent)
      if (collected) yield* this.emitRows(collected.map((entry) => entry.row))
    }
  }

  private async *enumerateTurnTier(): AsyncGenerator<{ key: string; doc: Record<string, unknown> }> {
    const threshold = this.opts.skipSessionOverBytes ?? DEFAULT_SKIP_SESSION_BYTES
    for (const agent of await this.listRuntimeAgentIds()) {
      for (const file of await listRuntimeMemoryEntries(this.ctx, 'session_jsonl', agent)) {
        if (metadataBoolean(file, 'isReset')) continue
        const sessionId = metadataString(file, 'sessionId') ?? file.id
        const sessionKey = `agent:${agent}:${sessionId}`
        const path = file.path ?? `runtime:${file.tierId}:${agent}:${file.id}`
        if (entrySizeBytes(file) > threshold) {
          const rows = await this.collectSessionJsonlHeadRows(agent, sessionId, sessionKey, file.tierId)
          if (rows) yield* this.emitRows(rows)
        } else {
          const chunk = await this.collectSessionJsonlRows(agent, sessionId, sessionKey, file.tierId, path, 0)
          if (chunk) yield* this.emitRows(chunk.rows)
        }
      }
    }
  }

  private async *enumerateCheckpointTier(): AsyncGenerator<{ key: string; doc: Record<string, unknown> }> {
    for (const agent of await this.listRuntimeAgentIds()) {
      for (const file of await listRuntimeMemoryEntries(this.ctx, 'checkpoint', agent)) {
        const sessionId = metadataString(file, 'sessionId')
        const checkpointId = metadataString(file, 'checkpointId')
        const filename = metadataString(file, 'filename') ?? file.id
        if (!sessionId || !checkpointId) continue
        const row = await this.collectCheckpointRow(agent, sessionId, checkpointId, filename)
        if (row) yield* this.emitRows([row])
      }
    }
  }

  private async *enumerateDreamTier(): AsyncGenerator<{ key: string; doc: Record<string, unknown> }> {
    for (const agent of await this.listRuntimeAgentIds()) {
      for (const file of await listRuntimeMemoryEntries(this.ctx, 'dream_phase', agent)) {
        const phase = metadataString(file, 'phase')
        const filename = metadataString(file, 'filename')
        if (!phase || !filename) continue
        const row = await this.collectPhaseDocRow(agent, phase, filename)
        if (row) yield* this.emitRows([row])
      }
      for (const file of await listRuntimeMemoryEntries(this.ctx, 'dream_signal', agent)) {
        const relPath = metadataString(file, 'relPath') ?? file.id
        const row = await this.collectDreamSignalRow(agent, relPath)
        if (row) yield* this.emitRows([row])
      }
    }
  }
}
