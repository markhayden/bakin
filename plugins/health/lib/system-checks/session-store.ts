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
import type { HealthCheckRunInput, HealthIncidentDeclaration, HealthObservationInput, HealthRepairActionDefinition, HealthRepairPlanItemInput, HealthRepairTarget } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'
import { stableKeyPart } from './key'

export const SESSION_STORE_PRUNE_ACTION = 'session-store-prune'
const CHECK_ID = 'health.session-store'
/** Row 14: the oversized store is the one incident (one-click, D); rows 13/15/16 are observations. */
export const SESSION_STORE_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'oversized', subjectKind: 'agent', resolution: { type: 'repair', actionId: SESSION_STORE_PRUNE_ACTION }, required: 'always' },
]

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
    // Row 13: an inspection that failed is an observation; the check's maxAgeMs re-runs it.
    return healthObserved([healthUnknown({
      key: 'usage',
      summary: 'Session-store usage could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
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
          // Row 14: the adapter's own cleanup is the repair; a runtime without
          // one plans nothing, and its guidance rides the impact copy.
          impact: `Continued growth can exhaust local disk space and slow runtime session operations.${runtime.sessions.pruneStore ? '' : ` ${remediation}`}`,
          disposition: 'action_required',
          subject: { kind: 'agent', id: stableKeyPart(agent.agentId), label: agentLabel },
          declarationId: 'oversized',
          resources,
          resolution: { key: SESSION_STORE_PRUNE_ACTION, type: 'repair', label: 'Delete old session transcripts', actionId: SESSION_STORE_PRUNE_ACTION },
        },
      }))
    } else if (agent.diskBytes > SESSION_STORE_WARN_BYTES) {
      // Row 15: growth is an observation; the cleanup guidance rides the detail.
      observations.push(healthWarning({
        key,
        summary: `${agentLabel}'s session store is growing.`,
        detail: `${detail}. ${remediation}`.slice(0, 4_000),
        evidence,
      }))
    } else if (agent.fileCount >= SESSION_STORE_ORPHAN_MIN_FILES && orphanRatio > SESSION_STORE_ORPHAN_RATIO) {
      // Row 16: orphaned artifacts are an observation; the cleanup guidance rides the detail.
      observations.push(healthWarning({
        key,
        summary: `${agentLabel} has accumulating session artifacts.`,
        detail: `${detail} (${orphanRatio.toFixed(0)}x files per live entry). ${remediation}`.slice(0, 4_000),
        evidence,
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

/** The agents a repair target names (`oversized:<agent>` incidents, `agent:<agent>` observations); every oversized agent for all_actionable. */
function agentsSelectedBy(target: HealthRepairTarget, oversized: string[]): string[] {
  if (target.type === 'all_actionable') return oversized
  const prefix = target.type === 'incidents' ? `${CHECK_ID}:oversized:` : `${CHECK_ID}:agent:`
  const named = new Set(target.ids.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length)))
  return oversized.filter((agentId) => named.has(stableKeyPart(agentId)))
}

/**
 * `session-store-prune` (self-healing PR1 slice 1.3c, row 14): the runtime's
 * own session cleanup, one item per oversized agent. It deletes transcripts
 * (user content), so the ONE mode policy makes it one-click.
 */
export function sessionStorePruneRepair(runtime: Pick<AgentRuntimeAdapter, 'sessions'>): HealthRepairActionDefinition {
  return {
    id: SESSION_STORE_PRUNE_ACTION,
    name: 'Delete old session transcripts',
    effects: { deletesUserContent: true, spendsMoney: false, widensAuthorization: false },
    mutation: 'delete',
    operationPlan: () => ({ stages: [{ id: 'prune', kind: 'installing', label: 'Delete old session transcripts' }], pointOfNoReturn: 'prune' }),
    async plan(target) {
      if (!runtime.sessions.pruneStore || !runtime.sessions.storeStats) return []
      const stats = await runtime.sessions.storeStats()
      const oversized = stats.filter((agent) => agent.diskBytes > SESSION_STORE_ERROR_BYTES).map((agent) => agent.agentId)
      return agentsSelectedBy(target, oversized).map((agentId): HealthRepairPlanItemInput => {
        const agent = stats.find((row) => row.agentId === agentId)!
        return {
          id: agentId,
          actionId: SESSION_STORE_PRUNE_ACTION,
          title: `Delete ${agentId.slice(0, 120)}'s session transcripts older than 30 days`,
          reason: `${agentId}'s session store holds ${formatMb(agent.diskBytes)} across ${agent.fileCount} files; transcripts older than 30 days are no longer resumed by any task.`,
          ...repairTargetSelection(target),
          changes: [{ kind: 'file', target: `sessions:${agentId}`, action: 'delete', description: `Delete ${agentId}'s session transcripts older than 30 days (a thread with a turn in flight is kept). Recent sessions and everything else in the store stay.` }],
        }
      })
    },
    async apply(items, op) {
      if (items.length === 0 || !runtime.sessions.pruneStore) return []
      op.stage('prune')
      const results = []
      for (const item of items) {
        const agentId = item.id
        op.item('prune', { id: agentId, label: agentId, status: 'active' })
        try {
          const pruned = await runtime.sessions.pruneStore(agentId)
          const message = `Deleted ${pruned.removedFiles} session file${pruned.removedFiles === 1 ? '' : 's'} (${formatMb(pruned.freedBytes)}) for ${agentId}${pruned.skippedInFlight > 0 ? `; ${pruned.skippedInFlight} kept because a turn was in flight` : ''}.`
          op.item('prune', { id: agentId, label: agentId, status: 'done', message })
          results.push({ itemId: item.id, actionId: item.actionId, status: 'applied' as const, message, affectedCheckIds: [CHECK_ID], changes: item.changes })
        } catch (err) {
          const message = `Could not prune ${agentId}'s session store: ${err instanceof Error ? err.message : String(err)}`
          op.item('prune', { id: agentId, label: agentId, status: 'failed', message })
          results.push({ itemId: item.id, actionId: item.actionId, status: 'failed' as const, message, affectedCheckIds: [CHECK_ID], changes: item.changes })
        }
      }
      return results
    },
  }
}
