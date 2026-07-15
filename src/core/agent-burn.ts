/**
 * Agent token-burn heuristics (#385) — the ONE engine behind the
 * usage.agent-burn doctor check, the health /agent-effort endpoint, and the
 * effort card (same anti-drift pattern as context-report.ts / budget.ts).
 *
 * Three explainable, warn-only signals per agent:
 *  - effort-no-outcome: heavy Bakin-attributed burn with zero completed tasks
 *  - spike: today's observed usage far above the agent's own trailing average
 *  - unattributed: a large share of observed tokens happened OUTSIDE
 *    Bakin-managed tasks (transcript-observed minus Bakin-metered — the
 *    direct "is the runtime doing things unsupervised" signal, D11)
 *
 * Data honesty rules: attributed numbers come from the run_costs ledger,
 * observed numbers from the usage.db transcript scans. When the scanner has
 * no coverage for the window, observed/unattributed are null — never a
 * fabricated zero.
 */
import { readUsageHistorySince, toLocalDayKey } from '@bakin/core/usage-history/store'
import { getSettings } from './settings'
import { runTokensByAgentSince, completionsByAgentSince } from './execution-ledger'

export interface BurnConfig {
  windowHours: number
  minTokensFloor: number
  spikeMultiplier: number
  baselineDays: number
  unattributedShare: number
  unattributedFloorTokens: number
}

export interface AgentBurnInputs {
  agent: string
  /** Bakin-metered tokens in the window (run_costs). */
  attributedTokens: number
  attributedCostUsdMicros: number | null
  runs: number
  completions: number
  /** Transcript-observed tokens in the window; null = scanner has no coverage. */
  observedTokens: number | null
  /** Observed tokens for today's local calendar day; null = no coverage. */
  todayObservedTokens: number | null
  /** Observed daily totals for trailing baseline days (excluding today). */
  baselineDailyTokens: number[]
}

export interface BurnFlag {
  kind: 'effort-no-outcome' | 'spike' | 'unattributed'
  message: string
}

export interface AgentBurnReport {
  agent: string
  windowTokens: number
  windowCostUsdMicros: number | null
  runs: number
  completions: number
  tokensPerCompletion: number | null
  totalObservedTokens: number | null
  unattributedTokens: number | null
  flags: BurnFlag[]
}

export interface AgentBurnCoverage {
  agents: ReadonlyArray<{
    agent: string
    status: 'complete' | 'partial'
  }>
}

export interface AgentBurnSources {
  readUsageHistorySince: typeof readUsageHistorySince
  runTokensByAgentSince: typeof runTokensByAgentSince
  completionsByAgentSince: typeof completionsByAgentSince
}

export interface AgentBurnWindowScope {
  since: string
  throughDay: string
  scopeLabel: string
}

const DEFAULT_AGENT_BURN_SOURCES: AgentBurnSources = {
  readUsageHistorySince,
  runTokensByAgentSince,
  completionsByAgentSince,
}

/** 2100000 → "2.1M", 790000 → "790k" — chart-footer-friendly counts. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

/** Pure heuristic evaluation for one agent. */
export function evaluateAgentBurn(
  inputs: AgentBurnInputs,
  config: BurnConfig,
  windowLabel = 'the selected day-aligned window',
): AgentBurnReport {
  const flags: BurnFlag[] = []

  if (inputs.attributedTokens >= config.minTokensFloor && inputs.completions === 0) {
    flags.push({
      kind: 'effort-no-outcome',
      message:
        `'${inputs.agent}' used ${formatTokens(inputs.attributedTokens)} tokens across ` +
        `${inputs.runs} run(s) during ${windowLabel} but completed no tasks — check its timeline`,
    })
  }

  if (inputs.todayObservedTokens !== null && inputs.baselineDailyTokens.length > 0) {
    const avg =
      inputs.baselineDailyTokens.reduce((a, b) => a + b, 0) / inputs.baselineDailyTokens.length
    if (
      avg > 0 &&
      inputs.todayObservedTokens >= config.minTokensFloor &&
      inputs.todayObservedTokens > avg * config.spikeMultiplier
    ) {
      flags.push({
        kind: 'spike',
        message:
          `'${inputs.agent}' used ${formatTokens(inputs.todayObservedTokens)} tokens today, ` +
          `${(inputs.todayObservedTokens / avg).toFixed(1)}× its ${formatTokens(Math.round(avg))} ` +
          `daily average — check its timeline`,
      })
    }
  }

  const unattributedTokens =
    inputs.observedTokens === null ? null : Math.max(0, inputs.observedTokens - inputs.attributedTokens)
  if (
    unattributedTokens !== null &&
    inputs.observedTokens !== null &&
    inputs.observedTokens > 0 &&
    unattributedTokens >= config.unattributedFloorTokens &&
    unattributedTokens / inputs.observedTokens >= config.unattributedShare
  ) {
    flags.push({
      kind: 'unattributed',
      message:
        `'${inputs.agent}' used ${formatTokens(unattributedTokens)} tokens outside ` +
        `Bakin-managed tasks during ${windowLabel} — review its recent sessions`,
    })
  }

  return {
    agent: inputs.agent,
    windowTokens: inputs.attributedTokens,
    windowCostUsdMicros: inputs.attributedCostUsdMicros,
    runs: inputs.runs,
    completions: inputs.completions,
    tokensPerCompletion:
      inputs.completions > 0 ? Math.round(inputs.attributedTokens / inputs.completions) : null,
    totalObservedTokens: inputs.observedTokens,
    unattributedTokens,
    flags,
  }
}

