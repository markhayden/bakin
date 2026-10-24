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
import type { HealthCheckRunInput, HealthIncidentDeclaration, HealthRepairActionDefinition } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'

export const SYNC_SKILL_ACTION = 'sync-skill'
/** Row 91 (split by state): both families self-heal through `sync-skill`; row 90 is an observation. */
export const SKILL_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'outdated', subjectKind: 'runtime', resolution: { type: 'repair', actionId: SYNC_SKILL_ACTION }, required: 'always' },
  { id: 'missing', subjectKind: 'runtime', resolution: { type: 'repair', actionId: SYNC_SKILL_ACTION }, required: 'always' },
]

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
      declarationId: skillStatus.installed ? 'outdated' : 'missing',
      title: skillStatus.installed ? 'Bakin runtime skill is outdated' : 'Bakin runtime skill is missing',
      impact: 'Agents may use stale or incomplete instructions for Bakin tools and workflows.',
      disposition: 'action_required',
      subject: { kind: 'runtime', id: 'active', label: 'Active runtime' },
      resources: [{ kind: 'runtime', id: 'skill-bakin', label: 'Bakin runtime skill' }],
      resolution: {
        key: 'sync-runtime-skill',
        type: 'repair',
        label: skillStatus.installed ? 'Update runtime skill' : 'Install runtime skill',
        actionId: SYNC_SKILL_ACTION,
      },
    },
  })])
}

export function syncSkillRepair(
  projectRoot: string,
  runtime: AgentRuntimeAdapter,
): HealthRepairActionDefinition {
  return {
    id: SYNC_SKILL_ACTION,
    name: 'Sync Bakin runtime skill',
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false },
    mutation: 'none',
    operationPlan: () => ({
      stages: [
        { id: 'render', kind: 'preparing', label: 'Render the Bakin skill' },
        { id: 'write', kind: 'installing', label: 'Write it to the runtime' },
      ],
      pointOfNoReturn: 'write',
    }),
    async plan(target) {
      return [{
        id: 'sync-runtime-skill',
        actionId: SYNC_SKILL_ACTION,
        title: 'Sync Bakin runtime skill',
        reason: 'The runtime skill is missing or differs from Bakin\'s current generated instructions.',
        ...repairTargetSelection(target),
        changes: [{
          kind: 'runtime',
          target: 'runtime skill:bakin',
          action: 'update',
          description: 'Write the rendered Bakin SKILL.md to the runtime skill store.',
        }],
      }]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      try {
        op.stage('render')
        const renderedContent = renderBakinRuntimeSkill(projectRoot)
        op.stage('write')
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
