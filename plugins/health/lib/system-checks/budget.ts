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
import { dayStartMs, monthStartMs, DEFAULT_WARN_PCT, type BudgetPolicy } from '../../../../src/core/budget'
import { getHookRegistry } from '../../../../src/lib/plugin-registry'
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

  const warnPct = policy.global?.warnPct ?? DEFAULT_WARN_PCT
  const deferred = queryAuditEvents(getContentDir(), { kinds: ['budget.deferred'], sinceMs: WINDOW_MS }).length

  // Worst global utilization across day/month caps.
  const checks: Array<{ window: string; spent: number; capUsd: number }> = []
  if (policy.global?.dailyUsd) checks.push({ window: 'daily', spent: dayMicros, capUsd: policy.global.dailyUsd })
  if (policy.global?.monthlyUsd) checks.push({ window: 'monthly', spent: monthMicros, capUsd: policy.global.monthlyUsd })

  let worst: { window: string; spent: number; capMicros: number; pct: number } | null = null
  for (const c of checks) {
    const capMicros = Math.round(c.capUsd * 1_000_000)
    const pct = capMicros > 0 ? c.spent / capMicros : 0
    if (!worst || pct > worst.pct) worst = { window: c.window, spent: c.spent, capMicros, pct }
  }

  if (worst && worst.pct >= 1) {
    return [result('error', `Global ${worst.window} spend ${fmtUsd(worst.spent)} is at/over the ${fmtUsd(worst.capMicros)} cap — dispatch is deferring${deferred ? ` (${deferred} run(s) deferred in 24h)` : ''}.`)]
  }
  if ((worst && worst.pct >= warnPct) || deferred > 0) {
    const util = worst ? ` Global ${worst.window} at ${Math.round(worst.pct * 100)}% of ${fmtUsd(worst.capMicros)}.` : ''
    return [result('warn', `Spend approaching budget.${util}${deferred ? ` ${deferred} run(s) deferred in the last 24h.` : ''}`)]
  }
  const utilNote = worst ? ` Global ${worst.window} at ${Math.round(worst.pct * 100)}% of ${fmtUsd(worst.capMicros)}.` : ''
  return [result('ok', `Spend within budget.${utilNote}`)]
}
