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
import { evaluateBudget, type BudgetPolicy, type BudgetRule, type TurnBillingContext } from '../../../../src/core/budget'
import { getSettings } from '../../../../src/core/settings'
import { getHookRegistry } from '../../../../packages/core/src/hooks/hook-registry-singleton'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

const CHECK = 'budget'
const WINDOW_MS = 24 * 60 * 60 * 1000

function result(status: HealthCheckResult['status'], message: string, data?: Record<string, unknown>): HealthCheckResult {
  return { check: CHECK, status, message, autoFixable: false, ...(data ? { data } : {}) }
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

export async function checkBudget(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []

  if (getSettings().dispatch.paused) {
    results.push(result('warn', 'Dispatch is PAUSED (kill switch) — no task dispatch or billed media until resumed in Settings.', { paused: true }))
  }

  let policy: BudgetPolicy | undefined
  try {
    policy = (await getHookRegistry().invoke<BudgetPolicy>('models.getBudgetPolicy', {})) ?? undefined
  } catch {
    policy = undefined
  }
  if (!policy?.rules?.length) {
    // Standing nag (spec V2): a fresh install must not run uncapped
    // UNKNOWINGLY. Warn is the visible tier (no notice level exists);
    // setting any cap rule clears it.
    results.push(result('warn', 'No spending budget is set — agent spend is uncapped. Set one in Models → Spend or `bakin budget set`.'))
    return results
  }

  // Open incidents block/alert independently of CURRENT spend — a pause-mode
  // hold survives window rollover, so "spend is under cap" must never read
  // as "healthy" while dispatch is frozen (the frozen-but-green trap).
  try {
    const open = listBudgetIncidents({ openOnly: true })
    if (open.length > 0) {
      const pausing = open.filter((i) => i.kind === 'cap' && i.atCap === 'pause')
      const status = pausing.length > 0 ? 'error' : 'warn'
      const holdNote = pausing.length > 0 ? ` ${pausing.length} pause-mode hold(s) are BLOCKING dispatch until resolved.` : ''
      results.push(
        result(status, `${open.length} open budget incident(s) — resolve in Models → Spend or \`bakin budget incidents\`.${holdNote}`, {
          incidents: open.map((i) => ({ id: i.id, scope: i.scope, scopeId: i.scopeId, lane: i.lane, window: i.window, kind: i.kind, atCap: i.atCap, status: i.status })),
          ...(pausing.length ? { pausing: pausing.length } : {}),
        }),
      )
    }
  } catch (err) {
    void err // incident read failure — the spend evaluation below still runs
  }

  const now = Date.now()
  let facets: Awaited<ReturnType<typeof assembleBudgetSpend>>
  try {
    facets = await assembleBudgetSpend(now)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const kind = err instanceof LedgerUnavailableError ? 'unreachable' : 'failing'
    results.push(result('error', `Spend ledger is ${kind} — budget gating is failing closed (dispatch deferring). ${detail}`))
    return results
  }

  const deferred = queryAuditEvents(getContentDir(), { kinds: ['budget.deferred'], sinceMs: WINDOW_MS }).length
  const deferNote = deferred ? ` ${deferred} run(s) deferred in the last 24h.` : ''

  // Probe each rule with a synthetic matching turn — same evaluator, same
  // facets as the gate. Worst breach drives the row status.
  const breaches: Array<{ rule: BudgetRule; action: 'warn' | 'defer'; window: string; unit: 'usd_micros' | 'tokens'; spentValue: number; capValue: number }> = []
  for (const rule of policy.rules) {
    const decision = evaluateBudget({ policy: { rules: [rule] }, turn: matchingTurn(rule), facets })
    if (decision.action === 'allow') continue
    breaches.push({ rule, action: decision.action, window: decision.window, unit: decision.unit, spentValue: decision.spentValue, capValue: decision.capValue })
  }

  // Agent-scoped breaches attribute directly; global/provider breaches get a
  // synthetic 'global' entry so the Attention section shows SOMETHING for the
  // most common breach (the onboarding-created global rule).
  const agents = [...new Set(breaches.filter((b) => b.rule.scope === 'agent' && b.rule.scopeId).map((b) => b.rule.scopeId as string))]
  if (breaches.some((b) => b.rule.scope !== 'agent')) agents.push('global')
  const data = {
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
  }

  const worst = breaches.find((b) => b.action === 'defer') ?? breaches[0]
  if (worst?.action === 'defer') {
    const capped = breaches.filter((b) => b.action === 'defer')
    const detail = capped
      .map((b) => `${ruleLabel(b.rule)} ${b.window} ${b.rule.lane} ${fmtValue(b.unit, b.spentValue)}/${fmtValue(b.unit, b.capValue)}`)
      .join('; ')
    results.push(result('error', `${capped.length} budget cap(s) at/over limit — dispatch is deferring: ${detail}.${deferNote}`, data))
  } else if (worst || deferred > 0) {
    const detail = worst
      ? ` ${ruleLabel(worst.rule)} ${worst.window} ${worst.rule.lane} at ${Math.round((worst.spentValue / worst.capValue) * 100)}% of ${fmtValue(worst.unit, worst.capValue)}.`
      : ''
    results.push(result('warn', `Spend approaching budget.${detail}${deferNote}`, data))
  } else {
    results.push(result('ok', `Spend within budget (${policy.rules.length} rule${policy.rules.length === 1 ? '' : 's'}).`, data))
  }
  return results
}
