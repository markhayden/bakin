/**
 * memory.* — Pi's observable memory tiers.
 *
 *   pi-session-jsonl  (sourceKind 'session_jsonl') — raw Pi session files.
 *     Pi's on-disk entry shape matches Bakin's session-usage parser contract
 *     1:1 ({type:'session'} header; {type:'message'} entries whose assistant
 *     messages carry model + usage{…, totalTokens, cost{…, total}}), so
 *     getEntry returns RAW file content and usage.db lights up with zero
 *     core changes and zero transformation.
 *   pi-durable — the agent workspace files (AGENTS/SOUL/… + skills).
 *
 * Entry ids are tier-root-relative paths; resolution refuses traversal.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, resolve, sep } from 'path'

import type {
  AgentRuntimeAdapter,
  RuntimeMemoryEntry,
  RuntimeMemoryEntryStat,
  RuntimeMemoryTier,
} from '@bakin/core/adapters/runtime'
import { getAgentSessionsDir, getAgentWorkspaceDir, getPiAgentsRoot, getPiHome } from './home'
import { readRegistry } from './registry'
import { readSessionOriginIndex } from './sessions'

export const SESSION_TIER_ID = 'pi-session-jsonl'
export const DURABLE_TIER_ID = 'pi-durable'

const TIERS: RuntimeMemoryTier[] = [
  {
    id: SESSION_TIER_ID,
    label: 'Pi session transcripts',
    description: 'Raw Pi session JSONL files (per-agent) — the token/cost usage source.',
    metadata: { sourceKind: 'session_jsonl' },
  },
  {
    id: DURABLE_TIER_ID,
    label: 'Agent workspace files',
    description: 'Canonical identity/context files and workspace-local skills.',
    metadata: { sourceKind: 'durable' },
  },
]

function tierRoot(tierId: string, agentId: string): string {
  if (tierId === SESSION_TIER_ID) return getAgentSessionsDir(agentId)
  if (tierId === DURABLE_TIER_ID) return getAgentWorkspaceDir(agentId)
  throw new Error(`adapter-pi: unknown memory tier: ${tierId}`)
}

function safeResolve(root: string, id: string): string {
  const abs = resolve(root, id)
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`adapter-pi: memory entry id escapes its tier: ${id}`)
  }
  return abs
}

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.pi') continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) walk(root, abs, out)
    else out.push(relative(root, abs))
  }
}

function entryFiles(tierId: string, agentId: string): string[] {
  const root = tierRoot(tierId, agentId)
  if (!existsSync(root)) return []
  const out: string[] = []
  walk(root, root, out)
  if (tierId === SESSION_TIER_ID) {
    // Session tier is JSONL transcripts only — the thread map is adapter
    // bookkeeping, not memory.
    return out.filter((f) => f.endsWith('.jsonl'))
  }
  return out
}

function agentIdsFor(agentId?: string): string[] {
  if (agentId) return [agentId]
  return readRegistry().agents.map((a) => a.id)
}

/**
 * Origin metadata for one agent's session files (#691): a file recorded in
 * bakin-threads.json was Bakin-dispatched; an unrecorded file is an
 * interactive/external session (Pi TUI, other clients). A missing map means
 * Bakin never dispatched here (all external); a corrupt map means we cannot
 * tell (all unknown — never guessed).
 */
function sessionOriginMetadata(agentId: string): (absPath: string) => Record<string, unknown> {
  const index = readSessionOriginIndex(agentId)
  return (absPath: string) => {
    if (index.status === 'corrupt') return { sourceKind: 'session_jsonl', origin: 'unknown' }
    const originThreadId = index.status === 'ok' ? index.threadByFile.get(absPath) : undefined
    return originThreadId
      ? { sourceKind: 'session_jsonl', origin: 'bakin', originThreadId }
      : { sourceKind: 'session_jsonl', origin: 'external' }
  }
}

