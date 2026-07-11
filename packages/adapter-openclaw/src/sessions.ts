/**
 * OpenClaw sessions.list/get — real reads of the gateway's per-agent
 * sessions.json store (T28; previously stubbed while capabilities()
 * declared sessions 'native').
 *
 * The store is keyed by sessionKey (`agent:<id>:main`,
 * `agent:<id>:explicit:<uuid>`, channel keys); each entry names the CURRENT
 * CLI sessionId for that key plus timing/usage metadata. Bakin's contract
 * surface is session-shaped, not key-shaped: entries map to RuntimeSession
 * by sessionId, deduped newest-wins when several keys point at one session.
 * Reads ride the mtime-guarded LRU cache in session-store.ts.
 */
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

import type { RuntimeSession } from '@bakin/core/adapters/runtime'
import { getOpenClawPath } from './home'
import { readSessionStoreCached, type OpenClawSessionStoreEntry } from './session-store'

function toIso(epochMs: unknown): string | undefined {
  return typeof epochMs === 'number' && Number.isFinite(epochMs) && epochMs > 0
    ? new Date(epochMs).toISOString()
    : undefined
}

function sessionFromEntry(agentId: string, sessionKey: string, entry: OpenClawSessionStoreEntry): RuntimeSession | null {
  const id = typeof entry.sessionId === 'string' && entry.sessionId.length > 0 ? entry.sessionId : null
  if (!id) return null
  const path = typeof entry.sessionFile === 'string' && entry.sessionFile.length > 0
    ? entry.sessionFile
    : join(getOpenClawPath('agents', agentId, 'sessions'), `${id}.jsonl`)
  return {
    id,
    agentId,
    title: entry.origin?.label || sessionKey,
    startedAt: toIso(entry.sessionStartedAt),
    updatedAt: toIso(entry.updatedAt),
    metadata: {
      sessionKey,
      path,
      ...(entry.model ? { model: entry.model } : {}),
      ...(entry.chatType ? { chatType: entry.chatType } : {}),
      ...(entry.status ? { status: entry.status } : {}),
      ...(typeof entry.totalTokens === 'number' ? { totalTokens: entry.totalTokens } : {}),
    },
  }
}

function listAgentIds(): string[] {
  const agentsDir = getOpenClawPath('agents')
  if (!existsSync(agentsDir)) return []
  return readdirSync(agentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function listAgentSessions(agentId: string): RuntimeSession[] {
  const storePath = join(getOpenClawPath('agents', agentId, 'sessions'), 'sessions.json')
  const store = readSessionStoreCached(storePath)
  if (!store) return []
  // Several store keys can reference one sessionId over its lifetime
  // (main key + explicit key after a resume) — newest updatedAt wins.
  const byId = new Map<string, RuntimeSession>()
  for (const [sessionKey, entry] of Object.entries(store)) {
    const session = sessionFromEntry(agentId, sessionKey, entry)
    if (!session) continue
    const prior = byId.get(session.id)
    if (!prior || (session.updatedAt ?? '') > (prior.updatedAt ?? '')) byId.set(session.id, session)
  }
  return [...byId.values()]
}

export function listOpenClawSessions(agentId?: string): RuntimeSession[] {
  const agents = agentId ? [agentId] : listAgentIds()
  return agents
    .flatMap(listAgentSessions)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

export function getOpenClawSession(sessionId: string): RuntimeSession | null {
  for (const agentId of listAgentIds()) {
    const found = listAgentSessions(agentId).find((session) => session.id === sessionId)
    if (found) return found
  }
  return null
}
