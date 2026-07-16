/**
 * System check — restart recovery candidates.
 *
 * Reports in-progress tasks that appear recoverable on next startup recovery
 * pass, plus workflow states that need manual attention because Bakin cannot
 * safely infer the right active agent.
 */
import { findRestartRecoveryCandidates } from '../../../../src/core/restart-recovery'
import { healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput } from '@makinbakin/sdk'
import { getContentDir } from '../../../../src/core/content-dir'
import { stableKeyPart } from './key'

export async function checkRestartRecovery(): Promise<HealthCheckRunInput> {
  try {
    const candidates = await findRestartRecoveryCandidates(getContentDir())
    if (candidates.length === 0) {
      return healthObserved([healthHealthy({
        key: 'candidates',
        summary: 'No stale in-progress tasks need recovery.',
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
      summary: `${candidates.length} in-progress task${candidates.length === 1 ? '' : 's'} need recovery attention.`,
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
        title: 'In-progress tasks need restart recovery',
        impact: 'Affected work may remain stalled until recovery runs or an operator chooses the correct next state.',
        disposition: 'action_required',
        resources: candidates.slice(0, 50).map((candidate) => ({
          kind: 'task' as const,
          id: stableKeyPart(candidate.id),
          label: candidate.title.slice(0, 120),
        })),
        resolution: {
          key: 'open-tasks',
          type: 'navigate',
          label: 'Review affected tasks',
          href: '/tasks',
        },
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
