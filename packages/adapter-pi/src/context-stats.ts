/**
 * sessions.contextStats for Pi (#737) — the honest context reading,
 * FILE-ONLY at rest. Mirrors the SDK's own getContextUsage semantics
 * (which is not callable without a heavy, session-MUTATING
 * createAgentSession): the last VALID assistant message's
 * usage.totalTokens is the provider's exact prompt snapshot, entries
 * after it add a chars÷4 estimate, and a post-compaction gap (no valid
 * usage newer than the compaction) reads tokens: null — never the stale
 * pre-compaction number. `estimateContextTokens` itself is not exported
 * by the SDK, so this re-implements it over the exported
 * calculateContextTokens + estimateTokens.
 *
 * DELIBERATE divergence from getContextUsage: with NO valid assistant
 * usage anywhere (fresh session, all-aborted turns) the SDK falls back
 * to a chars÷4 estimate over everything; we return tokens: null instead
 * (absence over an unanchored estimate — contract rule). Do not "fix"
 * this back toward the SDK.
 *
 * The compaction guard is INDEX-based over branch entries (the SDK's own
 * approach) — NEVER timestamp comparison: real Pi message timestamps are
 * epoch-ms numbers while compaction entries carry ISO strings, so any
 * string/number comparison is dead code (review finding — the fixtures
 * that masked it now use the real numeric shape).
 *
 * Results are cached per file keyed on mtime+size (the OpenClaw
 * readSessionStoreCached pattern): session JSONL is append-only and
 * grows without bound, and this runs on every chat GET — an uncached
 * multi-MB double-parse would block the event loop mid-SSE.
 *
 * NEVER on this path: SessionManager.create (mints sessions),
 * createAgentSession (mutates the file + loads extensions), or
 * withThreadLock (reads must not queue behind turns; the JSONL appends
 * whole entries, so a mid-turn read is one turn stale, never torn).
 * Known cross-process caveat: SessionManager.open rewrites a 0-byte or
 * pre-v3 file (persist-mode migration) — harmless in-process, and only
 * reachable cross-process if the pi TUI creates an empty file the exact
 * moment we read; all real files on disk are v3.
 */
import { statSync } from 'fs'

import {
  SessionManager,
  calculateContextTokens,
  estimateTokens,
  getLatestCompactionEntry,
} from '@earendil-works/pi-coding-agent'

import type { RuntimeSessionContextStats } from '@bakin/core/adapters/runtime'
import { getAgentSessionsDir, getAgentWorkspaceDir, getPiAgentDir } from './home'
import { createTurnSettingsManager } from './messaging'
import { findPiModel } from './models'
import { getThreadSessionFile } from './sessions'

interface AssistantLikeMessage {
  role?: string
  stopReason?: string
  usage?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    totalTokens?: number
  }
}

interface BranchEntryLike {
  id?: string
  type?: string
  message?: AssistantLikeMessage
}

/** The SDK's valid-usage predicate: a settled assistant whose usage
 *  yields a non-zero context reading (calculateContextTokens covers the
 *  totalTokens-or-sum fallback INCLUDING cacheWrite — SDK parity). */
function hasValidUsage(m: AssistantLikeMessage | undefined): boolean {
  if (!m || m.role !== 'assistant' || !m.usage) return false
  if (m.stopReason === 'aborted' || m.stopReason === 'error') return false
  return calculateContextTokens(m.usage as Parameters<typeof calculateContextTokens>[0]) > 0
}

const contextStatsCache = new Map<string, { mtimeMs: number; size: number; stats: RuntimeSessionContextStats | null }>()
const CONTEXT_STATS_CACHE_MAX = 64

export async function sessionContextStats(opts: {
  agentId: string
  threadId: string
}): Promise<RuntimeSessionContextStats | null> {
  const { agentId, threadId } = opts
  const file = getThreadSessionFile(agentId, threadId)
  if (!file) return null

  // mtime+size cache: turns only ever APPEND to session files, so an
  // unchanged stat means an unchanged reading.
  let mtimeMs: number
  let size: number
  try {
    const stat = statSync(file)
    mtimeMs = stat.mtimeMs
    size = stat.size
  } catch {
    contextStatsCache.delete(file)
    return null
  }
  const hit = contextStatsCache.get(file)
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) {
    contextStatsCache.delete(file)
    contextStatsCache.set(file, hit) // LRU recency
    return hit.stats
  }

  const stats = computeContextStats(agentId, file)
  contextStatsCache.delete(file)
  contextStatsCache.set(file, { mtimeMs, size, stats })
  while (contextStatsCache.size > CONTEXT_STATS_CACHE_MAX) {
    const oldest = contextStatsCache.keys().next().value
    if (oldest === undefined) break
    contextStatsCache.delete(oldest)
  }
  return stats
}

