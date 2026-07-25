/**
 * System check — spend vs budget cap rules (rule-aware, cost-control v2).
 *
 * Evaluates EVERY cap rule against the shared spend engine (the same
 * arithmetic the dispatch gate enforces — evaluateBudget over
 * assembleBudgetSpend facets, so the doctor can't drift from dispatch).
 * Structured findings ride `data` (rules + per-agent attribution for the
 * Attention chips) — UIs never parse message text. A missing policy is a
 * standing warn (spend is uncapped — spec V2); an unreachable ledger is an
 * error (gating fails closed without it); the kill switch surfaces as its
 * own warn row.
 */
import { queryAuditEvents } from '../../../../src/core/audit'
import { getContentDir } from '../../../../src/core/content-dir'
import { LedgerUnavailableError, listBudgetIncidents } from '../../../../src/core/execution-ledger'
import { assembleBudgetSpend } from '../../../../src/core/budget-spend'
import { evaluateBudget, type BudgetPolicy, type BudgetRule, type SpendEvidenceGap, type TurnBillingContext } from '../../../../src/core/budget'
import { getSettings } from '../../../../src/core/settings'
import { getHookRegistry } from '../../../../packages/core/src/hooks/hook-registry-singleton'
import { healthError, healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type {
  HealthCheckRunInput,
  HealthObservationInput,
  HealthRepairActionDefinition,
  HealthRepairPlanItem,
  JsonObject,
} from '@makinbakin/sdk'
import { repairTargetSelection } from './repair-support'
import {
  getUsageHistoryScanState,
  getUsageHistoryScanStaleAfterMs,
  type UsageHistoryScanStateSnapshot,
} from '../usage-history-timer'

const WINDOW_MS = 24 * 60 * 60 * 1000

/** Bounded human summary of evidence gaps — the card must NAME what is
 *  unverifiable ("openai/gpt-5.5: unpriced — 3 runs"), never gesture at it.
 *  Daily+monthly windows overlap, so gaps dedupe by target+reasons (max
 *  count wins — monthly subsumes daily for the same records). Model ids
 *  are runtime-controlled and unbounded: per-target text is truncated and
 *  the FULL enumeration belongs in detail (4000) — `impact` (500) gets
 *  only the top few + a count (review finding: five bedrock-style ids
 *  blew the impact bound and invalidated the whole run). */
function summarizeEvidenceGaps(gaps: SpendEvidenceGap[]): { lines: string[]; impactSummary: string } {
  const reasonText = (reason: SpendEvidenceGap['reasons'][number]): string => ({
    value_missing: 'unpriced',
    lane_unknown: 'billing lane unknown',
    provider_unknown: 'provider unknown',
    model_unknown: 'model unknown',
  })[reason]
  const merged = new Map<string, { target: string; reasons: string; count: number; unit: string }>()
  for (const gap of gaps) {
    const target = (gap.model ?? gap.provider ?? (gap.agent ? `agent ${gap.agent}` : 'unknown source')).slice(0, 80)
    const reasons = gap.reasons.map(reasonText).join(' + ')
    const unit = gap.source === 'attributed_run' ? 'run' : 'message'
    const dedupeKey = `${target}\0${reasons}\0${unit}`
    const existing = merged.get(dedupeKey)
    if (existing) {
      existing.count = Math.max(existing.count, gap.unknownCount)
    } else {
      merged.set(dedupeKey, { target, reasons, count: gap.unknownCount, unit })
    }
  }
  const entries = [...merged.values()]
  const lines = entries.slice(0, 8).map((entry) =>
    `${entry.target}: ${entry.reasons} — ${entry.count} ${entry.unit}${entry.count === 1 ? '' : 's'}`)
  const top = entries.slice(0, 2).map((entry) => `${entry.target} (${entry.reasons})`)
  const more = entries.length - top.length
  const impactSummary = top.length > 0
    ? ` Gaps: ${top.join(', ')}${more > 0 ? ` +${more} more` : ''}.`
    : ''
  return { lines, impactSummary }
}

function fmtValue(unit: 'usd_micros' | 'tokens', v: number): string {
  return unit === 'usd_micros' ? `$${(v / 1_000_000).toFixed(2)}` : `${v.toLocaleString()} tokens`
}

/** A synthetic turn that matches the rule — how the check probes one rule. */
function matchingTurn(rule: BudgetRule): TurnBillingContext {
  return {
    agent: rule.scope === 'agent' ? rule.scopeId ?? '' : '',
    provider: rule.scope === 'provider' ? rule.scopeId : undefined,
    model: rule.scope === 'model' ? rule.scopeId : undefined,
    lane: rule.lane,
  }
}

function ruleLabel(rule: BudgetRule): string {
  return rule.scopeId ? `${rule.scope} '${rule.scopeId}'` : 'global'
}

type ObservedSpendEvidence =
  | { status: 'complete'; reason: 'complete'; scanAgeMs: number; staleAfterMs: number }
  | { status: 'partial'; reason: string; scanAgeMs: number; staleAfterMs: number }
  | { status: 'unavailable'; reason: string; scanAgeMs: number | null; staleAfterMs: number }

function observedSpendEvidence(
  facets: Awaited<ReturnType<typeof assembleBudgetSpend>>,
  now: number,
  before: UsageHistoryScanStateSnapshot,
  after: UsageHistoryScanStateSnapshot,
): ObservedSpendEvidence {
  const staleAfterMs = getUsageHistoryScanStaleAfterMs()
  if (facets.observedUsageEvidence.status === 'unavailable') {
    return { status: 'unavailable', reason: facets.observedUsageEvidence.reason, scanAgeMs: null, staleAfterMs }
  }
  const scan = after.lastScan
  if (before.inFlight || after.inFlight) {
    return {
      status: 'unavailable',
      reason: 'scan_in_progress',
      scanAgeMs: scan ? Math.max(0, now - scan.at) : null,
      staleAfterMs,
    }
  }
  if (before.generation !== after.generation || before.lastScan !== after.lastScan) {
    return {
      status: 'unavailable',
      reason: 'scan_generation_changed',
      scanAgeMs: scan ? Math.max(0, now - scan.at) : null,
      staleAfterMs,
    }
  }
  if (!scan) return { status: 'unavailable', reason: 'scan_not_run', scanAgeMs: null, staleAfterMs }
  const scanAgeMs = Math.max(0, now - scan.at)
  if (scanAgeMs > staleAfterMs) {
    return { status: 'unavailable', reason: 'scan_stale', scanAgeMs, staleAfterMs }
  }
  if (scan.report.coverage.status !== 'complete') {
    return {
      status: scan.report.coverage.status,
      reason: scan.report.coverage.reason,
      scanAgeMs,
      staleAfterMs,
    }
  }
  return { status: 'complete', reason: 'complete', scanAgeMs, staleAfterMs }
}

export async function checkBudget(): Promise<HealthCheckRunInput> {
  const observations: HealthObservationInput[] = []

  if (getSettings().dispatch?.paused) {
    observations.push(healthWarning({
      key: 'dispatch-paused',
      summary: 'Dispatch is paused.',
      detail: 'The global kill switch is blocking task dispatch and billed media.',
      evidence: { paused: true },
      incident: {
        key: 'dispatch-paused',
        title: 'Global dispatch is paused',
        class: 'budget_block',
        impact: 'No tasks dispatch and no billed media runs until an operator resumes dispatch.',
        disposition: 'action_required',
        resources: [{ kind: 'setting', id: 'dispatch.paused', label: 'Dispatch kill switch' }],
        resolution: {
          key: 'resume-dispatch',
          type: 'instructions',
          label: 'Resume dispatch',
          steps: ['Confirm it is safe to resume dispatch, then use Settings or the budget command.'],
          command: 'bakin budget resume',
        },
      },
    }))
  }

  let policy: BudgetPolicy | undefined
  try {
    policy = (await getHookRegistry().invoke<BudgetPolicy>('models.getBudgetPolicy', {})) ?? undefined
  } catch (err) {
    observations.push(healthUnknown({
      key: 'policy',
      summary: 'Spending policy could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'policy-unavailable',
        title: 'Spending policy is unavailable',
        class: 'service_failure',
        impact: 'Health cannot confirm whether agent spend is capped.',
        disposition: 'watch',
        resources: [{ kind: 'system', id: 'budget-policy', label: 'Spending policy' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    }))
    return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
  }
  if (!policy?.rules?.length) {
    // Standing nag (spec V2): a fresh install must not run uncapped
    // UNKNOWINGLY. Warn is the visible tier (no notice level exists);
    // setting any cap rule clears it.
    observations.push(healthWarning({
      key: 'policy',
      summary: 'Agent spend is uncapped.',
      detail: 'No spending budget is configured.',
      evidence: { ruleCount: 0 },
      incident: {
        key: 'policy-missing',
        title: 'No spending budget is set',
        impact: 'Agents can accumulate unbounded metered spend without an operator knowingly accepting that risk.',
        disposition: 'action_required',
        resources: [{ kind: 'budget_rule', id: 'global', label: 'Global spending budget' }],
        resolution: {
          key: 'open-spend-settings',
          type: 'navigate',
          label: 'Set a spending budget',
          href: '/models?tab=spend',
        },
      },
    }))
    return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
  }

  // Open incidents block/alert independently of CURRENT spend — a pause-mode
  // hold survives window rollover, so "spend is under cap" must never read
  // as "healthy" while dispatch is frozen (the frozen-but-green trap).
  try {
    const open = listBudgetIncidents({ openOnly: true })
    if (open.length > 0) {
      const pausing = open.filter((i) => i.kind === 'cap' && i.atCap === 'pause')
      const evidence: JsonObject = {
        incidents: open.map((incident) => ({
          id: incident.id,
          scope: incident.scope,
          ...(incident.scopeId ? { scopeId: incident.scopeId } : {}),
          lane: incident.lane,
          window: incident.window,
          kind: incident.kind,
          atCap: incident.atCap,
          status: incident.status,
        })),
        pausing: pausing.length,
      }
      const incident = {
        key: 'open-incidents',
        title: 'Budget incidents need resolution',
        class: 'budget_block' as const,
        impact: pausing.length > 0
          ? 'Pause-mode holds are blocking task dispatch until an operator resolves them.'
          : 'Unresolved budget alerts can hide continued spend pressure.',
        disposition: 'action_required' as const,
        resources: open.slice(0, 50).map((entry) => ({
          kind: 'budget_rule' as const,
          id: String(entry.id),
          label: (entry.scopeId ? `${entry.scope} ${entry.scopeId}` : entry.scope).slice(0, 120),
        })),
        resolution: {
          key: 'open-spend-settings',
          type: 'navigate' as const,
          label: 'Resolve budget incidents',
          href: '/models?tab=spend',
        },
      }
      observations.push(pausing.length > 0
        ? healthError({
          key: 'incidents',
          summary: `${open.length} budget incident${open.length === 1 ? '' : 's'} remain open; ${pausing.length} ${pausing.length === 1 ? 'is' : 'are'} blocking dispatch.`,
          evidence,
          incident,
        })
        : healthWarning({
          key: 'incidents',
          summary: `${open.length} budget incident${open.length === 1 ? ' remains' : 's remain'} open.`,
          evidence,
          incident,
        }))
    }
  } catch (err) {
    observations.push(healthUnknown({
      key: 'incidents',
      summary: 'Open budget incidents could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'incidents-unavailable',
        title: 'Budget incident status is unknown',
        class: 'evidence_gap',
        impact: 'Health cannot confirm whether an unresolved budget hold is blocking dispatch.',
        disposition: 'watch',
        resources: [{ kind: 'system', id: 'budget-incidents', label: 'Budget incidents' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    }))
  }

  const now = Date.now()
  const usageScanBefore = getUsageHistoryScanState()
  let facets: Awaited<ReturnType<typeof assembleBudgetSpend>>
  try {
    facets = await assembleBudgetSpend(now)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const kind = err instanceof LedgerUnavailableError ? 'unreachable' : 'failing'
    observations.push(healthError({
      key: 'spend-ledger',
      summary: `Spend ledger is ${kind}.`,
      detail,
      incident: {
        key: 'spend-ledger-unavailable',
        title: 'Spend ledger is unavailable',
        class: 'service_failure',
        impact: 'Budget gating fails closed, so task dispatch defers until spend can be evaluated.',
        disposition: 'action_required',
        resources: [{ kind: 'system', id: 'spend-ledger', label: 'Spend ledger' }],
        resolution: {
          key: 'restore-ledger',
          type: 'instructions',
          label: 'Restore the spend ledger',
          steps: ['Check the execution-ledger storage path and permissions, then rerun Health.'],
        },
      },
    }))
    return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
  }
  const usageScanAfter = getUsageHistoryScanState()
  const observedEvidence = observedSpendEvidence(facets, now, usageScanBefore, usageScanAfter)

  let deferred = 0
  let evidenceDeferred = 0
  try {
    const recentDeferrals = queryAuditEvents(getContentDir(), { kinds: ['budget.deferred'], sinceMs: WINDOW_MS })
    for (const event of recentDeferrals) {
      const reason = event.data.reason
      if (reason === 'spend-evidence-incomplete'
        || reason === 'spend-evidence-unavailable'
        || reason === 'ledger-unavailable'
        || reason === 'token-evidence-incomplete') {
        evidenceDeferred++
      } else {
        deferred++
      }
    }
  } catch (err) {
    observations.push(healthUnknown({
      key: 'deferred-history',
      summary: 'Recent budget deferrals could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'audit-unavailable',
        title: 'Budget deferral history is unknown',
        class: 'evidence_gap',
        impact: 'Health cannot report how often budget gates deferred work in the last 24 hours.',
        disposition: 'watch',
        resources: [{ kind: 'file', id: 'audit-log', label: 'audit.jsonl' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    }))
  }
  const deferNote = deferred ? ` ${deferred} run(s) deferred in the last 24h.` : ''

  // Probe each rule with a synthetic matching turn — same evaluator, same
  // facets as the gate. Worst breach drives the row status.
  const breaches: Array<{ rule: BudgetRule; action: 'warn' | 'defer'; window: string; unit: 'usd_micros' | 'tokens'; spentValue: number; capValue: number }> = []
  const incompleteSpendRules: Array<{
    rule: BudgetRule
    window: string
    unit: 'usd_micros' | 'tokens'
    cause: 'spend_evidence_incomplete' | 'spend_evidence_unavailable'
    knownSpentValue: number
    capValue: number
    unknownEvidenceCount: number | null
  }> = []
  for (const rule of policy.rules) {
    const decision = evaluateBudget({ policy: { rules: [rule] }, turn: matchingTurn(rule), facets })
    if (decision.action === 'allow') continue
    if (decision.cause === 'spend_evidence_incomplete' || decision.cause === 'spend_evidence_unavailable') {
      incompleteSpendRules.push({
        rule,
        window: decision.window,
        unit: decision.unit,
        cause: decision.cause,
        knownSpentValue: decision.spentValue,
        capValue: decision.capValue,
        unknownEvidenceCount: decision.cause === 'spend_evidence_incomplete'
          ? decision.unknownEvidenceCount
          : null,
      })
      continue
    }
    breaches.push({ rule, action: decision.action, window: decision.window, unit: decision.unit, spentValue: decision.spentValue, capValue: decision.capValue })
  }

  // Agent-scoped breaches attribute directly; global/provider breaches get a
  // synthetic 'global' entry so the Attention section shows SOMETHING for the
  // most common breach (the onboarding-created global rule).
  const agents = [...new Set(breaches.filter((b) => b.rule.scope === 'agent' && b.rule.scopeId).map((b) => b.rule.scopeId as string))]
  if (breaches.some((b) => b.rule.scope !== 'agent')) agents.push('global')
  const spendEvidence: JsonObject = {
    daily: {
      status: facets.spendEvidence.daily.status,
      gaps: facets.spendEvidence.daily.gaps.map((gap) => ({
        unit: gap.unit,
        source: gap.source,
        lane: gap.lane,
        agent: gap.agent,
        provider: gap.provider,
        model: gap.model,
        ...(gap.affectedScope ? { affectedScope: gap.affectedScope } : {}),
        reasons: gap.reasons,
        unknownCount: gap.unknownCount,
      })),
    },
    monthly: {
      status: facets.spendEvidence.monthly.status,
      gaps: facets.spendEvidence.monthly.gaps.map((gap) => ({
        unit: gap.unit,
        source: gap.source,
        lane: gap.lane,
        agent: gap.agent,
        provider: gap.provider,
        model: gap.model,
        ...(gap.affectedScope ? { affectedScope: gap.affectedScope } : {}),
        reasons: gap.reasons,
        unknownCount: gap.unknownCount,
      })),
    },
  }
  const data: JsonObject = {
    rules: breaches.map((b) => ({
      scope: b.rule.scope,
      ...(b.rule.scopeId ? { scopeId: b.rule.scopeId } : {}),
      lane: b.rule.lane,
      action: b.action,
      window: b.window,
      unit: b.unit,
      spentValue: b.spentValue,
      capValue: b.capValue,
    })),
    ...(agents.length ? { agents } : {}),
    deferred,
    evidenceDeferred,
    observedUsageEvidence: observedEvidence,
    spendEvidence,
    ...(incompleteSpendRules.length ? {
      incompleteSpendRules: incompleteSpendRules.map((entry) => ({
        scope: entry.rule.scope,
        ...(entry.rule.scopeId ? { scopeId: entry.rule.scopeId } : {}),
        lane: entry.rule.lane,
        window: entry.window,
        unit: entry.unit,
        cause: entry.cause,
        knownSpentValue: entry.knownSpentValue,
        capValue: entry.capValue,
        unknownEvidenceCount: entry.unknownEvidenceCount,
      })),
    } : {}),
  }

  const worst = breaches.find((b) => b.action === 'defer') ?? breaches[0]
  if (worst?.action === 'defer') {
    const capped = breaches.filter((b) => b.action === 'defer')
    const detail = capped
      .map((b) => `${ruleLabel(b.rule)} ${b.window} ${b.rule.lane} ${fmtValue(b.unit, b.spentValue)}/${fmtValue(b.unit, b.capValue)}`)
      .join('; ')
    observations.push(healthError({
      key: 'spend',
      summary: `${capped.length} budget cap${capped.length === 1 ? ' is' : 's are'} at or over the limit.`,
      detail: `Dispatch is deferring: ${detail}.${deferNote}`,
      evidence: data,
      incident: {
        key: 'cap-reached',
        title: 'Spending cap reached',
        class: 'budget_block',
        impact: 'Task dispatch is deferring for work covered by the capped budget rules.',
        disposition: 'action_required',
        resources: capped.slice(0, 50).map((entry, index) => ({
          kind: 'budget_rule' as const,
          id: budgetRuleId(entry.rule, index),
          label: ruleLabel(entry.rule),
        })),
        resolution: {
          key: 'open-spend-settings',
          type: 'navigate',
          label: 'Review spending caps',
          href: '/models?tab=spend',
        },
      },
    }))
  } else if (incompleteSpendRules.length > 0
    || (policy.rules.some((rule) => rule.scope === 'global' || rule.scope === 'agent')
      && observedEvidence.status !== 'complete')) {
    // Concrete, resolvable, or it doesn't ship (field feedback, 2026-07-22:
    // "open a page and pray" is not a resolution). The card NAMES its gaps,
    // and a pricing gap gets a one-click repair that force-refreshes the
    // model catalog server-side — no page visit involved. Attribution gaps
    // (lane/provider/model unknown) genuinely self-resolve as transcripts
    // land, and the copy says exactly that instead of inventing busywork.
    const evidenceGaps = [...facets.spendEvidence.daily.gaps, ...facets.spendEvidence.monthly.gaps]
    const { lines: gapLines, impactSummary } = summarizeEvidenceGaps(evidenceGaps)
    // Resolution precedence: a PURE pricing gap (value_missing without
    // lane_unknown) is fixable by the catalog refresh. Any lane_unknown
    // present means attribution is the blocker — no refresh conjures a
    // billing lane, so the write-off repair is the honest offer.
    const hasPricingGap = evidenceGaps.some((gap) =>
      gap.reasons.includes('value_missing') && !gap.reasons.includes('lane_unknown'))
    const detailSuffix = gapLines.length > 0 ? ` Gaps: ${gapLines.join('; ')}.` : ''
    const detail = incompleteSpendRules.length > 0
      ? `${incompleteSpendRules.length} budget rule${incompleteSpendRules.length === 1 ? '' : 's'} cannot be evaluated because one or more matching spend records have incomplete value or attribution evidence.${detailSuffix}`
      : `Known Bakin-managed spend is below its configured limits, but recent transcript-observed usage is incomplete.${detailSuffix}`
    observations.push(healthUnknown({
      key: 'spend',
      summary: 'Spend could not be fully verified.',
      detail,
      evidence: data,
      incident: {
        key: 'spend-evidence-incomplete',
        title: 'Spend evidence is incomplete',
        class: 'evidence_gap',
        impact: `${incompleteSpendRules.length > 0
          ? 'Matching budget caps fail closed until spend values and billing attribution can be verified.'
          : 'Health cannot confirm that agent spend outside Bakin-managed runs remains within budget.'}${impactSummary}`,
        // Pricing gaps are ACTIONABLE (the one-click catalog refresh) —
        // watch. Attribution-only gaps and scan freshness self-resolve as
        // transcripts land, and caps fail closed meanwhile: advisory, so
        // a state that needs no human stops lighting the banner.
        disposition: hasPricingGap ? 'watch' : 'advisory',
        resources: incompleteSpendRules.length > 0
          ? [
              { kind: 'system' as const, id: 'spend-ledger', label: 'Spend ledger' },
              { kind: 'system' as const, id: 'usage-history', label: 'Usage history' },
            ]
          : [{ kind: 'system', id: 'usage-history', label: 'Usage history' }],
        resolution: hasPricingGap
          ? {
              key: 'refresh-model-pricing',
              type: 'repair',
              label: 'Refresh model pricing',
              actionId: 'spend-evidence-refresh-pricing',
            }
          : evidenceGaps.length > 0
            ? {
                // Attribution-only gaps: recent ones settle on their own,
                // but fossils (old sessions that will never attribute)
                // otherwise fail caps closed FOREVER. The write-off is a
                // confirmation-gated repair — accept only history you know
                // will never attribute.
                key: 'accept-unattributed-history',
                type: 'repair',
                label: 'Accept unattributed history',
                actionId: 'accept-unattributed-history',
              }
            : {
                key: 'attribution-settles',
                type: 'instructions',
                label: 'Attribution completes on its own',
                steps: [
                  'Recent usage lacks billing attribution, which completes as the runtime finishes writing its transcripts — no action needed.',
                  'Budget caps stay fail-closed (deferring, never overspending) until then — that is by design.',
                  'If the same gaps persist for hours across recheck, report it: attribution should converge without help.',
                ],
              },
      },
    }))
  } else if (worst) {
    const detail = ` ${ruleLabel(worst.rule)} ${worst.window} ${worst.rule.lane} at ${Math.round((worst.spentValue / worst.capValue) * 100)}% of ${fmtValue(worst.unit, worst.capValue)}.`
    observations.push(healthWarning({
      key: 'spend',
      summary: 'Spend is approaching a budget limit.',
      detail: `${detail}${deferNote}`.trim(),
      evidence: data,
      incident: {
        key: 'approaching-cap',
        title: 'Spend is approaching its cap',
        class: 'budget_block',
        impact: 'Covered work may begin deferring if spend continues at the current pace.',
        disposition: 'watch',
        resources: [{ kind: 'budget_rule', id: 'active', label: 'Active spending rules' }],
        resolution: {
          key: 'open-spend-settings',
          type: 'navigate',
          label: 'Review spending',
          href: '/models?tab=spend',
        },
      },
    }))
  } else if (deferred > 0) {
    observations.push(healthWarning({
      key: 'spend',
      summary: 'Spend is approaching a budget limit.',
      detail: deferNote.trim(),
      evidence: data,
      incident: {
        key: 'approaching-cap',
        title: 'Spend is approaching its cap',
        class: 'budget_block',
        impact: 'Covered work may begin deferring if spend continues at the current pace.',
        disposition: 'watch',
        resources: [{ kind: 'budget_rule', id: 'active', label: 'Active spending rules' }],
        resolution: {
          key: 'open-spend-settings',
          type: 'navigate',
          label: 'Review spending',
          href: '/models?tab=spend',
        },
      },
    }))
  } else {
    observations.push(healthHealthy({
      key: 'spend',
      summary: `Spend is within budget across ${policy.rules.length} rule${policy.rules.length === 1 ? '' : 's'}.`,
      evidence: data,
    }))
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

function budgetRuleId(rule: BudgetRule, index: number): string {
  const raw = [rule.scope, rule.scopeId, rule.lane, index].filter((value) => value !== undefined).join('-')
  return raw.toLowerCase().replace(/[^a-z0-9._:-]/g, '-').slice(0, 120) || `rule-${index}`
}

/**
 * One-click repair for the pricing leg of incomplete spend evidence: force-
 * refresh the model catalog (with pricing) through the models plugin's own
 * hook — the deterministic version of "open the Models page so pricing
 * caches", which asked a human to trigger a machine operation (field
 * feedback, 2026-07-22). Attribution gaps are NOT repairable here; they
 * complete as transcripts land, and the incident copy says so.
 */
export function spendEvidenceRepair(): HealthRepairActionDefinition {
  return {
    id: 'spend-evidence-refresh-pricing',
    name: 'Refresh model pricing',
    async plan(target) {
      return [{
        id: 'refresh-model-pricing',
        actionId: 'spend-evidence-refresh-pricing',
        title: 'Refresh model pricing',
        reason: 'Spend records reference models without cached pricing, so USD caps cannot be evaluated.',
        safety: 'safe',
        ...repairTargetSelection(target),
        changes: [{
          kind: 'other',
          target: 'model catalog cache',
          action: 'update',
          description: 'Re-fetch the model catalog (with pricing) live from the configured providers, bypassing caches. Read-only toward providers; overwrites only the local pricing cache.',
        }],
      }]
    },
    async apply(items) {
      const done = (status: 'applied' | 'failed', message: string) => items.map((item: HealthRepairPlanItem) => ({
        itemId: item.id,
        actionId: item.actionId,
        status,
        message,
        affectedCheckIds: ['budget'],
        changes: item.changes,
      }))
      if (items.length === 0) return []
      try {
        const registry = getHookRegistry()
        if (!registry.has('models.refreshAvailableModels')) {
          return done('failed', 'The models plugin is not active — the catalog cannot be refreshed from here.')
        }
        const result = await registry.invoke<{ count: number; live: boolean; error: string | null }>(
          'models.refreshAvailableModels',
          {},
        )
        if (result?.error) {
          return done('failed', `Catalog refresh failed: ${result.error}. Pricing stays as-is; spend evidence remains incomplete.`)
        }
        if (!result || result.count === 0) {
          return done('failed', 'The provider returned no models — pricing cannot be cached. Check runtime credentials (`bakin check llm`), then run this repair again.')
        }
        // Honest scope: the refresh landed, but a gapped model may still
        // have no known pricing in the refreshed catalog — never claim the
        // gap is resolved before the next check run verifies it.
        return done('applied', `Model catalog refreshed live (${result.count} models). Health re-verifies spend on the next check run — if the same gap persists, that model has no known pricing and its usage can only be capped by tokens.`)
      } catch (err) {
        return done('failed', `Catalog refresh failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }
}

/**
 * The spend-fossil write-off: record a durable cutoff (today's local day
 * key) so observed usage BEFORE it that can never attribute stops failing
 * caps and lighting the card. Destructive-tier — money policy changes
 * only through an explicit, confirmed click; there is NO auto-aging.
 */
export function acceptUnattributedHistoryRepair(): HealthRepairActionDefinition {
  return {
    id: 'accept-unattributed-history',
    name: 'Accept unattributed history',
    async plan(target) {
      const cutoff = toLocalDayKeyForCutoff(Date.now())
      return [{
        id: 'accept-unattributed-history',
        actionId: 'accept-unattributed-history',
        title: `Accept unattributed usage before ${cutoff}`,
        reason: 'Old sessions with no billing-lane evidence will never attribute; they keep budget caps fail-closed and the spend card lit until explicitly written off.',
        safety: 'destructive',
        ...repairTargetSelection(target),
        changes: [{
          kind: 'other',
          target: 'budget policy',
          action: 'update',
          description: `Record acceptUnattributedBefore=${cutoff} on the budget policy. Caps compute from the cutoff forward; usage AFTER it still fails closed on missing evidence.`,
        }],
      }]
    },
    async apply(items) {
      const done = (status: 'applied' | 'failed', message: string) => items.map((item: HealthRepairPlanItem) => ({
        itemId: item.id,
        actionId: item.actionId,
        status,
        message,
        affectedCheckIds: ['budget'],
        changes: item.changes,
      }))
      if (items.length === 0) return []
      try {
        const cutoff = toLocalDayKeyForCutoff(Date.now())
        const result = await getHookRegistry().invoke<{ ok: boolean; error?: string }>(
          'models.updateBudgetPolicy',
          { acceptUnattributedBefore: cutoff },
        )
        if (!result?.ok) {
          return done('failed', `Budget policy write failed: ${result?.error ?? 'models plugin unavailable'}`)
        }
        return done('applied', `Unattributed usage before ${cutoff} is written off. Caps compute from today forward; new evidence gaps still fail closed.`)
      } catch (err) {
        return done('failed', `Budget policy write failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }
}

/** Local-day key matching the usage store's day bucketing. */
function toLocalDayKeyForCutoff(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
