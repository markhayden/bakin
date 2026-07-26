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

export interface ChatUsageContextDto {
  /** Prompt size of the LAST settled turn: input + cache-read tokens —
   *  the provider's own report; drops after a runtime compaction. */
  tokens: number
  model?: string
  /** The model's numeric context window (models hook); absent = unknown. */
  window?: number
}

export interface ChatUsageDecoration {
  usage: Record<string, ChatTurnUsageDto>
  totals?: ChatUsageTotalsDto
  context?: ChatUsageContextDto
}

/** ctx.hooks slice the window lookup needs (invoke may resolve undefined
 *  when no handler answers — matches PluginContext's HookAPI). */
export interface UsageHookInvoker {
  has(name: string): boolean
  invoke<R>(name: string, data: unknown): Promise<R | undefined>
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

/** Pure: the last settled turn's prompt size (input + cache reads). */
export function lastTurnContext(rows: RunCostByPrefixRow[]): Omit<ChatUsageContextDto, 'window'> | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (row.inputTokens !== null) {
      return {
        tokens: row.inputTokens + (row.cacheReadTokens ?? 0),
        ...(row.model !== null ? { model: row.model } : {}),
      }
    }
  }
  return undefined
}

/** The model's numeric context window via the models hook; undefined =
 *  unknown (hook absent, model unlisted, or lookup failed) — never guessed. */
async function resolveContextWindow(hooks: UsageHookInvoker | undefined, model: string): Promise<number | undefined> {
  if (!hooks?.has('models.getAvailableModels')) return undefined
  try {
    const models = await hooks.invoke<Array<{ id?: string; contextWindow?: number }>>('models.getAvailableModels', {})
    const hit = Array.isArray(models) ? models.find((m) => m?.id === model) : undefined
    return typeof hit?.contextWindow === 'number' && hit.contextWindow > 0 ? hit.contextWindow : undefined
  } catch (err) {
    log.error(`context-window lookup failed for model ${model}`, err as Error)
    return undefined
  }
}

/**
 * The route-facing join. A ledger failure returns undefined — the caller
 * omits the fields entirely (honest absence; the transcript still serves).
 */
export async function chatTurnUsage(
  chatId: string,
  hooks?: UsageHookInvoker,
  load: (prefix: string) => RunCostByPrefixRow[] = listRunCostsByPrefix,
): Promise<ChatUsageDecoration | undefined> {
  let rows: RunCostByPrefixRow[]
  try {
    rows = load(`chat:${chatId}${TURN_MARKER}`)
  } catch (err) {
    log.error(`turn-usage join failed for chat ${chatId} — serving without usage`, err as Error)
    return undefined
  }
  const decoration = buildTurnUsage(rows)
  const context = lastTurnContext(rows)
  if (!context) return decoration
  const window = context.model ? await resolveContextWindow(hooks, context.model) : undefined
  return { ...decoration, context: { ...context, ...(window !== undefined ? { window } : {}) } }
}
