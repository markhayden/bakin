/**
 * sessions.contextStats for Pi (#737) — the honest context reading,
 * FILE-ONLY at rest. Mirrors the SDK's own getContextUsage semantics
 * (which is not callable without a heavy, session-MUTATING
 * createAgentSession): the last VALID assistant message's
 * usage.totalTokens is the provider's exact prompt snapshot, entries
 * after it add a chars÷4 estimate, and a post-compaction gap (no valid
 * usage newer than the compaction) reads tokens: null — never the stale
 * pre-compaction number. `estimateContextTokens` itself is not exported
 * by the SDK, so this re-implements it (~12 lines) over the exported
 * calculateContextTokens + estimateTokens.
 *
 * NEVER on this path: SessionManager.create (mints sessions),
 * createAgentSession (mutates the file + loads extensions), or
 * withThreadLock (reads must not queue behind turns; the JSONL appends
 * whole entries, so a mid-turn read is one turn stale, never torn).
 */
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
  timestamp?: string
  stopReason?: string
  usage?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    totalTokens?: number
  }
}

/** The SDK's valid-usage predicate: settled assistant with non-zero usage. */
function hasValidUsage(m: AssistantLikeMessage): boolean {
  if (m.role !== 'assistant' || !m.usage) return false
  if (m.stopReason === 'aborted' || m.stopReason === 'error') return false
  const u = m.usage
  return (u.totalTokens ?? 0) > 0 || (u.input ?? 0) > 0 || (u.output ?? 0) > 0 || (u.cacheRead ?? 0) > 0
}

export async function sessionContextStats(opts: {
  agentId: string
  threadId: string
}): Promise<RuntimeSessionContextStats | null> {
  const { agentId, threadId } = opts
  const file = getThreadSessionFile(agentId, threadId)
  if (!file) return null

  let branch: unknown[]
  let context: { messages: AssistantLikeMessage[]; model: { provider: string; modelId: string } | null }
  try {
    const sm = SessionManager.open(file, getAgentSessionsDir(agentId), getAgentWorkspaceDir(agentId))
    branch = sm.getBranch()
    context = sm.buildSessionContext() as unknown as typeof context
  } catch {
    // Unreadable session = nothing honest to report — null, never a throw
    // (same posture as the thread map's corrupt-file fallback above it).
    return null
  }

  const compaction = getLatestCompactionEntry(branch as Parameters<typeof getLatestCompactionEntry>[0]) as
    | { timestamp?: string; tokensBefore?: number }
    | null
    | undefined

  // Model + window: prefer the SESSION's recorded model — the recorded
  // usage was measured against it. Unknown model → window/threshold null.
  const modelRef = context.model ? `${context.model.provider}/${context.model.modelId}` : undefined
  const piModel = modelRef ? findPiModel(modelRef) : undefined
  const contextWindow =
    typeof piModel?.contextWindow === 'number' && piModel.contextWindow > 0 ? piModel.contextWindow : null

  // Current context — the SDK's estimateContextTokens, re-implemented:
  // last valid assistant usage anchors the exact reading; later entries
  // add a chars÷4 estimate. Post-compaction with no newer valid usage →
  // null (the SDK's own honesty rule).
  let lastValidIdx = -1
  for (let i = context.messages.length - 1; i >= 0; i--) {
    if (hasValidUsage(context.messages[i])) {
      lastValidIdx = i
      break
    }
  }
  let tokens: number | null = null
  const compactedAt = compaction?.timestamp
  const anchor = lastValidIdx >= 0 ? context.messages[lastValidIdx] : undefined
  const anchorIsPreCompaction =
    anchor !== undefined && compactedAt !== undefined && (anchor.timestamp ?? '') <= compactedAt
  if (anchor && !anchorIsPreCompaction) {
    tokens = calculateContextTokens(anchor.usage as Parameters<typeof calculateContextTokens>[0])
    for (let i = lastValidIdx + 1; i < context.messages.length; i++) {
      tokens += estimateTokens(context.messages[i] as unknown as Parameters<typeof estimateTokens>[0])
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