function computeContextStats(agentId: string, file: string): RuntimeSessionContextStats | null {
  let branch: BranchEntryLike[]
  let context: { messages: AssistantLikeMessage[]; model: { provider: string; modelId: string } | null }
  try {
    const sm = SessionManager.open(file, getAgentSessionsDir(agentId), getAgentWorkspaceDir(agentId))
    branch = sm.getBranch() as BranchEntryLike[]
    context = sm.buildSessionContext() as unknown as typeof context
  } catch {
    // Unreadable session = nothing honest to report — null, never a throw
    // (same posture as the thread map's corrupt-file fallback above it).
    return null
  }

  const compaction = getLatestCompactionEntry(branch as Parameters<typeof getLatestCompactionEntry>[0]) as
    | (BranchEntryLike & { timestamp?: string; tokensBefore?: number })
    | null
    | undefined

  // Model + window: prefer the SESSION's recorded model — the recorded
  // usage was measured against it. Unknown model → window/threshold null.
  const modelRef = context.model ? `${context.model.provider}/${context.model.modelId}` : undefined
  const piModel = modelRef ? findPiModel(modelRef) : undefined
  const contextWindow =
    typeof piModel?.contextWindow === 'number' && piModel.contextWindow > 0 ? piModel.contextWindow : null

  // Compaction guard, INDEX-based (SDK parity): a compaction with no
  // VALID assistant usage recorded AFTER it in the branch means the last
  // anchor describes the PRE-compaction prompt — the reading is unknown.
  let postCompactionUsageExists = true
  if (compaction) {
    const compactionIdx = branch.findIndex((e) => e === compaction || (e.id !== undefined && e.id === compaction.id))
    postCompactionUsageExists =
      compactionIdx >= 0 &&
      branch
        .slice(compactionIdx + 1)
        .some((e) => e.type === 'message' && hasValidUsage(e.message))
  }

  let tokens: number | null = null
  if (postCompactionUsageExists) {
    let lastValidIdx = -1
    for (let i = context.messages.length - 1; i >= 0; i--) {
      if (hasValidUsage(context.messages[i])) {
        lastValidIdx = i
        break
      }
    }
    if (lastValidIdx >= 0) {
      const anchor = context.messages[lastValidIdx]
      tokens = calculateContextTokens(anchor.usage as Parameters<typeof calculateContextTokens>[0])
      for (let i = lastValidIdx + 1; i < context.messages.length; i++) {
        tokens += estimateTokens(context.messages[i] as unknown as Parameters<typeof estimateTokens>[0])
      }
    }
  }

  // Threshold: window − reserveTokens from the SAME settings manager the
  // adapter's turns build (compaction disabled → threshold null).
  let compactionThreshold: number | null = null
  if (contextWindow !== null) {
    try {
      const settings = createTurnSettingsManager(getAgentWorkspaceDir(agentId), getPiAgentDir()).getCompactionSettings()
      if (settings.enabled && settings.reserveTokens > 0 && settings.reserveTokens < contextWindow) {
        compactionThreshold = contextWindow - settings.reserveTokens
      }
    } catch {
      // Settings unreadable → threshold stays null (unknown, never guessed).
    }
  }

  return {
    tokens,
    contextWindow,
    compactionThreshold,
    ...(compaction
      ? {
          lastCompaction: {
            ...(compaction.timestamp ? { at: compaction.timestamp } : {}),
            ...(typeof compaction.tokensBefore === 'number' ? { tokensBefore: compaction.tokensBefore } : {}),
          },
        }
      : {}),
    ...(modelRef ? { model: modelRef } : {}),
  }
}

/** @internal Test-only. */
export function __resetContextStatsCacheForTest(): void {
  contextStatsCache.clear()
}
