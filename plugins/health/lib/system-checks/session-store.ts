/**
 * System check — runtime session-store growth (#435).
 *
 * Runtime session stores prune live entries on writes, but unreferenced
 * transcript artifacts typically only get GC'd by explicit cleanup runs or
 * a configured disk budget. This check is the early warning when
 * accumulation outruns maintenance. Read-only: remediation mutates
 * runtime-owned data, so it is never auto-fixed — and the remediation TEXT
 * is adapter-provided (`RuntimeSessionStoreStats.remediation`), because the
 * cleanup commands are provider-specific and belong behind the adapter.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { healthError, healthHealthy, healthNotApplicable, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthObservationInput } from '@makinbakin/sdk'
import { stableKeyPart } from './key'

// First-guess thresholds, sized against observed reality on 2026-06-11
// (main at 321MB / 1,812 files / 74 entries — a 24x orphan ratio).
export const SESSION_STORE_WARN_BYTES = 500 * 1024 * 1024
export const SESSION_STORE_ERROR_BYTES = 1024 * 1024 * 1024
export const SESSION_STORE_ORPHAN_RATIO = 10
export const SESSION_STORE_ORPHAN_MIN_FILES = 100


function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export async function checkSessionStore(
  runtime: Pick<AgentRuntimeAdapter, 'sessions'>,
): Promise<HealthCheckRunInput> {
  if (!runtime.sessions.storeStats) {
    return healthNotApplicable('The active runtime does not expose session-store statistics.')
  }

  let stats
  try {
    stats = await runtime.sessions.storeStats()
  } catch (err) {
    return healthObserved([healthUnknown({
      key: 'usage',
      summary: 'Session-store usage could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'inspection-failed',
        title: 'Session-store usage is unknown',
        impact: 'Health cannot tell whether runtime session artifacts are consuming excessive disk space.',
        disposition: 'watch',
        resources: [{ kind: 'runtime', id: 'active', label: 'Active runtime' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })])
  }

  const observations: HealthObservationInput[] = []
  for (const agent of stats) {
    // Adapter-owned guidance; neutral fallback when the adapter offers none.
    const remediation = (agent.remediation ?? "Run the runtime's session cleanup to prune old session artifacts.").slice(0, 4_000)
    const agentLabel = agent.agentId.slice(0, 120)
    const orphanRatio = agent.fileCount / Math.max(agent.storeEntries, 1)
    const detail = `${agentLabel}: ${formatMb(agent.diskBytes)}, ${agent.fileCount} files, ${agent.storeEntries} store entries`
    const key = `agent:${stableKeyPart(agent.agentId)}`
    const evidence = {
      agentId: agent.agentId.slice(0, 500),
      diskBytes: agent.diskBytes,
      fileCount: agent.fileCount,
      storeEntries: agent.storeEntries,
      orphanRatio,
    }
    const resources = [
      { kind: 'agent' as const, id: stableKeyPart(agent.agentId), label: agentLabel },
      { kind: 'session' as const, id: `store-${stableKeyPart(agent.agentId)}`, label: `${agentLabel.slice(0, 106)} session store` },
    ]
    if (agent.diskBytes > SESSION_STORE_ERROR_BYTES) {
      observations.push(healthError({
        key,
        summary: `${agentLabel}'s session store is oversized.`,
        detail,
        evidence,
        incident: {
          key: `oversized:${stableKeyPart(agent.agentId)}`,
          title: 'Session store exceeds 1 GB',
          impact: 'Continued growth can exhaust local disk space and slow runtime session operations.',
          disposition: 'action_required',
          resources,
          resolution: {
            key: 'clean-session-store',
            type: 'instructions',
            label: 'Clean up the session store',
            steps: [remediation],
          },
        },
      }))
    } else if (agent.diskBytes > SESSION_STORE_WARN_BYTES) {
      observations.push(healthWarning({
        key,
        summary: `${agentLabel}'s session store is growing.`,
        detail,
        evidence,
        incident: {
          key: `growing:${stableKeyPart(agent.agentId)}`,
          title: 'Session-store growth needs watching',
          impact: 'The session store may become oversized if growth continues.',
          disposition: 'watch',
          resources,
          resolution: {
            key: 'clean-session-store',
            type: 'instructions',
            label: 'Review cleanup guidance',
            steps: [remediation],
          },
        },
      }))
    } else if (agent.fileCount >= SESSION_STORE_ORPHAN_MIN_FILES && orphanRatio > SESSION_STORE_ORPHAN_RATIO) {
      observations.push(healthWarning({
        key,
        summary: `${agentLabel} has accumulating session artifacts.`,
        detail: `${detail} (${orphanRatio.toFixed(0)}x files per live entry).`,
        evidence,
        incident: {
          key: `orphaned:${stableKeyPart(agent.agentId)}`,
          title: 'Orphaned session artifacts are accumulating',
          impact: 'Unreferenced artifacts consume disk space without supporting live sessions.',
          disposition: 'watch',
          resources,
          resolution: {
            key: 'clean-session-store',
            type: 'instructions',
            label: 'Review cleanup guidance',
            steps: [remediation],
          },
        },
      }))
    }
  }

  if (observations.length === 0) {
    const totalBytes = stats.reduce((sum, s) => sum + s.diskBytes, 0)
    return healthObserved([healthHealthy({
      key: 'usage',
      summary: `Session stores are healthy across ${stats.length} agent${stats.length === 1 ? '' : 's'}.`,
      detail: `${formatMb(totalBytes)} total disk usage.`,
      evidence: { agentCount: stats.length, totalBytes },
    })])
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}
