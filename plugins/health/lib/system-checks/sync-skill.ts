/**
 * System check — render Bakin's SKILL.md template into the runtime skill
 * store. Source of truth is the repo's `skill/SKILL.md` for static
 * content; the exec-tools block between markers is generated at sync
 * time as a compact runtime summary.
 *
 * Migrated out of src/core/doctor.ts (#139 C8). Auto-fixable — safe
 * because it creates/overwrites only Bakin's own skill file.
 */
import { checkBakinRuntimeSkill, renderBakinRuntimeSkill } from '../../../../src/core/bakin-skill'
import { healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { AgentRuntimeAdapter } from '../../../../packages/core/src/adapters/runtime'
import type { HealthCheckRunInput, HealthRepairActionDefinition } from '@makinbakin/sdk'
import { repairTargetSelection } from './repair-support'

export async function checkAndSyncSkill(
  projectRoot: string,
  runtime: AgentRuntimeAdapter,
): Promise<HealthCheckRunInput> {
  let skillStatus: Awaited<ReturnType<typeof checkBakinRuntimeSkill>>
  try {
    skillStatus = await checkBakinRuntimeSkill(projectRoot, runtime)
  } catch (err) {
    return healthObserved([healthUnknown({
      key: 'runtime-skill',
      summary: 'Bakin runtime skill could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'inspection-failed',
        title: 'Runtime skill status is unknown',
        impact: 'Health cannot confirm whether agents have current Bakin instructions.',
        disposition: 'watch',
        resources: [{ kind: 'runtime', id: 'skill-bakin', label: 'Bakin runtime skill' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })])
  }

  if (skillStatus.upToDate) {
    return healthObserved([healthHealthy({
      key: 'runtime-skill',
      summary: 'Bakin runtime skill is up to date.',
      evidence: { installed: true, upToDate: true },
    })])
  }

  return healthObserved([healthWarning({
    key: 'runtime-skill',
    summary: skillStatus.installed
      ? 'Bakin runtime skill is outdated.'
      : 'Bakin runtime skill is not installed.',
    evidence: { installed: skillStatus.installed, upToDate: false },
    incident: {
      key: skillStatus.installed ? 'outdated' : 'missing',
      title: skillStatus.installed ? 'Bakin runtime skill is outdated' : 'Bakin runtime skill is missing',
      impact: 'Agents may use stale or incomplete instructions for Bakin tools and workflows.',
      disposition: 'action_required',
      resources: [{ kind: 'runtime', id: 'skill-bakin', label: 'Bakin runtime skill' }],
      resolution: {
        key: 'sync-runtime-skill',
        type: 'repair',
        label: skillStatus.installed ? 'Update runtime skill' : 'Install runtime skill',
        actionId: 'sync-skill',
      },
    },
  })])
}

export function syncSkillRepair(
  projectRoot: string,
  runtime: AgentRuntimeAdapter,
): HealthRepairActionDefinition {
  return {
    id: 'sync-skill',
    name: 'Sync Bakin runtime skill',
    async plan(target) {
      return [{
        id: 'sync-runtime-skill',
        actionId: 'sync-skill',
        title: 'Sync Bakin runtime skill',
        reason: 'The runtime skill is missing or differs from Bakin\'s current generated instructions.',
        safety: 'safe',
        ...repairTargetSelection(target),
        changes: [{
          kind: 'runtime',
          target: 'runtime skill:bakin',
          action: 'update',
          description: 'Write the rendered Bakin SKILL.md to the runtime skill store.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      try {
        const renderedContent = renderBakinRuntimeSkill(projectRoot)
        await runtime.skills.write({ name: 'bakin', instructions: renderedContent, metadata: { source: 'bakin-doctor' } })
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'applied' as const,
          message: 'Bakin runtime skill synced.',
          affectedCheckIds: ['health.skill'],
          changes: item.changes,
        }))
      } catch (err) {
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: err instanceof Error ? err.message : String(err),
          affectedCheckIds: ['health.skill'],
          changes: item.changes,
        }))
      }
    },
  }
}