/** Local-midnight epoch ms for a YYYY-MM-DD day key (machine-local, like toLocalDayKey). */
function localDayStartMs(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(y!, m! - 1, d!).getTime()
}

export function getAgentBurnWindowScope(now: number, windowHours: number): AgentBurnWindowScope {
  const since = toLocalDayKey(now - windowHours * 3_600_000)
  const throughDay = toLocalDayKey(now)
  return {
    since,
    throughDay,
    scopeLabel: `${since} through ${throughDay}`,
  }
}

/**
 * Assemble burn inputs for every agent seen in the window (ledger ∪ usage
 * history ∪ completions) and evaluate them. Windows are day-aligned on both
 * sides of the delta join: usage.db is day-granular, so the attributed sums
 * use the same local-midnight start for an apples-to-apples comparison.
 */
export function buildAgentBurnReports(
  now = Date.now(),
  opts: {
    windowHours?: number
    coverage?: AgentBurnCoverage
    config?: BurnConfig
    sources?: AgentBurnSources
  } = {},
): AgentBurnReport[] {
  const config = { ...(opts.config ?? getSettings().burn), ...(opts.windowHours ? { windowHours: opts.windowHours } : {}) }
  const sources = opts.sources ?? DEFAULT_AGENT_BURN_SOURCES
  const windowScope = getAgentBurnWindowScope(now, config.windowHours)
  const windowSinceDay = windowScope.since
  const dayAlignedSinceMs = localDayStartMs(windowSinceDay)
  const today = toLocalDayKey(now)
  const baselineSinceDay = toLocalDayKey(now - config.baselineDays * 86_400_000)
  const earliestDay = baselineSinceDay < windowSinceDay ? baselineSinceDay : windowSinceDay

  const cells = sources.readUsageHistorySince(earliestDay).byAgentDay
  const coverageByAgent = new Map(
    (opts.coverage?.agents ?? []).map((entry) => [entry.agent, entry.status]),
  )

  const attributed = sources.runTokensByAgentSince(dayAlignedSinceMs)
  const completions = sources.completionsByAgentSince(dayAlignedSinceMs)

  const agents = new Set<string>([
    ...attributed.map((r) => r.agent),
    ...completions.map((r) => r.agent),
    ...cells.filter((c) => c.day >= windowSinceDay).map((c) => c.agent),
    ...coverageByAgent.keys(),
  ])

  const reports: AgentBurnReport[] = []
  for (const agent of [...agents].sort()) {
    const att = attributed.find((r) => r.agent === agent)
    const agentCells = cells.filter((c) => c.agent === agent)
    const windowCells = agentCells.filter((c) => c.day >= windowSinceDay)
    const todayCell = agentCells.find((c) => c.day === today)
    const hasCompleteCoverage = coverageByAgent.get(agent) === 'complete'
    reports.push(
      evaluateAgentBurn(
        {
          agent,
          attributedTokens: att?.totalTokens ?? 0,
          attributedCostUsdMicros: att?.costUsdMicros ?? null,
          runs: att?.runs ?? 0,
          completions: completions.find((r) => r.agent === agent)?.completions ?? 0,
          observedTokens: hasCompleteCoverage
            ? windowCells.reduce((sum, c) => sum + c.tokens.total, 0)
            : null,
          todayObservedTokens: hasCompleteCoverage ? todayCell?.tokens.total ?? 0 : null,
          baselineDailyTokens: agentCells
            .filter((c) => c.day >= baselineSinceDay && c.day < today)
            .map((c) => c.tokens.total),
        },
        config,
        windowScope.scopeLabel,
      ),
    )
  }
  return reports
}
