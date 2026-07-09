/**
 * OpenClaw session activity — reads the live session transcript file (tail +
 * cursor) into ChatChunk activity for streaming, plus the mtime-guarded
 * session-store cache and the agent/sessionKey → session-file resolution.
 *
 * Owns sessionStoreCache (the LRU module cell) and the deterministic CLI
 * session-id mapping. The test-only cache accessors + SESSION_STORE_CACHE_MAX
 * are re-exported from runtime.ts so the session-store-cache test's import
 * path stays stable.
 */
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import type { ChatChunk } from '@bakin/core/adapters/runtime'
import { readFileFrom, safeFileSize } from './file-utils'
import { getOpenClawHome } from './home'
import { parseJsonObject, readJsonFile, sleep } from './runtime-utils'
import { activityChunksFromOpenClawTranscriptRecord } from './activity-summary'
import { trajectoryFilePathFor } from './trajectory-forensics'

/** Session-activity transcript poll interval (ms) while a turn is streaming. */
export const OPENCLAW_SESSION_ACTIVITY_POLL_MS = 200

export interface OpenClawSessionStoreEntry {
  sessionId?: string
  sessionFile?: string
}

export interface OpenClawSessionActivityCursor {
  sessionFile?: string
  offset: number
  partial: string
  /**
   * ISO floor for record `ts` values. The trajectory file persists across
   * turns, and lazy resolution (file appears mid-turn) starts at offset 0 —
   * without the floor, every prior run's tool activity would replay as
   * live chunks.
   */
  notBefore?: string
}

export async function* watchOpenClawSessionActivity(
  agentId: string,
  sessionKey: string,
  cursor: OpenClawSessionActivityCursor,
  signal: AbortSignal,
): AsyncIterable<ChatChunk> {
  while (true) {
    for (const chunk of readOpenClawSessionActivity(agentId, sessionKey, cursor)) {
      yield chunk
    }
    if (signal.aborted) break
    await sleep(OPENCLAW_SESSION_ACTIVITY_POLL_MS)
  }

  for (const chunk of readOpenClawSessionActivity(agentId, sessionKey, cursor)) {
    yield chunk
  }
}

export function createOpenClawSessionActivityCursor(agentId: string, sessionKey: string): OpenClawSessionActivityCursor {
  const sessionFile = resolveOpenClawSessionActivityFile(agentId, sessionKey)
  return {
    sessionFile,
    offset: sessionFile ? safeFileSize(sessionFile) : 0,
    partial: '',
    notBefore: new Date().toISOString(),
  }
}

/**
 * Live activity source. Newer OpenClaw (≥2026.6) batches session-JSONL
 * records to turn END but appends the trajectory file live — tailing the
 * session file made every tool chunk arrive in one burst at completion
 * (found live in P5.3). Prefer the trajectory when it exists; fall back to
 * the session file for older runtimes that still append it live.
 */
export function resolveOpenClawSessionActivityFile(agentId: string, sessionKey: string): string | undefined {
  const trajectory = trajectoryFilePathFor(agentId, openClawCliSessionId(agentId, sessionKey))
  if (existsSync(trajectory)) return trajectory
  return resolveOpenClawSessionFile(agentId, sessionKey)
}

export function readOpenClawSessionActivity(
  agentId: string,
  sessionKey: string,
  cursor: OpenClawSessionActivityCursor,
): ChatChunk[] {
  if (!cursor.sessionFile) {
    cursor.sessionFile = resolveOpenClawSessionActivityFile(agentId, sessionKey)
    cursor.offset = 0
    cursor.partial = ''
  } else if (!cursor.sessionFile.endsWith('.trajectory.jsonl')) {
    // Sticky-pick upgrade: on a fresh session the session .jsonl can appear
    // BEFORE the trajectory file, so the first resolution lands on the
    // batch-written session file and would stay there for the whole turn.
    // Keep checking for the live trajectory and switch when it shows up
    // (offset 0 is safe — the notBefore floor drops anything pre-cursor).
    const trajectory = trajectoryFilePathFor(agentId, openClawCliSessionId(agentId, sessionKey))
    if (existsSync(trajectory)) {
      cursor.sessionFile = trajectory
      cursor.offset = 0
      cursor.partial = ''
    }
  }
  if (!cursor.sessionFile) return []

  const next = readFileTail(cursor.sessionFile, cursor.offset)
  if (!next) return []
  cursor.offset = next.offset

  const text = cursor.partial + next.text
  const lines = text.split('\n')
  cursor.partial = lines.pop() ?? ''

  const chunks: ChatChunk[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = parseJsonObject(trimmed)
    if (!parsed) continue
    // Drop records from prior runs (lazy offset-0 resolution replays the
    // whole file; the trajectory spans every turn of the session).
    if (cursor.notBefore && typeof parsed.ts === 'string' && parsed.ts < cursor.notBefore) continue
    chunks.push(...activityChunksFromOpenClawTranscriptRecord(parsed))
  }
  return chunks
}

