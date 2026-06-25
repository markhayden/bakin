/**
 * System check — execution safety (duplicate suppression + ledger health).
 *
 * The execution ledger makes duplicate task firing/completion physically
 * impossible, and every caught duplicate is audited. This check makes those
 * suppressions VISIBLE: green means no duplicates were even attempted in
 * the window; a warn with counts means the guards fired — proof they work,
 * and a signal that something upstream is producing duplicates again. An
 * unreachable ledger is an error: dispatch/cron/completion fail closed
 * without it.
 */
import { queryAuditEvents } from '../../../../src/core/audit'
import { getContentDir } from '../../../../src/core/content-dir'
import { getLiveRun, LedgerUnavailableError } from '../../../../src/core/execution-ledger'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

const CHECK = 'execution-safety'
const WINDOW_MS = 24 * 60 * 60 * 1000

/** Every duplicate-suppression / conflict event the safety layers emit. */
export const SUPPRESSION_EVENT_KINDS = [
  'schedule.fire_suppressed',
  'task.completion_suppressed',
  'task.dispatch_suppressed',
  'task.run_superseded',
  'tasks.edit_conflict',
] as const

function result(status: HealthCheckResult['status'], message: string): HealthCheckResult {
  return { check: CHECK, status, message, autoFixable: false }
}

export async function checkExecutionSafety(): Promise<HealthCheckResult[]> {
  // Ledger reachability first — without it the guards fail closed and
  // nothing dispatches/fires/completes.
  try {
    getLiveRun('__execution-safety-health-probe__')
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const kind = err instanceof LedgerUnavailableError ? 'unreachable' : 'failing'
    return [result('error', `Execution ledger is ${kind} — dispatch, cron fires, and completions are failing closed. ${detail}`)]
  }

  const events = queryAuditEvents(getContentDir(), {
    kinds: [...SUPPRESSION_EVENT_KINDS],
    sinceMs: WINDOW_MS,
  })

  if (events.length === 0) {
    return [result('ok', 'No duplicate executions attempted in the last 24h; execution ledger reachable.')]
  }

  const counts = new Map<string, number>()
  for (const event of events) {
    counts.set(event.event, (counts.get(event.event) ?? 0) + 1)
  }
  const breakdown = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${kind}=${count}`)
    .join(', ')

  return [result(
    'warn',
    `${events.length} duplicate execution(s) suppressed in the last 24h (${breakdown}). `
    + 'The guards caught them — no duplicate side effects fired — but something upstream is producing duplicates. '
    + 'Inspect audit.jsonl for the listed events.',
  )]
}
