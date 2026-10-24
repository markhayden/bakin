/**
 * System check — stranded in-progress tasks.
 *
 * Reports in-progress tasks the execution ledger holds no running row for
 * (the restart-recovery predicate — a live run is never a candidate), plus
 * workflow states that need manual attention because Bakin cannot safely
 * infer the right active step.
 */
import { findRestartRecoveryCandidates, recoverStrandedTasks } from '../../../../src/core/restart-recovery'
import { healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthRepairActionDefinition, HealthRepairPlanItem } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'
import { getContentDir } from '../../../../src/core/content-dir'
import { stableKeyPart } from './key'

export const REQUEUE_STRANDED_TASKS_ACTION = 'requeue-stranded-tasks'
const CHECK_ID = 'health.restart-recovery'

export async function checkRestartRecovery(): Promise<HealthCheckRunInput> {
  try {
    const candidates = await findRestartRecoveryCandidates(getContentDir())
    if (candidates.length === 0) {
      return healthObserved([healthHealthy({
        key: 'candidates',
        summary: 'No stranded in-progress tasks.',
        evidence: { candidateCount: 0 },
      })])
    }

    const recoverable = candidates.filter((candidate) => candidate.action === 'recover').length
    const exhausted = candidates.filter((candidate) => candidate.action === 'block').length
    const manual = candidates.filter((candidate) => candidate.action === 'manual').length
    const examples = candidates.slice(0, 3).map((candidate) => {
      const agents = candidate.effectiveAgents.length > 0
        ? ` agents=${candidate.effectiveAgents.slice(0, 10).join(',')}`
        : ''
      return `${candidate.title.slice(0, 160)} (${candidate.reason}${agents})`
    }).join('; ')

    return healthObserved([healthWarning({
      key: 'candidates',
      summary: `${candidates.length} in-progress task${candidates.length === 1 ? '' : 's'} ha${candidates.length === 1 ? 's' : 've'} no live run.`,
      detail: `${recoverable} recoverable, ${exhausted} exhausted, ${manual} manual. ${examples}`,
      evidence: {
        candidateCount: candidates.length,
        recoverable,
        exhausted,
        manual,
        candidates: candidates.slice(0, 20).map(({ id, title, action, reason }) => ({
          id,
          title: title.slice(0, 200),
          action,
          reason,
        })),
      },
      incident: {
        key: 'stale-tasks',
        title: 'In-progress tasks have no live run',
        impact: 'Nothing is executing these tasks; they stay stalled until recovery re-queues them or an operator chooses the next state.',
        disposition: 'action_required',
        resources: candidates.slice(0, 50).map((candidate) => ({
          kind: 'task' as const,
          id: stableKeyPart(candidate.id),
          label: candidate.title.slice(0, 120),
        })),
        resolution: { key: REQUEUE_STRANDED_TASKS_ACTION, type: 'repair', label: 'Requeue the stranded tasks', actionId: REQUEUE_STRANDED_TASKS_ACTION },
      },
    })])
  } catch (err) {
    return healthObserved([healthUnknown({
      key: 'candidates',
      summary: 'Restart recovery status could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'inspection-failed',
        title: 'Restart recovery status is unknown',
        impact: 'Health cannot identify stale in-progress tasks that may need recovery.',
        disposition: 'watch',
        resources: [{ kind: 'system', id: 'task-recovery', label: 'Task restart recovery' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })])
  }
}

/**
 * `requeue-stranded-tasks` (self-healing PR1 slice 1.3d, row 29): the
 * restart-recovery engine for the recoverable candidates, one item per task.
 * Re-running turns is an operator decision (S), so it is `manual`. Exhausted
 * and manual-hold candidates are never requeued blind: they stay named in
 * the incident for the operator's choice on the board.
 */
export function requeueStrandedTasksRepair(): HealthRepairActionDefinition {
  return {
    id: REQUEUE_STRANDED_TASKS_ACTION,
    name: 'Requeue stranded tasks',
    operationPlan: () => ({ stages: [{ id: 'requeue', kind: 'installing', label: 'Return the tasks to Todo' }], pointOfNoReturn: 'requeue' }),
    async plan(target) {
      const candidates = await findRestartRecoveryCandidates(getContentDir())
      const recoverable = candidates.filter((candidate) => candidate.action === 'recover')
      const held = candidates.length - recoverable.length
      return recoverable.map((candidate): HealthRepairPlanItem => ({
        id: candidate.id,
        actionId: REQUEUE_STRANDED_TASKS_ACTION,
        title: `Requeue "${candidate.title.slice(0, 100)}"`,
        reason: `No live run is executing it (${candidate.reason}); returning it to Todo re-dispatches it (attempt ${candidate.recoveryCount + 1}).${held > 0 ? ` ${held} other stranded task${held === 1 ? ' needs' : 's need'} an operator's choice on the board.` : ''}`,
        safety: 'manual',
        ...repairTargetSelection(target),
        changes: [{ kind: 'task', target: candidate.id, action: 'update', description: `Return "${candidate.title.slice(0, 100)}" to Todo so dispatch runs it again; its recovery count goes up by one.` }],
      }))
    },
    async apply(items, op) {
      if (items.length === 0) return []
      op.stage('requeue')
      const ids = items.map((item) => item.id)
      const outcomes = await recoverStrandedTasks(getContentDir(), ids)
      return items.map((item) => {
        const outcome = outcomes.find((row) => row.id === item.id)
        const status = outcome?.outcome === 'recovered' ? 'applied' as const : outcome?.outcome === 'blocked' ? 'failed' as const : 'skipped' as const
        const message = outcome?.outcome === 'recovered'
          ? `${item.id} returned to Todo for re-dispatch.`
          : `${item.id} was not requeued: ${outcome?.reason ?? 'no outcome reported'}.`
        op.item('requeue', { id: item.id, label: item.id, status: status === 'applied' ? 'done' : status, message })
        return { itemId: item.id, actionId: item.actionId, status, message, affectedCheckIds: [CHECK_ID], changes: item.changes }
      })
    },
  }
}
