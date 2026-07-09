/**
 * OpenClaw session identity + store resolution — the deterministic
 * agent/sessionKey → CLI session-id mapping and the mtime-guarded,
 * LRU-capped sessions.json cache behind it.
 *
 * The live transcript tail that used to live here (pre-WS1) is gone: chat
 * streaming and dispatch liveness ride gateway push events
 * (`stream-events.ts`); trajectory files are read only by
 * `trajectory-forensics.ts`.
 */
import { statSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { getOpenClawHome } from './home'
import { readJsonFile } from './runtime-utils'

export interface OpenClawSessionStoreEntry {
  sessionId?: string
  sessionFile?: string
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
