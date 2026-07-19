/**
 * The ONE spend engine behind every budget surface (cost-control v2, #464):
 * the dispatch gate, the billed-media gate, the budget health check,
 * /spend, /budget/status, and the CLI all consume assembleBudgetSpend so
 * their numbers structurally cannot drift.
 *
 * Cap basis is TOTAL OBSERVED (spec V4): attributed spend from the ledger's
 * run_costs plus the observed-minus-attributed delta from usage.db
 * (transcript scans), computed per (agent, local day, lane) and clamped at
 * zero per agent — a runaway agent loop outside Bakin-managed tasks still
 * moves the caps. Honesty rules: dollars only where reported/priced
 * (NULL-honest), subscription lanes never carry dollars (unit-per-lane, V8),
 * provider/model facets are attributed-only (observed model ids can't be
 * provider-resolved authoritatively — the delta lands on agent/global).
 *
 * usage.db lags its scan interval (~5 min) — acceptable for runaway
 * protection, documented on the surfaces.
 */
import { createLogger } from './logger'
import {
  dayStartMs,
  monthStartMs,
  type SpendEvidenceGap,
  type SpendEvidenceWindow,
  type BudgetScope,
  type BudgetUnit,
  type LaneSums,
  type UnattributedSums,
  type ScopeSpend,
  type WindowSpend,
  type WorkClassSums,
  type BudgetSpendFacets,
} from './budget'

const log = createLogger('budget-spend')

export type {
  SpendEvidenceGap,
  SpendEvidenceWindow,
  LaneSums,
  UnattributedSums,
  ScopeSpend,
  WindowSpend,
  WorkClassSums,
  BudgetSpendFacets,
} from './budget'

function emptyLanes(): LaneSums {
  return { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 0, unpricedMeteredTokens: 0 }
}
function emptyUnattributed(): UnattributedSums {
  return { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 0 }
}
function emptyScope(): ScopeSpend {
  return { ...emptyLanes(), unattributed: emptyUnattributed() }
}
function emptyWindow(startMs: number): WindowSpend {
  return { startMs, global: emptyScope(), byAgent: {}, byProvider: {}, byModel: {}, byWorkClass: {} }
}

type Lane = 'metered' | 'subscription'

function safeSum(current: number, increment: number): number | null {
  if (!Number.isSafeInteger(current) || current < 0) return null
  if (!Number.isSafeInteger(increment) || increment < 0) return null
  if (current > Number.MAX_SAFE_INTEGER - increment) return null
  return current + increment
}

function addAttributed(
  target: LaneSums,
  lane: Lane,
  tokens: number | null,
  usdMicros: number | null,
): BudgetUnit[] {
  const incomplete = new Set<BudgetUnit>()
  if (lane === 'subscription') {
    if (tokens !== null) {
      const next = safeSum(target.subscriptionTokens, tokens)
      if (next === null) incomplete.add('tokens')
      else target.subscriptionTokens = next
    }
    return [...incomplete]
  }
  if (tokens !== null) {
    const meteredTokens = safeSum(target.meteredTokens, tokens)
    if (meteredTokens === null) incomplete.add('tokens')
    else target.meteredTokens = meteredTokens
    if (usdMicros === null) {
      const unpricedTokens = safeSum(target.unpricedMeteredTokens, tokens)
      if (unpricedTokens === null) incomplete.add('tokens')
      else target.unpricedMeteredTokens = unpricedTokens
    }
  }
  if (usdMicros !== null) {
    const cost = safeSum(target.meteredUsdMicros, usdMicros)
    if (cost === null) incomplete.add('usd_micros')
    else target.meteredUsdMicros = cost
  }
  return [...incomplete]
}

function emptySpendEvidence(): SpendEvidenceWindow {
  return { status: 'complete', gaps: [] }
}

