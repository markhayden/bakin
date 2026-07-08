/**
 * System check — spend vs budget caps.
 *
 * Green when no caps are configured or spend is comfortably under them; warn
 * as global utilization approaches a cap or when dispatch deferred any runs
 * in the last 24h; fail at/over a cap. The budget policy lives in the models
 * plugin (read via hook); spend comes from the execution ledger. An
 * unreachable ledger is an error — gating fails closed without it.
 */
import { queryAuditEvents } from '../../../../src/core/audit'
import { getContentDir } from '../../../../src/core/content-dir'
import { LedgerUnavailableError } from '../../../../src/core/execution-ledger'
import { assembleBudgetSpend } from '../../../../src/core/budget-spend'
import { evaluateBudget, type BudgetPolicy } from '../../../../src/core/budget'
import { getHookRegistry } from '../../../../packages/core/src/hooks/hook-registry-singleton'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

const CHECK = 'budget'
const WINDOW_MS = 24 * 60 * 60 * 1000

function result(status: HealthCheckResult['status'], message: string): HealthCheckResult {
  return { check: CHECK, status, message, autoFixable: false }
}

function fmtUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`
}

export async function checkBudget(): Promise<HealthCheckResult[]> {
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
    return [result('warn', 'No spending budget is set — agent spend is uncapped. Set one in Models → Spend or `bakin budget set`.')]
  }

  const now = Date.now()
  let facets: Awaited<ReturnType<typeof assembleBudgetSpend>>
  try {
    // Same engine the dispatch gate reads (total-observed basis: attributed
    // metered spend + the unattributed usage.db delta) — no parallel math.
    facets = await assembleBudgetSpend(now)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const kind = err instanceof LedgerUnavailableError ? 'unreachable' : 'failing'
    return [result('error', `Spend ledger is ${kind} — budget gating is failing closed (dispatch deferring). ${detail}`)]
  }

  const deferred = queryAuditEvents(getContentDir(), { kinds: ['budget.deferred'], sinceMs: WINDOW_MS }).length

  // Reuse the SAME cap arithmetic the dispatch gate uses (evaluateBudget) so
  // the doctor can't drift from what dispatch actually enforces. Evaluate the
  // GLOBAL rules for both lanes (per-agent/provider rule surfacing lands with
  // the rule-aware check in T17).
  const globalRules = policy.rules.filter((r) => r.scope === 'global')
  const decisions = (['metered', 'subscription'] as const).map((lane) =>
    evaluateBudget({ policy: { rules: globalRules }, turn: { agent: '', lane }, facets }),
  )
  const decision =
    decisions.find((d) => d.action === 'defer') ?? decisions.find((d) => d.action === 'warn') ?? { action: 'allow' as const }
  const deferNote = deferred ? ` ${deferred} run(s) deferred in the last 24h.` : ''
  const fmt = (d: Extract<typeof decision, { action: 'warn' | 'defer' }>, v: number): string =>
    d.unit === 'usd_micros' ? fmtUsd(v) : `${v.toLocaleString()} tokens`

  if (decision.action === 'defer') {
    return [result('error', `Global ${decision.window} ${decision.rule.lane} spend ${fmt(decision, decision.spentValue)} is at/over the ${fmt(decision, decision.capValue)} cap — dispatch is deferring.${deferNote}`)]
  }
  if (decision.action === 'warn' || deferred > 0) {
    const util = decision.action === 'warn' ? ` Global ${decision.window} ${decision.rule.lane} at ${Math.round((decision.spentValue / decision.capValue) * 100)}% of ${fmt(decision, decision.capValue)}.` : ''
    return [result('warn', `Spend approaching budget.${util}${deferNote}`)]
  }
  return [result('ok', 'Spend within budget.')]
}
