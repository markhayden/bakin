/**
 * Agent token-burn heuristics (#385, buckets #691) — the ONE engine behind
 * the usage.agent-burn doctor check, the health /agent-effort endpoint, and
 * the effort card (same anti-drift pattern as context-report.ts / budget.ts).
 *
 * Explainable signals per agent:
 *  - effort-no-outcome: heavy Bakin-attributed burn with zero completed tasks
 *  - spike: today's observed usage far above the agent's own trailing average
 *  - interactive (advisory): observed tokens from sessions Bakin never
 *    originated (operator TUI/direct chats) — normal use, labeled calmly
 *  - unexplained (watch): observed tokens from Bakin-originated or
 *    unknown-origin sessions that no ledger row accounts for
 *  - runaway (loud): autonomous accumulation with real indicators — an
 *    external session burning tokens across many assistant turns with ZERO
 *    user turns, or unexplained + spike on the same day. Downgraded to a
 *    review prompt when the runtime has native scheduled jobs (legitimate
 *    autonomous work must never trigger a false page — D11).
 *
 * Data honesty rules: attributed numbers come from the run_costs ledger,
 * observed numbers from the usage.db transcript scans. When the scanner has
 * no coverage for the window, observed/split totals are null. Unknown-origin
 * tokens count toward unexplained, never toward interactive — the calm
 * bucket must be provable. Unknown values stay null — never fabricated zero.
 */
import {
  readUsageHistorySince,
  readSessionUsageRollupsSince,
  toLocalDayKey,
} from '@bakin/core/usage-history/store'
import { getSettings } from './settings'
import { runTokensByAgentSince, completionsByAgentSince } from './execution-ledger'

export interface BurnConfig {
  windowHours: number
  minTokensFloor: number
  spikeMultiplier: number
  baselineDays: number
  unattributedShare: number
  unattributedFloorTokens: number
  /** Token-bearing assistant turns a zero-user-turn session needs to look runaway. */
  runawayAssistantTurns: number
  /** Minimum tokens a zero-user-turn session needs to look runaway. */
  runawayFloorTokens: number
}

/** One runtime-native scheduled job, as cron-guard evidence (D11). */
export interface ScheduledJobEvidence {
  id: string
  name: string
}

/** A session's window rollup, as runaway evidence. */
export interface BurnSessionRollup {
  sessionId: string
  origin: 'bakin' | 'external' | 'unknown'
  totalTokens: number
  userMessages: number
  assistantMessages: number
}

export interface AgentBurnInputs {
  agent: string
  /** Bakin-metered tokens; null = one or more token-bearing ledger runs were not metered. */
  attributedTokens: number | null
  /** Tracked cost in the window; null = no activity or one or more runs were unpriced. */
  attributedCostUsdMicros: number | null
  runs: number
  /** Runs for which token evidence is meaningful; media work is excluded. */
  tokenApplicableRuns: number
  /** Token-bearing runs with reported totals. Less than tokenApplicableRuns is partial. */
  tokenMeteredRuns: number
  /** False when the reported token subtotal exceeds the safe wire integer range. */
  tokenAggregateRepresentable: boolean
  /** Runs with reported tracked cost. Less than runs means tracked cost is partial. */
  costedRuns: number
  /** False when the reported cost subtotal exceeds the safe wire integer range. */
  costAggregateRepresentable: boolean
  completions: number
  /** Transcript-observed tokens in the window; null = scanner has no coverage. */
  observedTokens: number | null
  /** Observed tokens for today's local calendar day; null = no coverage. */
  todayObservedTokens: number | null
  /** Observed daily totals for trailing baseline days (excluding today). */
  baselineDailyTokens: number[]
  /**
   * Per-session rollups (window-scoped tokens/turns, span-scoped user
   * counts) — the evidence unit behind the interactive bucket and the
   * runaway heuristic; empty = none/no coverage.
   */
  sessions: BurnSessionRollup[]
  /**
   * Runtime-native scheduled jobs (cron guard, D11). null = the runtime has
   * no cron surface or it could not be read — NO downgrade happens on null
   * (fail loud, not silent); [] = surface read, no jobs.
   */
  scheduledJobs: ScheduledJobEvidence[] | null
}

