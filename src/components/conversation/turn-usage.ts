/**
 * Turn usage display (#733) — the shared shape + formatters for the
 * per-turn footer and thread totals. Unit-per-lane: `costUsd` is only
 * ever present for metered-lane rows (the server enforces it — the kit
 * just renders what it's given and never fabricates).
 */

export interface ConversationTurnUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  costUsd?: number
  model?: string
  lane?: 'metered' | 'subscription'
}

/** Compact token count: 890 → '890', 14200 → '14.2k', 1200000 → '1.2m'. */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${trimZero((tokens / 1_000_000).toFixed(1))}m`
  if (tokens >= 1_000) return `${trimZero((tokens / 1_000).toFixed(1))}k`
  return String(tokens)
}

/** '$0.03'; sub-cent floors at '<$0.01' — never a fabricated-looking $0.00. */
export function formatUsageCost(costUsd: number): string {
  if (costUsd > 0 && costUsd < 0.005) return '<$0.01'
  return `$${costUsd.toFixed(2)}`
}

/** Model id tail after the last '/' ('anthropic/claude-sonnet-5' → 'claude-sonnet-5'). */
export function modelTail(model: string): string {
  const at = model.lastIndexOf('/')
  return at >= 0 ? model.slice(at + 1) : model
}

/** The footer's `·`-joined parts ('14.2k in / 890 out' · '$0.03' · model
 *  tail), in display order; empty = render nothing. The LEGACY line — used
 *  only when a billed total can't be computed (usageFooterLines). */
export function usageFooterParts(usage: ConversationTurnUsage): string[] {
  const parts: string[] = []
  const tokens: string[] = []
  if (usage.inputTokens !== undefined) tokens.push(`${formatTokenCount(usage.inputTokens)} in`)
  if (usage.outputTokens !== undefined) tokens.push(`${formatTokenCount(usage.outputTokens)} out`)
  if (tokens.length) parts.push(tokens.join(' / '))
  else if (usage.totalTokens !== undefined) parts.push(`${formatTokenCount(usage.totalTokens)} tok`)
  if (usage.costUsd !== undefined) parts.push(formatUsageCost(usage.costUsd))
  if (usage.model) parts.push(modelTail(usage.model))
  return parts
}

/**
 * Billed-first cost explainer (#737): line 1 tells the bill story —
 * `371.3k billed · 84% cached · ~10 requests · $0.04 · gpt-5.5` — and
 * answers "why did this turn cost that": an agentic turn's bill is
 * ~context × its internal requests, mostly cached. Line 2 keeps the
 * familiar `in / out`, but ONLY for tool turns (simple turns collapse to
 * one line). `~` marks the derived request count (tool calls + 1);
 * cached% is omitted when cacheRead is unknown (never fabricated). Rows
 * where no billed total is computable fall back to the legacy line.
 */
export function usageFooterLines(usage: ConversationTurnUsage, toolCallCount: number): string[] {
  const billed =
    usage.totalTokens ??
    (usage.inputTokens !== undefined && usage.outputTokens !== undefined
      ? usage.inputTokens + usage.outputTokens
      : undefined)
  if (billed === undefined) {
    const legacy = usageFooterParts(usage)
    return legacy.length ? [legacy.join(' · ')] : []
  }
  const parts: string[] = [`${formatTokenCount(billed)} billed`]
  // cached% only when it's a coherent share of THIS billed base — a
  // cacheRead above the (possibly in+out-fallback) bill would print an
  // impossible ">100% cached" (never fabricate; omit).
  if (usage.cacheReadTokens !== undefined && billed > 0 && usage.cacheReadTokens <= billed) {
    parts.push(`${Math.round((usage.cacheReadTokens / billed) * 100)}% cached`)
  }
  if (toolCallCount > 0) parts.push(`~${toolCallCount + 1} requests`)
  if (usage.costUsd !== undefined) parts.push(formatUsageCost(usage.costUsd))
  if (usage.model) parts.push(modelTail(usage.model))
  const lines = [parts.join(' · ')]
  if (toolCallCount > 0) {
    const inOut: string[] = []
    if (usage.inputTokens !== undefined) inOut.push(`${formatTokenCount(usage.inputTokens)} in`)
    if (usage.outputTokens !== undefined) inOut.push(`${formatTokenCount(usage.outputTokens)} out`)
    if (inOut.length) lines.push(inOut.join(' / '))
  }
  return lines
}

function trimZero(fixed: string): string {
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}