function recordEvidenceGap(
  evidence: SpendEvidenceWindow,
  gap: Omit<SpendEvidenceGap, 'unknownCount'>,
  unknownCount: number,
): void {
  const normalizedCount = !Number.isFinite(unknownCount)
    ? Number.MAX_SAFE_INTEGER
    : Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(unknownCount)))
  if (normalizedCount <= 0 || gap.reasons.length === 0) return
  evidence.status = 'incomplete'
  const reasons = [...gap.reasons].sort() as SpendEvidenceGap['reasons']
  const existing = evidence.gaps.find((candidate) =>
    candidate.unit === gap.unit
    && candidate.source === gap.source
    && candidate.lane === gap.lane
    && candidate.agent === gap.agent
    && candidate.provider === gap.provider
    && candidate.model === gap.model
    && candidate.affectedScope === gap.affectedScope
    && candidate.reasons.join('\0') === reasons.join('\0'))
  if (existing) {
    existing.unknownCount = safeSum(existing.unknownCount, normalizedCount) ?? Number.MAX_SAFE_INTEGER
    return
  }
  evidence.gaps.push({ ...gap, reasons, unknownCount: normalizedCount })
}

function sortEvidenceGaps(evidence: SpendEvidenceWindow): void {
  evidence.gaps.sort((a, b) =>
    a.unit.localeCompare(b.unit)
    || a.source.localeCompare(b.source)
    || (a.lane ?? '').localeCompare(b.lane ?? '')
    || a.agent.localeCompare(b.agent)
    || (a.provider ?? '').localeCompare(b.provider ?? '')
    || (a.model ?? '').localeCompare(b.model ?? '')
    || (a.affectedScope ?? '').localeCompare(b.affectedScope ?? '')
    || a.reasons.join('\0').localeCompare(b.reasons.join('\0')))
}

function attributedEvidenceReasons(input: {
  valueMissing: boolean
  lane: Lane | null
  provider: string | null
  model: string | null
}): SpendEvidenceGap['reasons'] {
  const reasons: SpendEvidenceGap['reasons'] = []
  if (input.valueMissing) reasons.push('value_missing')
  if (input.lane === null) reasons.push('lane_unknown')
  if (input.provider === null) reasons.push('provider_unknown')
  if (input.model === null) reasons.push('model_unknown')
  return reasons
}

function recordAggregateGap(
  evidence: SpendEvidenceWindow,
  input: {
    unit: BudgetUnit
    source: SpendEvidenceGap['source']
    lane: Lane
    agent: string
    provider: string | null
    model: string | null
    affectedScope: BudgetScope
    unknownCount?: number
  },
): void {
  recordEvidenceGap(evidence, {
    ...input,
    reasons: ['value_missing'],
  }, input.unknownCount ?? 1)
}

function addAttributedToScope(input: {
  target: LaneSums
  evidence: SpendEvidenceWindow
  affectedScope: BudgetScope
  lane: Lane
  tokens: number | null
  usdMicros: number | null
  agent: string
  provider: string | null
  model: string | null
}): void {
  const incompleteUnits = addAttributed(input.target, input.lane, input.tokens, input.usdMicros)
  for (const unit of incompleteUnits) {
    recordAggregateGap(input.evidence, {
      unit,
      source: 'attributed_run',
      lane: input.lane,
      agent: input.agent,
      provider: input.provider,
      model: input.model,
      affectedScope: input.affectedScope,
    })
  }
}

function missingObservedCostCount(cell: {
  costUsdMicros: number | null
  costedMessages: number
  messageCount: number
}): number {
  const messageCount = Math.max(0, Math.floor(cell.messageCount))
  const costedMessages = Math.max(0, Math.floor(cell.costedMessages))
  if (messageCount === 0) return 0
  if (costedMessages < messageCount) return messageCount - costedMessages
  // A complete coverage count without a subtotal, or a count that exceeds
  // the number of messages, is internally inconsistent and cannot prove $0.
  if (cell.costUsdMicros === null || costedMessages > messageCount) return messageCount
  return 0
}