export type BurnFlag =
  | { kind: 'effort-no-outcome'; message: string }
  | { kind: 'spike'; message: string }
  /** Advisory: direct-chat/TUI usage — normal, labeled calmly. */
  | { kind: 'interactive'; message: string; tokens: number }
  /** Watch: tokens no ledger row or interactive session explains. */
  | { kind: 'unexplained'; message: string; tokens: number; spikeConcurrent: boolean }
  /**
   * Loud: evidence-backed autonomous accumulation. `downgraded` = the
   * runtime has native scheduled jobs, so this is a review prompt (watch),
   * never a page — legitimate autonomous work must not cry wolf (D11).
   */
  | {
      kind: 'runaway'
      message: string
      sessions: Array<{ sessionId: string; tokens: number; assistantTurns: number }>
      scheduledJobs: string[]
      downgraded: boolean
    }

export interface AgentBurnReport {
  agent: string
  /** Bakin-metered tokens; null = one or more token-bearing ledger runs were not metered. */
  windowTokens: number | null
  /** Tracked cost; null = no activity or one or more recorded runs were unpriced. */
  windowCostUsdMicros: number | null
  runs: number
  tokenApplicableRuns: number
  tokenMeteredRuns: number
  tokenAggregateRepresentable: boolean
  costedRuns: number
  costAggregateRepresentable: boolean
  completions: number
  tokensPerCompletion: number | null
  totalObservedTokens: number | null
  /** Observed tokens from interactive (external-origin) sessions; null = no coverage. */
  interactiveTokens: number | null
  /** Observed bakin/unknown-origin tokens minus attributed, clamped ≥ 0; null = incomplete evidence. */
  unexplainedTokens: number | null
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
  readSessionUsageRollupsSince: typeof readSessionUsageRollupsSince
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
  readSessionUsageRollupsSince,
  runTokensByAgentSince,
  completionsByAgentSince,
}

