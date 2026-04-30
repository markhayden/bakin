/**
 * System check — restart recovery candidates.
 *
 * Reports in-progress tasks that appear recoverable on next startup recovery
 * pass, plus workflow states that need manual attention because Bakin cannot
 * safely infer the right active agent.
 */
import { findRestartRecoveryCandidates } from '../../../../src/core/restart-recovery'
import { getContentDir } from '../../../../src/core/content-dir'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

function ok(message: string): HealthCheckResult {
  return { check: 'restart-recovery', status: 'ok', message, autoFixable: false }
}

function warn(message: string): HealthCheckResult {
  return { check: 'restart-recovery', status: 'warn', message, autoFixable: false }
}

export async function checkRestartRecovery(): Promise<HealthCheckResult[]> {
  try {
    const candidates = await findRestartRecoveryCandidates(getContentDir())
    if (candidates.length === 0) {
      return [ok('No stale in-progress task recovery candidates found.')]
    }

    const recoverable = candidates.filter((candidate) => candidate.action === 'recover').length
    const exhausted = candidates.filter((candidate) => candidate.action === 'block').length
    const manual = candidates.filter((candidate) => candidate.action === 'manual').length
    const examples = candidates.slice(0, 3).map((candidate) => {
      const agents = candidate.effectiveAgents.length > 0 ? ` agents=${candidate.effectiveAgents.join(',')}` : ''
      return `${candidate.title} (${candidate.reason}${agents})`
    }).join('; ')

    return [warn(
      `${candidates.length} in-progress task(s) need restart recovery attention: ${recoverable} recoverable, ${exhausted} exhausted, ${manual} manual. ${examples}`,
    )]
  } catch (err) {
    return [warn(`Restart recovery check failed: ${err instanceof Error ? err.message : String(err)}`)]
  }
}
