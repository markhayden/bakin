/**
 * Browse-window spend rollups over raw run_costs rows — the NULL-honest
 * replacement for the deleted ledger GROUP-BY verbs (spendTotal/spendByAgent/
 * spendByModel), whose COALESCE(SUM,0) fabricated $0 for unpriced rows.
 *
 * Honesty rules: costUsdMicros sums PRICED rows only and is null when a
 * bucket has none (never a fabricated zero); avg cost/run divides by priced
 * runs only; subscription-lane rows contribute tokens, never dollars (their
 * cost is null by lane suppression upstream).
 */
import type { RunCostSpendRow } from '../../../src/core/execution-ledger'

export interface SpendAgentRollup {
  agent: string
  runs: number
  /** Sum over priced rows; null when none priced (never $0-fabricated). */
  costUsdMicros: number | null
}

export interface SpendModelRollup {
  model: string
  runs: number
  costUsdMicros: number | null
}

export interface SpendWorkClassRollup {
  workClass: string
  runs: number
  totalTokens: number | null
  costUsdMicros: number | null
  subscriptionTokens: number
  /** costUsdMicros / priced runs; null when no priced rows. */
  avgCostUsdMicros: number | null
}

export interface SpendRollups {
  /** Sum of all priced rows (0 when none — the headline pairs with the unpriced note). */
  totalUsdMicros: number
  byAgent: SpendAgentRollup[]
  byModel: SpendModelRollup[]
  byWorkClass: SpendWorkClassRollup[]
}

interface Bucket {
  runs: number
  pricedRuns: number
  cost: number
  tokens: number
  hasTokens: boolean
  subscriptionTokens: number
}

function bucket(): Bucket {
  return { runs: 0, pricedRuns: 0, cost: 0, tokens: 0, hasTokens: false, subscriptionTokens: 0 }
}

function add(b: Bucket, row: RunCostSpendRow): void {
  b.runs += 1
  if (row.costUsdMicros !== null) {
    b.pricedRuns += 1
    b.cost += row.costUsdMicros
  }
  if (row.totalTokens !== null) {
    b.tokens += row.totalTokens
    b.hasTokens = true
  }
  if (row.lane === 'subscription' && row.totalTokens !== null) {
    b.subscriptionTokens += row.totalTokens
  }
}

/** Work-class bucket key: media rows are classless by design; NULL token rows are pre-migration. */
export function workClassKey(row: RunCostSpendRow): string {
  return row.usageKind === 'media' ? 'media' : (row.workClass ?? 'unclassified')
}

export function rollupSpend(rows: RunCostSpendRow[]): SpendRollups {
  const agents = new Map<string, Bucket>()
  const models = new Map<string, Bucket>()
  const classes = new Map<string, Bucket>()
  let total = 0
  for (const row of rows) {
    if (row.costUsdMicros !== null) total += row.costUsdMicros
    const agent = agents.get(row.agent) ?? bucket()
    add(agent, row); agents.set(row.agent, agent)
    const modelKey = row.model || 'unknown'
    const model = models.get(modelKey) ?? bucket()
    add(model, row); models.set(modelKey, model)
    const classKey = workClassKey(row)
    const cls = classes.get(classKey) ?? bucket()
    add(cls, row); classes.set(classKey, cls)
  }
  const cost = (b: Bucket) => (b.pricedRuns > 0 ? b.cost : null)
  const byCostDesc = <T extends { costUsdMicros: number | null; runs: number }>(a: T, b: T) =>
    (b.costUsdMicros ?? -1) - (a.costUsdMicros ?? -1) || b.runs - a.runs
  return {
    totalUsdMicros: total,
    byAgent: [...agents.entries()].map(([agent, b]) => ({ agent, runs: b.runs, costUsdMicros: cost(b) })).sort(byCostDesc),
    byModel: [...models.entries()].map(([model, b]) => ({ model, runs: b.runs, costUsdMicros: cost(b) })).sort(byCostDesc),
    byWorkClass: [...classes.entries()].map(([workClass, b]) => ({
      workClass,
      runs: b.runs,
      totalTokens: b.hasTokens ? b.tokens : null,
      costUsdMicros: cost(b),
      subscriptionTokens: b.subscriptionTokens,
      avgCostUsdMicros: b.pricedRuns > 0 ? Math.round(b.cost / b.pricedRuns) : null,
    })).sort(byCostDesc),
  }
}