// sessions.json grows one entry (with a full skillsSnapshot) per session and
// per-dispatch sessions accumulate steadily — cache the parsed store behind
// an mtime guard so resolution stays O(1) between writes. LRU-capped: each
// entry holds a fully-parsed store, and the Map previously grew without
// bound (one entry per store path, never evicted).
export const SESSION_STORE_CACHE_MAX = 64
const sessionStoreCache = new Map<string, { mtimeMs: number; store: Record<string, OpenClawSessionStoreEntry> | null }>()

export function readSessionStoreCached(storePath: string): Record<string, OpenClawSessionStoreEntry> | null {
  let mtimeMs: number
  try {
    mtimeMs = statSync(storePath).mtimeMs
  } catch {
    sessionStoreCache.delete(storePath)
    return null
  }
  const hit = sessionStoreCache.get(storePath)
  if (hit && hit.mtimeMs === mtimeMs) {
    // Map preserves insertion order — delete + re-set marks recency.
    sessionStoreCache.delete(storePath)
    sessionStoreCache.set(storePath, hit)
    return hit.store
  }
  const store = readJsonFile<Record<string, OpenClawSessionStoreEntry>>(storePath)
  sessionStoreCache.delete(storePath)
  sessionStoreCache.set(storePath, { mtimeMs, store })
  while (sessionStoreCache.size > SESSION_STORE_CACHE_MAX) {
    const oldest = sessionStoreCache.keys().next().value
    if (oldest === undefined) break
    sessionStoreCache.delete(oldest)
  }
  return store
}

/** @internal Test-only. */
export function __readSessionStoreCachedForTest(storePath: string): Record<string, OpenClawSessionStoreEntry> | null {
  return readSessionStoreCached(storePath)
}

/** @internal Test-only. */
export function __sessionStoreCacheKeysForTest(): string[] {
  return [...sessionStoreCache.keys()]
}

/** @internal Test-only. */
export function __resetSessionStoreCacheForTest(): void {
  sessionStoreCache.clear()
}

export function resolveOpenClawSessionFile(agentId: string, sessionKey: string): string | undefined {
  const storePath = join(getOpenClawHome(), 'agents', agentId, 'sessions', 'sessions.json')
  const store = readSessionStoreCached(storePath)
  const entry = findOpenClawSessionStoreEntry(store, agentId, sessionKey)
  if (!entry) return undefined
  if (typeof entry.sessionFile === 'string' && entry.sessionFile.length > 0) return entry.sessionFile
  if (typeof entry.sessionId === 'string' && entry.sessionId.length > 0) {
    return join(getOpenClawHome(), 'agents', agentId, 'sessions', `${entry.sessionId}.jsonl`)
  }
  return undefined
}

export function findOpenClawSessionStoreEntry(
  store: Record<string, OpenClawSessionStoreEntry> | null,
  agentId: string,
  sessionKey: string,
): OpenClawSessionStoreEntry | undefined {
  if (!store) return undefined
  const cliSessionId = openClawCliSessionId(agentId, sessionKey)
  return store[sessionKey]
    ?? store[cliSessionId]
    ?? store[`agent:${agentId}:explicit:${cliSessionId}`]
    ?? store[`agent:${agentId}:${cliSessionId}`]
}

export function openClawCliSessionId(agentId: string, sessionKey: string): string {
  if (isOpenClawCliSessionId(sessionKey)) return sessionKey
  return deterministicUuid(`bakin:${agentId}:${sessionKey}`)
}

export function isOpenClawCliSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function deterministicUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  const variant = Number.parseInt(hex[16] ?? '0', 16)
  hex[16] = ((variant & 0x3) | 0x8).toString(16)
  const id = hex.join('')
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
}

/**
 * Session-activity tail semantics over the shared readFileFrom:
 * rewind-to-0 on truncation/rotation; null when there are no new bytes.
 */
export function readFileTail(path: string, offset: number): { text: string; offset: number } | null {
  const read = readFileFrom(path, offset, { rewindOnTruncate: true })
  if (!read || read.text === '') return null
  return { text: read.text, offset: read.nextOffset }
}
