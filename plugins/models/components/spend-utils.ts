import type {
  BudgetRuleWire,
  LaneSumsWire,
  ScopeSpendWire,
  WindowSpendWire,
} from './use-models-data'

export function formatUsd(micros: number | null, unpricedTokens = 0): string {
  if (micros == null || (micros === 0 && unpricedTokens > 0)) return '$ unavailable'
  return `$${(micros / 1_000_000).toFixed(micros > 0 && micros < 10_000 ? 4 : 2)}`
}

export function formatTokens(tokens: number | null): string {
  if (tokens == null) return '—'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

export function formatRuleUnit(
  lane: BudgetRuleWire['lane'],
  value: number,
  valueIsMicros: boolean,
): string {
  if (lane === 'metered') return `$${(valueIsMicros ? value / 1_000_000 : value).toFixed(2)}`
  return `${formatTokens(value)} tokens`
}

export function parseCapInput(raw: string): number | undefined {
  const text = raw.trim()
  if (!text) return undefined
  const match = /^([0-9]*\.?[0-9]+)\s*([kKmM])?$/.exec(text)
  if (!match) return undefined
  const base = Number(match[1])
  if (!Number.isFinite(base) || base <= 0) return undefined
  const suffix = match[2]?.toLowerCase()
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1
  return base * multiplier
}

export function budgetRuleLabel(rule: BudgetRuleWire): string {
  const scope = rule.scope === 'global'
    ? 'Global'
    : `${rule.scope[0]?.toUpperCase()}${rule.scope.slice(1)} ${rule.scopeId ?? ''}`.trim()
  return `${scope} · ${rule.lane}`
}

export function budgetRuleSpend(rule: BudgetRuleWire, window: WindowSpendWire): number {
  const bucket: ScopeSpendWire | LaneSumsWire | undefined = rule.scope === 'global'
    ? window.global
    : rule.scope === 'agent'
      ? window.byAgent[rule.scopeId ?? '']
      : rule.scope === 'provider'
        ? window.byProvider[rule.scopeId ?? '']
        : window.byModel[rule.scopeId ?? '']

  if (!bucket) return 0
  const unattributed = (bucket as Partial<ScopeSpendWire>).unattributed
  return rule.lane === 'subscription'
    ? bucket.subscriptionTokens + (unattributed?.subscriptionTokens ?? 0)
    : bucket.meteredUsdMicros + (unattributed?.meteredUsdMicros ?? 0)
}