/** 2100000 → "2.1M", 790000 → "790k" — chart-footer-friendly counts. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function isNonNegativeSafeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0
}

/** Pure heuristic evaluation for one agent. */
export function evaluateAgentBurn(
  inputs: AgentBurnInputs,
  config: BurnConfig,
  windowLabel = 'the selected day-aligned window',
): AgentBurnReport {
  const flags: BurnFlag[] = []
  const hasCompleteAttributedEvidence = inputs.tokenApplicableRuns <= inputs.runs
    && inputs.tokenMeteredRuns <= inputs.tokenApplicableRuns
    && inputs.tokenMeteredRuns === inputs.tokenApplicableRuns
    && inputs.tokenAggregateRepresentable
    && isNonNegativeSafeInteger(inputs.attributedTokens)
  const attributedTokens = hasCompleteAttributedEvidence ? inputs.attributedTokens : null
  const attributedCostUsdMicros = inputs.runs > 0
    && inputs.costedRuns === inputs.runs
    && inputs.costAggregateRepresentable
    && isNonNegativeSafeInteger(inputs.attributedCostUsdMicros)
    ? inputs.attributedCostUsdMicros
    : null

  if (
    hasCompleteAttributedEvidence &&
    attributedTokens !== null &&
    attributedTokens >= config.minTokensFloor &&
    inputs.completions === 0
  ) {
    flags.push({
      kind: 'effort-no-outcome',
      message:
        `'${inputs.agent}' used ${formatTokens(attributedTokens)} tokens across ` +
        `${inputs.runs} run(s) during ${windowLabel} but completed no tasks — check its timeline`,
    })
  }

  if (
    hasCompleteAttributedEvidence
    && inputs.todayObservedTokens !== null
    && inputs.baselineDailyTokens.length > 0
  ) {
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

  // ---- provenance buckets (#691) ----------------------------------------
  // interactive = external-origin sessions WITH user turns (the operator's
  // own chats — calm, and provably so: a zero-user-turn external session is
  // autonomous accumulation, not a chat, and must never wear the calm
  // label). Everything else observed lands in unexplained = observed minus
  // interactive minus attributed (nobody can explain these tokens — worth a
  // look). Unknown origin NEVER counts as interactive either.
  const interactiveTokens = inputs.observedTokens === null
    ? null
    : Math.min(
        inputs.sessions
          .filter((session) => session.origin === 'external' && session.userMessages > 0)
          .reduce((sum, session) => sum + session.totalTokens, 0),
        inputs.observedTokens,
      )
  const unexplainedTokens =
    inputs.observedTokens === null || interactiveTokens === null || attributedTokens === null
      ? null
      : Math.max(0, inputs.observedTokens - interactiveTokens - attributedTokens)

  if (
    interactiveTokens !== null &&
    inputs.observedTokens !== null &&
    inputs.observedTokens > 0 &&
    interactiveTokens >= config.unattributedFloorTokens &&
    interactiveTokens / inputs.observedTokens >= config.unattributedShare
  ) {
    flags.push({
      kind: 'interactive',
      tokens: interactiveTokens,
      message:
        `'${inputs.agent}' used ${formatTokens(interactiveTokens)} tokens in interactive runtime ` +
        `sessions (direct chats/TUI) not tied to board tasks during ${windowLabel} — ` +
        `normal if you were working with this agent directly`,
    })
  }

  const spikeConcurrent = flags.some((flag) => flag.kind === 'spike')
  if (
    unexplainedTokens !== null &&
    inputs.observedTokens !== null &&
    inputs.observedTokens > 0 &&
    unexplainedTokens >= config.unattributedFloorTokens &&
    unexplainedTokens / inputs.observedTokens >= config.unattributedShare
  ) {
    flags.push({
      kind: 'unexplained',
      tokens: unexplainedTokens,
      spikeConcurrent,
      message:
        `'${inputs.agent}' used ${formatTokens(unexplainedTokens)} tokens Bakin could not attribute ` +
        `to tasks, system sends, or interactive sessions during ${windowLabel} — review its recent sessions` +
        (spikeConcurrent ? ' — and usage is well above its daily average, review soon' : ''),
    })
  }

  // ---- runaway (#691, D9/D11) -------------------------------------------
  // Only with real indicators: an external-origin session accumulating
  // token-bearing autonomous turns with ZERO user interaction, or an
  // unexplained bucket coinciding with a spike. Unknown-origin sessions
  // never page — "cannot tell" is not evidence of runaway. Session token and
  // turn sums are WINDOW-scoped (a session that went quiet before the window
  // has zero window evidence and cannot re-page for days after the user
  // already dealt with it), while user counts span the wider baseline so a
  // pre-window user turn still proves interaction.
  const runawaySessions = inputs.sessions
    .filter((session) =>
      session.origin === 'external' &&
      session.userMessages === 0 &&
      session.assistantMessages >= config.runawayAssistantTurns &&
      session.totalTokens >= config.runawayFloorTokens,
    )
    .map((session) => ({
      sessionId: session.sessionId,
      tokens: session.totalTokens,
      assistantTurns: session.assistantMessages,
    }))
  const unexplainedSpike = unexplainedTokens !== null
    && unexplainedTokens >= config.runawayFloorTokens
    && spikeConcurrent
  if (runawaySessions.length > 0 || unexplainedSpike) {
    const jobs = inputs.scheduledJobs ?? []
    const downgraded = jobs.length > 0
    const evidence = runawaySessions.length > 0
      ? `${runawaySessions.reduce((sum, s) => sum + s.assistantTurns, 0)} autonomous turns / ` +
        `${formatTokens(runawaySessions.reduce((sum, s) => sum + s.tokens, 0))} tokens with no user interaction`
      : `${formatTokens(unexplainedTokens ?? 0)} unexplained tokens well above its daily average`
    flags.push({
      kind: 'runaway',
      sessions: runawaySessions,
      scheduledJobs: jobs.map((job) => job.name),
      downgraded,
      message: downgraded
        ? `'${inputs.agent}' has high autonomous usage (${evidence}) and this runtime also has ` +
          `${jobs.length} scheduled job(s) (${jobs.map((job) => job.name).join(', ')}) — review if unexpected`
        : `'${inputs.agent}' shows possible runaway usage: ${evidence} — investigate now`,
    })
  }

  return {
    agent: inputs.agent,
    windowTokens: attributedTokens,
    windowCostUsdMicros: attributedCostUsdMicros,
    runs: inputs.runs,
    tokenApplicableRuns: inputs.tokenApplicableRuns,
    tokenMeteredRuns: inputs.tokenMeteredRuns,
    tokenAggregateRepresentable: inputs.tokenAggregateRepresentable,
    costedRuns: inputs.costedRuns,
    costAggregateRepresentable: inputs.costAggregateRepresentable,
    completions: inputs.completions,
    tokensPerCompletion:
      inputs.completions > 0 && attributedTokens !== null
        ? Math.round(attributedTokens / inputs.completions)
        : null,
    totalObservedTokens: inputs.observedTokens,
    interactiveTokens,
    unexplainedTokens,
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
    /**
     * Runtime-native scheduled jobs for the runaway cron guard (D11),
     * pre-fetched by the caller (the engine stays sync/pure). null = no cron
     * surface or the read failed — no downgrade on null.
     */
    scheduledJobs?: ScheduledJobEvidence[] | null
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

  // Session rollups: token/turn sums are window-scoped, user counts span the
  // WIDER baseline — the runaway predicate requires zero user turns, and a
  // user turn just before the burn window boundary (yesterday evening's
  // instructions for overnight work) is still real interaction, while a
  // session that went quiet before the window has zero window evidence and
  // cannot look runaway again after the user already dealt with it.
  const cells = sources.readUsageHistorySince(earliestDay).byAgentDay
  const sessionRollups = sources.readSessionUsageRollupsSince(windowSinceDay, earliestDay)
  const sessionsByAgent = new Map<string, BurnSessionRollup[]>()
  for (const rollup of sessionRollups) {
    const list = sessionsByAgent.get(rollup.agent) ?? []
    list.push({
      sessionId: rollup.sessionId,
      origin: rollup.origin,
      totalTokens: rollup.totalTokens,
      userMessages: rollup.userMessages,
      assistantMessages: rollup.assistantMessages,
    })
    sessionsByAgent.set(rollup.agent, list)
  }
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
          attributedTokens: att ? att.totalTokens : 0,
          attributedCostUsdMicros: att?.costUsdMicros ?? null,
          runs: att?.runs ?? 0,
          tokenApplicableRuns: att?.tokenApplicableRuns ?? 0,
          tokenMeteredRuns: att?.tokenMeteredRuns ?? 0,
          tokenAggregateRepresentable: att?.tokenAggregateRepresentable ?? true,
          costedRuns: att?.costedRuns ?? 0,
          costAggregateRepresentable: att?.costAggregateRepresentable ?? true,
          completions: completions.find((r) => r.agent === agent)?.completions ?? 0,
          observedTokens: hasCompleteCoverage
            ? windowCells.reduce((sum, c) => sum + c.tokens.total, 0)
            : null,
          todayObservedTokens: hasCompleteCoverage ? todayCell?.tokens.total ?? 0 : null,
          baselineDailyTokens: agentCells
            .filter((c) => c.day >= baselineSinceDay && c.day < today)
            .map((c) => c.tokens.total),
          sessions: hasCompleteCoverage ? sessionsByAgent.get(agent) ?? [] : [],
          scheduledJobs: opts.scheduledJobs ?? null,
        },
        config,
        windowScope.scopeLabel,
      ),
    )
  }
  return reports
}
