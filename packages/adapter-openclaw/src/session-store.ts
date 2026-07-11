/**
 * OpenClaw session identity + store reading — the deterministic
 * agent/sessionKey → CLI session-id mapping and the mtime-guarded,
 * LRU-capped sessions.json cache behind `sessions.list/get` (sessions.ts).
 *
 * Chat streaming and dispatch liveness ride gateway push events
 * (`stream-events.ts`); trajectory files are read only by
 * `trajectory-forensics.ts`.
 */
import { statSync } from 'fs'
import { createHash } from 'crypto'
import { readJsonFile } from './runtime-utils'

/**
 * One sessions.json entry as the gateway writes it. Only the fields
 * sessions.list/get consume are typed; the store carries many more
 * (usage, routing, auth) that stay in the parsed object untyped.
 */
export interface OpenClawSessionStoreEntry {
  sessionId?: string
  sessionFile?: string
  /** Epoch ms of the last store write for this session. */
  updatedAt?: number
  /** Epoch ms the current session began. */
  sessionStartedAt?: number
  model?: string
  chatType?: string
  status?: string
  totalTokens?: number
  origin?: { label?: string }
}

// sessions.json grows one entry (with a full skillsSnapshot) per session and
// per-dispatch sessions accumulate steadily — cache the parsed store behind
// an mtime guard so repeated sessions.list calls stay O(1) between writes.
// LRU-capped: each entry holds a fully-parsed store, and the Map previously
// grew without bound (one entry per store path, never evicted).
export const SESSION_STORE_CACHE_MAX = 64
// mtime + size guard: mtime alone can miss a torn read of the gateway's
// non-atomic write landing within the filesystem's mtime granularity
// (negligible on APFS, belt-and-braces elsewhere).
const sessionStoreCache = new Map<string, { mtimeMs: number; size: number; store: Record<string, OpenClawSessionStoreEntry> | null }>()

export function readSessionStoreCached(storePath: string): Record<string, OpenClawSessionStoreEntry> | null {
  let mtimeMs: number
  let size: number
  try {
    const stat = statSync(storePath)
    mtimeMs = stat.mtimeMs
    size = stat.size
  } catch {
    sessionStoreCache.delete(storePath)
    return null
  }
  const hit = sessionStoreCache.get(storePath)
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) {
    // Map preserves insertion order — delete + re-set marks recency.
    sessionStoreCache.delete(storePath)
    sessionStoreCache.set(storePath, hit)
    return hit.store
  }
  const store = readJsonFile<Record<string, OpenClawSessionStoreEntry>>(storePath)
  sessionStoreCache.delete(storePath)
  sessionStoreCache.set(storePath, { mtimeMs, size, store })
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

export function openClawCliSessionId(agentId: string, sessionKey: string): string {
  if (isOpenClawCliSessionId(sessionKey)) return sessionKey
  return deterministicUuid(`bakin:${agentId}:${sessionKey}`)
}

/**
 * The gateway's canonical key for an explicit-sessionId session. Threaded
 * sends MUST pass this alongside `sessionId`: a run addressed by sessionId
 * alone is never registered in the gateway's chat-abort registry (ack
 * omits sessionKey; chat.abort AND sessions.abort miss — fixture
 * abort-explicit-session.jsonl), so server-side abort silently fails.
 * Sending both registers the run AND keeps the underlying sessionId (and
 * trajectory filename) ours (fixture abort-sessionkey-addressed.jsonl).
 */
export function openClawExplicitSessionKey(agentId: string, cliSessionId: string): string {
  return `agent:${agentId}:explicit:${cliSessionId}`
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
