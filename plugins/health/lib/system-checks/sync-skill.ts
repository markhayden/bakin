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
import { healthOk, healthWarn, healthError } from '@makinbakin/sdk/utils'
import type { AgentRuntimeAdapter } from '../../../../packages/core/src/adapters/runtime'
import type { HealthCheckResult, HealthRepairHandler } from '../../../../packages/core/src/plugin-types'

function ok(message: string): HealthCheckResult {
  return healthOk('skill', message)
}
function warn(message: string, autoFixable = false): HealthCheckResult {
  return healthWarn('skill', message, autoFixable)
}
function error(message: string): HealthCheckResult {
  return healthError('skill', message)
}
function fixed(message: string): HealthCheckResult {
  return { check: 'skill', status: 'fixed', message, autoFixable: true }
}

export async function checkAndSyncSkill(projectRoot: string, runtime: AgentRuntimeAdapter): Promise<HealthCheckResult[]> {
  return checkAndSyncSkillInternal(projectRoot, runtime, false)
}

async function checkAndSyncSkillInternal(
  projectRoot: string,
  runtime: AgentRuntimeAdapter,
  autoFix: boolean,
): Promise<HealthCheckResult[]> {
  let skillStatus: Awaited<ReturnType<typeof checkBakinRuntimeSkill>>
  try {
    skillStatus = await checkBakinRuntimeSkill(projectRoot, runtime)
  } catch (err) {
    return [error(`Failed to render skill template: ${(err as Error).message}`)]
  }

  if (skillStatus.upToDate) {
    return [ok('Bakin skill is up to date')]
  }

  const installMessage = skillStatus.installed
    ? 'Bakin skill is outdated in runtime'
    : 'Bakin skill not installed in runtime'
  if (!autoFix) {
    return [warn(installMessage, true)]
  }

  try {
    const renderedContent = renderBakinRuntimeSkill(projectRoot)
    await runtime.skills.write({ name: 'bakin', instructions: renderedContent, metadata: { source: 'bakin-doctor' } })
    return [fixed(skillStatus.installed ? 'Bakin skill updated in runtime' : 'Bakin skill installed in runtime')]
  } catch (err) {
    return [error(`Failed to update skill: ${err}`)]
  }
}

export function syncSkillRepair(projectRoot: string, runtime: AgentRuntimeAdapter): HealthRepairHandler {
  return {
    async plan(rows) {
      const matching = rows.filter(row => row.check === 'skill' && row.autoFixable)
      if (matching.length === 0) return []
      return [{
        id: 'health.sync-skill',
        checkId: 'skill',
        title: 'Sync Bakin runtime skill',
        reason: matching.map(row => row.message).join('; '),
        safety: 'safe',
        requiresConfirmation: true,
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
      const rows = await checkAndSyncSkillInternal(projectRoot, runtime, true)
      const failures = rows.filter(row => row.status === 'error')
      return [{
        id: 'health.sync-skill',
        checkId: 'skill',
        status: failures.length > 0 ? 'failed' : 'applied',
        message: rows.map(row => row.message).join('; '),
        changes: rows
          .filter(row => row.status === 'fixed')
          .map(row => ({
            kind: 'runtime' as const,
            target: 'runtime skill:bakin',
            action: 'update' as const,
            description: row.message,
          })),
      }]
    },
  }
}
