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
import { healthError, healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthIncidentDeclaration } from '@makinbakin/sdk'

const WINDOW_MS = 24 * 60 * 60 * 1000

/** Row 31: an unreachable ledger is the fallback lane's (nothing deterministic restores it); rows 32–33 are observations. */
export const EXECUTION_SAFETY_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'ledger-unavailable', subjectKind: 'system', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' },
]

/** Every duplicate-suppression / conflict event the safety layers emit. */
export const SUPPRESSION_EVENT_KINDS = [
  'schedule.fire_suppressed',
  'task.completion_suppressed',
  'task.dispatch_suppressed',
  'task.run_superseded',
  'tasks.edit_conflict',
] as const

export async function checkExecutionSafety(): Promise<HealthCheckRunInput> {
  // Ledger reachability first — without it the guards fail closed and
  // nothing dispatches/fires/completes.
  try {
    getLiveRun('__execution-safety-health-probe__')
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const kind = err instanceof LedgerUnavailableError ? 'unreachable' : 'failing'
    return healthObserved([healthError({
      key: 'ledger',
      summary: `Execution ledger is ${kind}.`,
      detail,
      evidence: { reachable: false },
      incident: {
        key: 'ledger-unavailable',
        title: 'Execution safety ledger is unavailable',
        impact: 'Task dispatch, scheduled fires, and completions fail closed without the ledger (its storage path or permissions are the usual cause).',
        disposition: 'action_required',
        subject: { kind: 'system', id: 'execution-ledger', label: 'Execution ledger' },
        declarationId: 'ledger-unavailable',
        resources: [{ kind: 'system', id: 'execution-ledger', label: 'Execution ledger' }],
        resolution: { key: 'restore-ledger', type: 'repair', label: 'Investigate the execution ledger', actionId: 'core.diagnose' },
      },
    })])
  }

  let events
  try {
    events = queryAuditEvents(getContentDir(), {
      kinds: [...SUPPRESSION_EVENT_KINDS],
      sinceMs: WINDOW_MS,
    })
  } catch (err) {
    return healthObserved([healthUnknown({
      key: 'duplicates',
      summary: 'Duplicate suppression history could not be verified.',
      detail: `${err instanceof Error ? err.message : String(err)} (audit.jsonl)`,
    })])
  }

  if (events.length === 0) {
    return healthObserved([healthHealthy({
      key: 'duplicates',
      summary: 'Execution guards are healthy.',
      detail: 'No duplicate executions were attempted in the last 24 hours, and the ledger is reachable.',
      evidence: { reachable: true, suppressedInWindow: 0, windowMs: WINDOW_MS },
    })])
  }

  const counts = new Map<string, number>()
  for (const event of events) {
    counts.set(event.event, (counts.get(event.event) ?? 0) + 1)
  }
  const breakdown = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${kind}=${count}`)
    .join(', ')

  return healthObserved([healthWarning({
    key: 'duplicates',
    summary: `${events.length} duplicate execution${events.length === 1 ? ' was' : 's were'} suppressed in the last 24 hours.`,
    detail: `${breakdown}. The guards prevented duplicate side effects, but something upstream is producing duplicate attempts.`,
    evidence: {
      reachable: true,
      suppressedInWindow: events.length,
      windowMs: WINDOW_MS,
      counts: Object.fromEntries(counts),
    },
  })])
}