/** Per-(agent, day, lane) sums used to compute the observed−attributed delta. */
interface DayLaneSums {
  tokens: number
  /** Dollars from rows that actually carried a cost (NULL-honest). */
  usdMicros: number
  /** False once an input could not be represented in the exact subtotal. */
  tokensComplete: boolean
  usdComplete: boolean
}

function emptyDayLaneSums(): DayLaneSums {
  return { tokens: 0, usdMicros: 0, tokensComplete: true, usdComplete: true }
}

function addDayLaneValue(sums: DayLaneSums, key: 'tokens' | 'usdMicros', value: number): boolean {
  const next = safeSum(sums[key], value)
  if (next === null) {
    if (key === 'tokens') sums.tokensComplete = false
    else sums.usdComplete = false
    return false
  }
  sums[key] = next
  return true
}

function safeCombinedIncrement(base: number, current: number, increment: number): number | null {
  const subtotal = safeSum(base, current)
  if (subtotal === null || safeSum(subtotal, increment) === null) return null
  return safeSum(current, increment)
}

function addUnattributed(
  scope: ScopeSpend,
  lane: Lane,
  deltaTokens: number,
  deltaUsdMicros: number,
): BudgetUnit[] {
  const incomplete = new Set<BudgetUnit>()
  if (lane === 'subscription') {
    const next = safeCombinedIncrement(
      scope.subscriptionTokens,
      scope.unattributed.subscriptionTokens,
      deltaTokens,
    )
    if (next === null) incomplete.add('tokens')
    else scope.unattributed.subscriptionTokens = next
    return [...incomplete]
  }

  const tokens = safeCombinedIncrement(
    scope.meteredTokens,
    scope.unattributed.meteredTokens,
    deltaTokens,
  )
  if (tokens === null) incomplete.add('tokens')
  else scope.unattributed.meteredTokens = tokens

  const cost = safeCombinedIncrement(
    scope.meteredUsdMicros,
    scope.unattributed.meteredUsdMicros,
    deltaUsdMicros,
  )
  if (cost === null) incomplete.add('usd_micros')
  else scope.unattributed.meteredUsdMicros = cost
  return [...incomplete]
}

function laneKey(agent: string, day: string, lane: Lane): string {
  return `${agent}\0${day}\0${lane}`
}

