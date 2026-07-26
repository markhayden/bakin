/**
 * Per-turn usage decoration (#733) — a display-layer join over the ONE
 * spend engine's rows. Chat turns meter under runId
 * `chat:<chatId>:turn:<turnId>`; this maps those ledger rows into the
 * GET response's `usage` (per-turn) + `usageTotals` (chat sum).
 *
 * Honesty rules: `costUsd` exists ONLY for lane='metered' rows with a
 * recorded cost (unit-per-lane — subscription/unknown lanes never show
 * fabricated dollars); missing numbers are ABSENT, never zero; a ledger
 * failure yields undefined (the transcript still serves).
 */
import type { AgentRuntimeAdapter, RuntimeSessionContextStats } from '@bakin/core/adapters/runtime'

import {
  listRunCostsByPrefix,
  type RunCostByPrefixRow,
} from '../../../src/core/execution-ledger'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('chat-usage')

export interface ChatTurnUsageDto {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  costUsd?: number
  model?: string
  lane?: 'metered' | 'subscription'
}

export interface ChatUsageTotalsDto {
  turns: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number
}

export interface ChatUsageDecoration {
  usage: Record<string, ChatTurnUsageDto>
  totals?: ChatUsageTotalsDto
}

const TURN_MARKER = ':turn:'

/** Pure mapping: ledger rows → per-turn DTOs + honest sums. */
export function buildTurnUsage(rows: RunCostByPrefixRow[]): ChatUsageDecoration {
  const usage: Record<string, ChatTurnUsageDto> = {}
  let turns = 0
  let inputSum: number | undefined
  let outputSum: number | undefined
  let totalSum: number | undefined
  let costSum: number | undefined

  for (const row of rows) {
    const markerAt = row.runId.indexOf(TURN_MARKER)
    if (markerAt < 0) continue
    const turnId = row.runId.slice(markerAt + TURN_MARKER.length)
    if (!turnId) continue

    const costUsd =
      row.lane === 'metered' && row.costUsdMicros !== null ? row.costUsdMicros / 1_000_000 : undefined
    const dto: ChatTurnUsageDto = {
      ...(row.inputTokens !== null ? { inputTokens: row.inputTokens } : {}),
      ...(row.outputTokens !== null ? { outputTokens: row.outputTokens } : {}),
      ...(row.totalTokens !== null ? { totalTokens: row.totalTokens } : {}),
      ...(row.cacheReadTokens !== null ? { cacheReadTokens: row.cacheReadTokens } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
      ...(row.model !== null ? { model: row.model } : {}),
      ...(row.lane !== null ? { lane: row.lane } : {}),
    }
    usage[turnId] = dto
    turns += 1
    if (row.inputTokens !== null) inputSum = (inputSum ?? 0) + row.inputTokens
    if (row.outputTokens !== null) outputSum = (outputSum ?? 0) + row.outputTokens
    const rowTotal =
      row.totalTokens ??
      (row.inputTokens !== null && row.outputTokens !== null ? row.inputTokens + row.outputTokens : null)
    if (rowTotal !== null) totalSum = (totalSum ?? 0) + rowTotal
    if (costUsd !== undefined) costSum = (costSum ?? 0) + costUsd
  }

  return {
    usage,
    ...(turns > 0
      ? {
          totals: {
            turns,
            ...(inputSum !== undefined ? { inputTokens: inputSum } : {}),
            ...(outputSum !== undefined ? { outputTokens: outputSum } : {}),
            ...(totalSum !== undefined ? { totalTokens: totalSum } : {}),
            ...(costSum !== undefined ? { costUsd: costSum } : {}),
          },
        }
      : {}),
  }
}

/**
 * The compaction-bar source (#737): the runtime's own context reading for
 * this chat's session, feature-detected. Absent member, null reading, or
 * a throwing adapter all yield undefined — the GET omits the field and
 * the UI renders no bar (honest absence; the transcript still serves).
 */
export async function chatContextStats(
  sessions: AgentRuntimeAdapter['sessions'],
  agentId: string,
  chatId: string,
): Promise<RuntimeSessionContextStats | undefined> {
  const member = sessions.contextStats
  if (!member) return undefined
  try {
    const stats = await member.call(sessions, { agentId, threadId: `chat:${chatId}` })
    return stats ?? undefined
  } catch (err) {
    log.error(`context-stats read failed for chat ${chatId} — serving without the bar`, err as Error)
    return undefined
  }
}

/**
 * The route-facing join. A ledger failure returns undefined — the caller
 * omits the fields entirely (honest absence; the transcript still serves).
 */
export function chatTurnUsage(
  chatId: string,
  load: (prefix: string) => RunCostByPrefixRow[] = listRunCostsByPrefix,
): ChatUsageDecoration | undefined {
  try {
    return buildTurnUsage(load(`chat:${chatId}${TURN_MARKER}`))
  } catch (err) {
    log.error(`turn-usage join failed for chat ${chatId} — serving without usage`, err as Error)
    return undefined
  }
}
