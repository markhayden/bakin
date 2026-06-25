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
import { spendTotal, LedgerUnavailableError } from '../../../../src/core/execution-ledger'
import { evaluateBudget, dayStartMs, monthStartMs, type BudgetPolicy } from '../../../../src/core/budget'
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
  if (!policy || (!policy.global && !policy.perAgent)) {
    return [result('ok', 'No budget caps configured — spend is unrestricted.')]
  }

  const now = Date.now()
  let dayMicros: number
  let monthMicros: number
  try {
    dayMicros = spendTotal({ sinceMs: dayStartMs(now) })
    monthMicros = spendTotal({ sinceMs: monthStartMs(now) })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const kind = err instanceof LedgerUnavailableError ? 'unreachable' : 'failing'
    return [result('error', `Spend ledger is ${kind} — budget gating is failing closed (dispatch deferring). ${detail}`)]
  }

  const deferred = queryAuditEvents(getContentDir(), { kinds: ['budget.deferred'], sinceMs: WINDOW_MS }).length

  // Reuse the SAME cap arithmetic the dispatch gate uses (evaluateBudget) so
  // the doctor can't drift from what dispatch actually enforces. Evaluate the
  // GLOBAL scope only (agent spend zeroed, no per-agent caps).
  const decision = evaluateBudget({
    policy: { global: policy.global },
    agent: '',
    spend: { globalDayMicros: dayMicros, globalMonthMicros: monthMicros, agentDayMicros: 0, agentMonthMicros: 0 },
  })
  const deferNote = deferred ? ` ${deferred} run(s) deferred in the last 24h.` : ''

  if (decision.action === 'defer') {
    return [result('error', `Global ${decision.window} spend ${fmtUsd(decision.spentUsdMicros)} is at/over the ${fmtUsd(decision.capUsdMicros)} cap — dispatch is deferring.${deferNote}`)]
  }
  if (decision.action === 'warn' || deferred > 0) {
    const util = decision.action === 'warn' ? ` Global ${decision.window} at ${Math.round((decision.spentUsdMicros / decision.capUsdMicros) * 100)}% of ${fmtUsd(decision.capUsdMicros)}.` : ''
    return [result('warn', `Spend approaching budget.${util}${deferNote}`)]
  }
  return [result('ok', 'Spend within budget.')]
}