async function resolveObservedLane(
  invoke: ((name: string, data: Record<string, unknown>) => Promise<unknown>) | null,
  cache: Map<string, Lane | null>,
  agent: string,
  model: string,
): Promise<Lane | null> {
  const key = `${agent}\0${model}`
  if (cache.has(key)) return cache.get(key) ?? null
  let lane: Lane | null = null
  if (invoke) {
    try {
      // prospective:false = this is HISTORY: the hook must not substitute
      // the agent's current effective model, so provider-scoped overrides
      // can never match a guessed provider and no runtime round-trip runs
      // on the budget hot path.
      const billing = (await invoke('models.resolveBilling', {
        agentId: agent,
        model: model || undefined,
        prospective: false,
      })) as
        | { lane?: string; provider?: string; laneSource?: string }
        | undefined
      // A lane is trustworthy when the hook resolved a REAL provider from a
      // REAL model — 'other' is the could-not-resolve bucket whose
      // default-metered lane would book theoretical dollars as real spend
      // (#689). An operator lane override is trusted too (with
      // prospective:false an override match is exact, never via a guessed
      // provider): operator truth, not a guess.
      const providerResolved = model !== ''
        && typeof billing?.provider === 'string'
        && billing.provider !== '' && billing.provider !== 'other'
      const operatorOverride = billing?.laneSource === 'override'
      if ((providerResolved || operatorOverride)
        && (billing?.lane === 'subscription' || billing?.lane === 'metered')) {
        lane = billing.lane
      }
    } catch (err) {
      log.warn('resolveBilling failed for observed usage; leaving its lane unresolved', {
        agent, model, err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  cache.set(key, lane)
  return lane
}

/**
 * Assemble the full spend facets for the daily + monthly windows containing
 * `now`. Pure over its inputs (stores + clock injected by module boundary);
 * throws only if the LEDGER read throws (fail-closed callers rely on that).
 * A usage.db failure preserves attributed facts but is explicit in
 * `observedUsageEvidence`; callers must not treat that as a complete zero.
 */
export async function assembleBudgetSpend(now: number): Promise<BudgetSpendFacets> {
  const [{ listRunCostsSince }, usageStore, hooksModule] = await Promise.all([
    import('./execution-ledger'),
    import('../../packages/core/src/usage-history/store'),
    import('@bakin/core/hooks/hook-registry-singleton').catch(() => null),
  ])
  const dayStart = dayStartMs(now)
  const monthStart = monthStartMs(now)
  const daily = emptyWindow(dayStart)
  const monthly = emptyWindow(monthStart)
  const dailySpendEvidence = emptySpendEvidence()
  const monthlySpendEvidence = emptySpendEvidence()
  const todayKey = usageStore.toLocalDayKey(dayStart)
  let observedUsageEvidence: BudgetSpendFacets['observedUsageEvidence'] = { status: 'available' }

  // ---- attributed (run_costs) --------------------------------------------
  // Keyed sums retained for the delta computation below.
  const attributedByLane = new Map<string, DayLaneSums>()
  for (const row of listRunCostsSince(monthStart)) {
    const lane: Lane | null = row.lane === 'subscription' || row.lane === 'metered' ? row.lane : null
    // Null means either token evidence is missing or tokens do not apply.
    // `usageKind` distinguishes those states; only the former creates a gap.
    const tokens = row.usageKind === 'tokens' ? row.totalTokens : null
    const usd = lane === 'metered' ? row.costUsdMicros : null
    const windowPairs: Array<{ window: WindowSpend; evidence: SpendEvidenceWindow }> = row.occurredAt >= dayStart
      ? [
          { window: monthly, evidence: monthlySpendEvidence },
          { window: daily, evidence: dailySpendEvidence },
        ]
      : [{ window: monthly, evidence: monthlySpendEvidence }]
    const evidenceWindows = windowPairs.map((pair) => pair.evidence)

    if (row.usageKind === 'tokens' && (lane === 'subscription' || lane === null)) {
      const reasons = attributedEvidenceReasons({
        valueMissing: row.totalTokens === null,
        lane,
        provider: row.provider,
        model: row.model,
      })
      for (const evidence of evidenceWindows) {
        recordEvidenceGap(evidence, {
          unit: 'tokens',
          source: 'attributed_run',
          lane,
          agent: row.agent,
          provider: row.provider,
          model: row.model,
          reasons,
        }, 1)
      }
    }
    if (lane === 'metered' || lane === null) {
      const reasons = attributedEvidenceReasons({
        valueMissing: row.costUsdMicros === null,
        lane,
        provider: row.provider,
        model: row.model,
      })
      for (const evidence of evidenceWindows) {
        recordEvidenceGap(evidence, {
          unit: 'usd_micros',
          source: 'attributed_run',
          lane,
          agent: row.agent,
          provider: row.provider,
          model: row.model,
          reasons,
        }, 1)
      }
    }
    if (lane !== null) {
      for (const { window, evidence } of windowPairs) {
        addAttributedToScope({
          target: window.global,
          evidence,
          affectedScope: 'global',
          lane,
          tokens,
          usdMicros: usd,
          agent: row.agent,
          provider: row.provider,
          model: row.model,
        })
        addAttributedToScope({
          target: (window.byAgent[row.agent] ??= emptyScope()),
          evidence,
          affectedScope: 'agent',
          lane,
          tokens,
          usdMicros: usd,
          agent: row.agent,
          provider: row.provider,
          model: row.model,
        })
        const provider = row.provider ?? 'other'
        addAttributedToScope({
          target: (window.byProvider[provider] ??= emptyLanes()),
          evidence,
          affectedScope: 'provider',
          lane,
          tokens,
          usdMicros: usd,
          agent: row.agent,
          provider: row.provider,
          model: row.model,
        })
        const model = row.model ?? ''
        addAttributedToScope({
          target: (window.byModel[model] ??= emptyLanes()),
          evidence,
          affectedScope: 'model',
          lane,
          tokens,
          usdMicros: usd,
          agent: row.agent,
          provider: row.provider,
          model: row.model,
        })
        // Work-class slice (unit economics): the dimension that routes IS the
        // dimension spend reports on. 'media' = classless-by-design image
        // rows; 'unclassified' = pre-migration token rows. Reporting-only —
        // no cap rules bind here, so no evidence-gap plumbing.
        const workClass = row.usageKind === 'media' ? 'media' : (row.workClass ?? 'unclassified')
        const wc: WorkClassSums = (window.byWorkClass[workClass] ??= { ...emptyLanes(), runs: 0 })
        addAttributed(wc, lane, tokens, usd)
        wc.runs += 1
      }
      const day = usageStore.toLocalDayKey(row.occurredAt)
      const key = laneKey(row.agent, day, lane)
      const sums = attributedByLane.get(key) ?? emptyDayLaneSums()
      if (tokens !== null) addDayLaneValue(sums, 'tokens', tokens)
      if (usd !== null) addDayLaneValue(sums, 'usdMicros', usd)
      attributedByLane.set(key, sums)
    }
  }

  // ---- observed (usage.db) → unattributed delta --------------------------
  try {
    const invoke = hooksModule ? (n: string, d: Record<string, unknown>) => hooksModule.getHookRegistry().invoke(n, d) : null
    const laneCache = new Map<string, Lane | null>()
    const observedByLane = new Map<string, DayLaneSums>()
    for (const cell of usageStore.readUsageByAgentModelDaySince(usageStore.toLocalDayKey(monthStart))) {
      const lane = await resolveObservedLane(invoke, laneCache, cell.agent, cell.model)
      const evidenceWindows = cell.day === todayKey
        ? [monthlySpendEvidence, dailySpendEvidence]
        : [monthlySpendEvidence]
      if (lane === null) {
        const observedCount = Math.max(1, Math.floor(cell.messageCount))
        const missingCostCount = missingObservedCostCount(cell)
        for (const evidence of evidenceWindows) {
          recordEvidenceGap(evidence, {
            unit: 'tokens',
            source: 'observed_message',
            lane: null,
            agent: cell.agent,
            provider: null,
            model: cell.model || null,
            reasons: ['lane_unknown'],
          }, observedCount)
          recordEvidenceGap(evidence, {
            unit: 'usd_micros',
            source: 'observed_message',
            lane: null,
            agent: cell.agent,
            provider: null,
            model: cell.model || null,
            reasons: missingCostCount > 0 ? ['lane_unknown', 'value_missing'] : ['lane_unknown'],
          }, observedCount)
        }
        continue
      }
      if (lane === 'metered') {
        const missingCostCount = missingObservedCostCount(cell)
        for (const evidence of evidenceWindows) {
          recordEvidenceGap(evidence, {
            unit: 'usd_micros',
            source: 'observed_message',
            lane,
            agent: cell.agent,
            provider: null,
            model: cell.model || null,
            reasons: ['value_missing'],
          }, missingCostCount)
        }
      }
      const key = laneKey(cell.agent, cell.day, lane)
      const sums = observedByLane.get(key) ?? emptyDayLaneSums()
      const observedCount = Math.max(1, Math.floor(cell.messageCount))
      if (!addDayLaneValue(sums, 'tokens', cell.tokens.total)) {
        for (const evidence of evidenceWindows) {
          for (const affectedScope of ['global', 'agent'] as const) {
            recordAggregateGap(evidence, {
              unit: 'tokens',
              source: 'observed_message',
              lane,
              agent: cell.agent,
              provider: null,
              model: cell.model || null,
              affectedScope,
              unknownCount: observedCount,
            })
          }
        }
      }
      if (lane === 'metered' && cell.costUsdMicros !== null
        && !addDayLaneValue(sums, 'usdMicros', cell.costUsdMicros)) {
        for (const evidence of evidenceWindows) {
          for (const affectedScope of ['global', 'agent'] as const) {
            recordAggregateGap(evidence, {
              unit: 'usd_micros',
              source: 'observed_message',
              lane,
              agent: cell.agent,
              provider: null,
              model: cell.model || null,
              affectedScope,
              unknownCount: observedCount,
            })
          }
        }
      }
      observedByLane.set(key, sums)
    }
    for (const [key, observed] of observedByLane) {
      const [agent, day, lane] = key.split('\0') as [string, string, Lane]
      const attributed = attributedByLane.get(key) ?? emptyDayLaneSums()
      // An observed partial subtotal is still a safe lower bound. An
      // attributed partial subtotal is not safe to subtract: doing so could
      // fabricate an unattributed delta and a false cap incident.
      const deltaTokens = attributed.tokensComplete ? Math.max(0, observed.tokens - attributed.tokens) : 0
      const deltaUsd = lane === 'metered' && attributed.usdComplete
        ? Math.max(0, observed.usdMicros - attributed.usdMicros)
        : 0
      if (deltaTokens === 0 && deltaUsd === 0) continue
      const windowPairs: Array<{ window: WindowSpend; evidence: SpendEvidenceWindow }> = day === todayKey
        ? [
            { window: monthly, evidence: monthlySpendEvidence },
            { window: daily, evidence: dailySpendEvidence },
          ]
        : [{ window: monthly, evidence: monthlySpendEvidence }]
      for (const { window, evidence } of windowPairs) {
        const scopes: Array<{ scope: ScopeSpend; affectedScope: 'global' | 'agent' }> = [
          { scope: window.global, affectedScope: 'global' },
          { scope: (window.byAgent[agent] ??= emptyScope()), affectedScope: 'agent' },
        ]
        for (const { scope, affectedScope } of scopes) {
          for (const unit of addUnattributed(scope, lane, deltaTokens, deltaUsd)) {
            recordAggregateGap(evidence, {
              unit,
              source: 'observed_message',
              lane,
              agent,
              provider: null,
              model: null,
              affectedScope,
            })
          }
        }
      }
    }
  } catch (err) {
    // Observed-side failure degrades to attributed-only — the gate still
    // works, just without the outside-spend delta. Logged, never thrown.
    observedUsageEvidence = { status: 'unavailable', reason: 'usage_store_unavailable' }
    log.error('Observed-usage delta failed; spend is attributed-only this pass', err)
  }

  sortEvidenceGaps(dailySpendEvidence)
  sortEvidenceGaps(monthlySpendEvidence)
  return {
    computedAt: now,
    observedUsageEvidence,
    spendEvidence: {
      daily: dailySpendEvidence,
      monthly: monthlySpendEvidence,
    },
    daily,
    monthly,
  }
}

/** Next local midnight after the window start. */
export function dayEndMs(now: number): number {
  const d = new Date(dayStartMs(now))
  d.setDate(d.getDate() + 1)
  return d.getTime()
}

/** First local midnight of the next month. */
export function monthEndMs(now: number): number {
  const d = new Date(monthStartMs(now))
  d.setMonth(d.getMonth() + 1)
  return d.getTime()
}

/**
 * Linear end-of-window projection ("on pace for ~X"). Null until 2% of the
 * window has elapsed — extrapolating from the first minutes of a day is
 * noise, not signal.
 */
export function paceProjection(spent: number, windowStartMs: number, windowEndMs: number, now: number): number | null {
  const total = windowEndMs - windowStartMs
  const elapsed = now - windowStartMs
  if (total <= 0 || elapsed <= 0 || elapsed < total * 0.02) return null
  return Math.round(spent * (total / elapsed))
}
