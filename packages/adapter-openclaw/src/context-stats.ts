/**
 * sessions.contextStats for OpenClaw (#737) — a PURE session-store read,
 * fully at rest: threadId → deterministic CLI session id
 * (openClawCliSessionId) → explicit store key → sessions.json entry via
 * the mtime-guarded cache. No gateway RPCs, no trajectory reads — the
 * trajectory's usage accumulates across a run's API calls on the
 * embedded path (OpenClaw's own types say so), which is exactly the
 * billing-aggregate trap behind the 109% incident.
 *
 * Honesty gates (OpenClaw's own buildSessionUsageSnapshot rules):
 * `totalTokens` counts as the context reading ONLY when
 * `totalTokensFresh === true`; the window comes only from the stored
 * `contextTokens`; the compaction threshold comes ONLY from a
 * runtime-written contextBudgetStatus (codex-native compaction is opaque
 * — deriving a threshold from config guesses is banned). Anything not
 * knowable is null, never zero.
 */
import type { RuntimeSessionContextStats } from '@bakin/core/adapters/runtime'
import { join } from 'path'

import { getOpenClawPath } from './home'
import {
  openClawCliSessionId,
  openClawExplicitSessionKey,
  readSessionStoreCached,
  type OpenClawSessionStoreEntry,
} from './session-store'

interface CompactionCheckpointLike {
  createdAt?: number
  reason?: string
  tokensBefore?: number
}

interface ContextStatsEntry extends OpenClawSessionStoreEntry {
  totalTokensFresh?: boolean
  contextTokens?: number
  compactionCount?: number
  compactionCheckpoints?: CompactionCheckpointLike[]
  contextBudgetStatus?: { contextTokenBudget?: number; reserveTokens?: number }
}

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export async function openClawSessionContextStats(opts: {
  agentId: string
  threadId: string
}): Promise<RuntimeSessionContextStats | null> {
  const { agentId, threadId } = opts
  const storePath = join(getOpenClawPath('agents', agentId, 'sessions'), 'sessions.json')
  const store = readSessionStoreCached(storePath)
  if (!store) return null

  const key = openClawExplicitSessionKey(agentId, openClawCliSessionId(agentId, threadId))
  const entry = store[key] as ContextStatsEntry | undefined
  if (!entry || typeof entry.sessionId !== 'string' || entry.sessionId.length === 0) return null

  const contextWindow = finitePositive(entry.contextTokens)

  // The gateway's last-call prompt snapshot — honest ONLY when fresh.
  let tokens: number | null = null
  if (entry.totalTokensFresh === true) {
    const total = typeof entry.totalTokens === 'number' && Number.isFinite(entry.totalTokens) ? entry.totalTokens : null
    if (total !== null && total >= 0) {
      tokens = contextWindow !== null ? Math.min(Math.floor(total), contextWindow) : Math.floor(total)
    }
  }

  // Threshold: only from the runtime's OWN persisted budget status
  // (embedded compactor). Codex-native sessions never get one — null.
  let compactionThreshold: number | null = null
  const budget = entry.contextBudgetStatus
  const budgetWindow = finitePositive(budget?.contextTokenBudget)
  const reserve = finitePositive(budget?.reserveTokens)
  if (budgetWindow !== null && reserve !== null && reserve < budgetWindow) {
    compactionThreshold = budgetWindow - reserve
  }

  // Newest compaction checkpoint, when the gateway recorded any.
  const checkpoints = Array.isArray(entry.compactionCheckpoints) ? entry.compactionCheckpoints : []
  const newest = checkpoints.reduce<CompactionCheckpointLike | null>((best, cp) => {
    if (typeof cp?.createdAt !== 'number') return best
    return best === null || (cp.createdAt ?? 0) > (best.createdAt ?? 0) ? cp : best
  }, null)

  return {
    tokens,
    contextWindow,
    compactionThreshold,
    ...(newest
      ? {
          lastCompaction: {
            ...(typeof newest.createdAt === 'number' ? { at: new Date(newest.createdAt).toISOString() } : {}),
            ...(typeof newest.tokensBefore === 'number' ? { tokensBefore: newest.tokensBefore } : {}),
            ...(typeof newest.reason === 'string' ? { reason: newest.reason } : {}),
          },
        }
      : {}),
    ...(typeof entry.model === 'string' && entry.model ? { model: entry.model } : {}),
  }
}
