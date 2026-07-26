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
 *  tail), in display order; empty = render nothing. */
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

function trimZero(fixed: string): string {
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}
