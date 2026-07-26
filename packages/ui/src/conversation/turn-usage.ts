/** Recorded usage for one settled conversation turn. */
export interface ConversationTurnUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  costUsd?: number
  model?: string
  lane?: 'metered' | 'subscription'
}

/** Compact token count: 890 → 890, 14200 → 14.2k, 1200000 → 1.2m. */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${trimZero((tokens / 1_000_000).toFixed(1))}m`
  if (tokens >= 1_000) return `${trimZero((tokens / 1_000).toFixed(1))}k`
  return String(tokens)
}

/** $0.03; sub-cent values stay visibly non-zero. */
export function formatUsageCost(costUsd: number): string {
  if (costUsd > 0 && costUsd < 0.005) return '<$0.01'
  return `$${costUsd.toFixed(2)}`
}

function modelTail(model: string): string {
  const separator = model.lastIndexOf('/')
  return separator >= 0 ? model.slice(separator + 1) : model
}

function legacyUsageParts(usage: ConversationTurnUsage): string[] {
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

/** Human-readable, billed-first footer lines for a settled turn. */
export function usageFooterLines(
  usage: ConversationTurnUsage,
  toolCallCount: number,
): string[] {
  const billed = usage.totalTokens
    ?? (
      usage.inputTokens !== undefined && usage.outputTokens !== undefined
        ? usage.inputTokens + usage.outputTokens
        : undefined
    )

  if (billed === undefined) {
    const legacy = legacyUsageParts(usage)
    return legacy.length ? [legacy.join(' · ')] : []
  }

  const parts = [`${formatTokenCount(billed)} billed`]
  if (
    usage.cacheReadTokens !== undefined
    && billed > 0
    && usage.cacheReadTokens <= billed
  ) {
    parts.push(`${Math.floor((usage.cacheReadTokens / billed) * 100)}% cached`)
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

function trimZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value
}