export function createMemorySurface(): AgentRuntimeAdapter['memory'] {
  return {
    async listTiers(): Promise<RuntimeMemoryTier[]> {
      return TIERS
    },

    async listEntries(tierId: string, opts?: { agentId?: string }): Promise<RuntimeMemoryEntry[]> {
      const out: RuntimeMemoryEntry[] = []
      for (const agent of agentIdsFor(opts?.agentId)) {
        const root = tierRoot(tierId, agent)
        const originFor = tierId === SESSION_TIER_ID ? sessionOriginMetadata(agent) : null
        for (const file of entryFiles(tierId, agent)) {
          const abs = join(root, file)
          const stat = statSync(abs)
          out.push({
            id: file,
            tierId,
            agentId: agent,
            path: abs,
            // Light listing: content ships via getEntry/readEntryRange.
            content: '',
            updatedAt: stat.mtime.toISOString(),
            ...(originFor ? { metadata: originFor(abs) } : {}),
          })
        }
      }
      return out
    },

    async getEntry(tierId: string, id: string, opts?: { agentId?: string }): Promise<RuntimeMemoryEntry | null> {
      for (const agent of agentIdsFor(opts?.agentId)) {
        const abs = safeResolve(tierRoot(tierId, agent), id)
        if (!existsSync(abs)) continue
        const stat = statSync(abs)
        return {
          id,
          tierId,
          agentId: agent,
          path: abs,
          content: readFileSync(abs, 'utf-8'),
          updatedAt: stat.mtime.toISOString(),
          ...(tierId === SESSION_TIER_ID ? { metadata: sessionOriginMetadata(agent)(abs) } : {}),
        }
      }
      return null
    },

    async statEntry(tierId: string, id: string, opts?: { agentId?: string }): Promise<RuntimeMemoryEntryStat | null> {
      for (const agent of agentIdsFor(opts?.agentId)) {
        const abs = safeResolve(tierRoot(tierId, agent), id)
        if (!existsSync(abs)) continue
        const stat = statSync(abs)
        return { size: stat.size, mtimeMs: stat.mtimeMs, updatedAt: stat.mtime.toISOString() }
      }
      return null
    },

    async readEntryRange(tierId: string, id: string, opts?: { agentId?: string; offset?: number; length?: number }) {
      for (const agent of agentIdsFor(opts?.agentId)) {
        const abs = safeResolve(tierRoot(tierId, agent), id)
        if (!existsSync(abs)) continue
        const stat = statSync(abs)
        const content = readFileSync(abs, 'utf-8')
        const offset = opts?.offset ?? 0
        const sliced = opts?.length !== undefined ? content.slice(offset, offset + opts.length) : content.slice(offset)
        return { content: sliced, size: stat.size, mtimeMs: stat.mtimeMs, updatedAt: stat.mtime.toISOString() }
      }
      return null
    },

    async resolvePath(path: string) {
      const home = getPiHome()
      const abs = resolve(path)
      if (!abs.startsWith(home + sep) || !existsSync(abs)) return null
      // Classify by which tier root contains the path.
      for (const agent of agentIdsFor()) {
        for (const tierId of [SESSION_TIER_ID, DURABLE_TIER_ID]) {
          const root = tierRoot(tierId, agent)
          if (abs.startsWith(root + sep)) {
            return { tierId, id: relative(root, abs), agentId: agent, path: abs }
          }
        }
      }
      return null
    },

    async watchPaths(): Promise<string[]> {
      return [getPiAgentsRoot()]
    },

    async search(query: string, opts?: { agentId?: string; limit?: number }) {
      // Convenience substring scan over durable files — real search is the
      // memory plugin's indexed table, not this method.
      const limit = opts?.limit ?? 20
      const needle = query.toLowerCase()
      const results: RuntimeMemoryEntry[] = []
      for (const agent of agentIdsFor(opts?.agentId)) {
        const root = tierRoot(DURABLE_TIER_ID, agent)
        for (const file of entryFiles(DURABLE_TIER_ID, agent)) {
          if (results.length >= limit) return { results }
          const abs = join(root, file)
          const content = readFileSync(abs, 'utf-8')
          if (content.toLowerCase().includes(needle) || file.toLowerCase().includes(needle)) {
            results.push({
              id: file,
              tierId: DURABLE_TIER_ID,
              agentId: agent,
              path: abs,
              content,
              updatedAt: statSync(abs).mtime.toISOString(),
            })
          }
        }
      }
      return { results }
    },
  }
}
