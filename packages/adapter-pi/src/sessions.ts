/**
 * Session plumbing: threadId → Pi session-file mapping, per-thread turn
 * mutex, and the sessions.* contract surface.
 *
 * Bakin's adapter-neutral threadId (`task:<id>:d<seq>`, `chat:<uuid>`) maps
 * to ONE persisted Pi session file per (agent, thread), recorded in
 * <sessions-dir>/bakin-threads.json. Sessions open lazily per turn and are
 * disposed after the turn settles — the JSONL file on disk carries the
 * conversation across turns.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'

import { SessionManager } from '@earendil-works/pi-coding-agent'

import type { AgentRuntimeAdapter, RuntimeSession, RuntimeSessionStoreStats } from '@bakin/core/adapters/runtime'
import { getAgentSessionsDir, getAgentWorkspaceDir } from './home'
import { readRegistry } from './registry'

const ThreadMapSchema = z.object({
  version: z.literal(1),
  threads: z.record(z.string(), z.object({
    sessionId: z.string(),
    file: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })),
})

type ThreadMap = z.infer<typeof ThreadMapSchema>

function threadMapPath(agentId: string): string {
  return join(getAgentSessionsDir(agentId), 'bakin-threads.json')
}

function readThreadMap(agentId: string): ThreadMap {
  const path = threadMapPath(agentId)
  if (!existsSync(path)) return { version: 1, threads: {} }
  try {
    return ThreadMapSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
  } catch {
    // Thread mapping is a resume optimization, not a source of truth —
    // a corrupt map means new sessions, never a hard failure.
    return { version: 1, threads: {} }
  }
}

function writeThreadMap(agentId: string, map: ThreadMap): void {
  mkdirSync(getAgentSessionsDir(agentId), { recursive: true })
  const tmp = `${threadMapPath(agentId)}.tmp`
  writeFileSync(tmp, JSON.stringify(map, null, 2))
  renameSync(tmp, threadMapPath(agentId))
}

export function getThreadSessionFile(agentId: string, threadId: string): string | null {
  const entry = readThreadMap(agentId).threads[threadId]
  if (!entry || !existsSync(entry.file)) return null
  return entry.file
}

/**
 * Session-file → threadId reverse index for origin labeling (#691).
 *
 * Deliberately NOT built on readThreadMap: its silent-empty fallback is right
 * for resume (corrupt map ⇒ new session) but would mislabel every session
 * `external` here. Origin needs the distinction — "no map" honestly means
 * Bakin never dispatched this agent (all sessions external), while "corrupt
 * map" means we cannot tell (all sessions unknown, never guessed).
 */
export function readSessionOriginIndex(agentId: string):
  | { status: 'ok'; threadByFile: Map<string, string> }
  | { status: 'missing' }
  | { status: 'corrupt' } {
  const path = threadMapPath(agentId)
  if (!existsSync(path)) return { status: 'missing' }
  try {
    const map = ThreadMapSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
    const threadByFile = new Map<string, string>()
    for (const [threadId, entry] of Object.entries(map.threads)) {
      threadByFile.set(entry.file, threadId)
    }
    return { status: 'ok', threadByFile }
  } catch {
    return { status: 'corrupt' }
  }
}

export function recordThreadSession(agentId: string, threadId: string, sessionId: string, file: string): void {
  const map = readThreadMap(agentId)
  const now = new Date().toISOString()
  const existing = map.threads[threadId]
  map.threads[threadId] = {
    sessionId,
    file,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  writeThreadMap(agentId, map)
}

/**
 * Open (resume) or create the Pi SessionManager for a turn. cwd is ALWAYS
 * the agent workspace so Pi's project-context discovery (AGENTS.md) and
 * project-local skills resolve to the agent's world.
 */
export function sessionManagerForThread(agentId: string, threadId?: string): SessionManager {
  const workspace = getAgentWorkspaceDir(agentId)
  const sessionsDir = getAgentSessionsDir(agentId)
  mkdirSync(sessionsDir, { recursive: true })
  if (threadId) {
    const file = getThreadSessionFile(agentId, threadId)
    if (file) return SessionManager.open(file, sessionsDir, workspace)
  }
  return SessionManager.create(workspace, sessionsDir)
}

// One turn at a time per (agent, thread): concurrent sends against the same
// thread would interleave one session file. Independent threads run freely.
const threadLocks = new Map<string, Promise<unknown>>()

export function withThreadLock<T>(agentId: string, threadId: string | undefined, fn: () => Promise<T>): Promise<T> {
  const key = `${agentId}::${threadId ?? '__ephemeral__'}`
  if (!threadId) return fn()
  const prior = threadLocks.get(key) ?? Promise.resolve()
  const next = prior.then(fn, fn)
  threadLocks.set(key, next.catch(() => {}))
  return next
}

function dirSizeBytes(dir: string): number {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    total += entry.isDirectory() ? dirSizeBytes(abs) : statSync(abs).size
  }
  return total
}

async function listAgentSessions(agentId: string): Promise<RuntimeSession[]> {
  const sessionsDir = getAgentSessionsDir(agentId)
  if (!existsSync(sessionsDir)) return []
  const infos = await SessionManager.list(getAgentWorkspaceDir(agentId), sessionsDir)
  return infos.map((info) => ({
    id: info.id,
    agentId,
    title: info.name || info.firstMessage.slice(0, 80) || undefined,
    startedAt: info.created.toISOString(),
    updatedAt: info.modified.toISOString(),
    metadata: { path: info.path, messageCount: info.messageCount },
  }))
}

export function createSessionsSurface(): AgentRuntimeAdapter['sessions'] {
  return {
    async list(agentId?: string): Promise<RuntimeSession[]> {
      const agents = agentId ? [agentId] : readRegistry().agents.map((a) => a.id)
      const all = await Promise.all(agents.map(listAgentSessions))
      return all.flat().sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    },

    async get(sessionId: string): Promise<RuntimeSession | null> {
      for (const agent of readRegistry().agents) {
        const sessions = await listAgentSessions(agent.id)
        const found = sessions.find((s) => s.id === sessionId)
        if (found) return found
      }
      return null
    },

    async storeStats(): Promise<RuntimeSessionStoreStats[]> {
      return readRegistry().agents.map((agent) => {
        const dir = getAgentSessionsDir(agent.id)
        if (!existsSync(dir)) return { agentId: agent.id, storeEntries: 0, fileCount: 0, diskBytes: 0 }
        const entries = readdirSync(dir, { withFileTypes: true })
        const topLevelFiles = entries.filter((e) => e.isFile())
        const jsonlCount = topLevelFiles.filter((e) => e.name.endsWith('.jsonl')).length
          + entries.filter((e) => e.isDirectory()).reduce((n, d) => {
            return n + readdirSync(join(dir, d.name)).filter((f) => f.endsWith('.jsonl')).length
          }, 0)
        return {
          agentId: agent.id,
          storeEntries: jsonlCount,
          fileCount: topLevelFiles.length,
          diskBytes: dirSizeBytes(dir),
          // Adapter-owned operator guidance (R29): Pi sessions are plain
          // JSONL under the agent's sessions dir — archiving/deleting old
          // files while the agent is idle is the supported cleanup.
          remediation: `Archive or delete old session JSONL files under ${dir} while the agent is idle.`,
        }
      })
    },
  }
}
