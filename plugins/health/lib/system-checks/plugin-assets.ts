/**
 * System check — plugin-shipped runtime skills AND declared binaries
 * (spec plugin-managed-binaries S5): surface install state + drift, with a
 * one-click `install-plugin-assets` repair that calls the onboarding
 * component's `install()` — the same engine as `bakin install plugin-assets`.
 */
import { applyPluginAssets, PLUGIN_ASSETS_PLAN, pluginAssetsComponent } from '../../../../src/core/onboarding/plugin-assets'
import { healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthRepairActionDefinition } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'

export const INSTALL_PLUGIN_ASSETS_ACTION = 'install-plugin-assets'
const CHECK_ID = 'health.plugin-assets'

export async function checkPluginAssets(): Promise<HealthCheckRunInput> {
  try {
    const result = await pluginAssetsComponent.check()
    if (result.status === 'error') {
      // Discovery failed (unreadable ledger): the state is UNKNOWN — never a
      // clean bill, never an "install assets" repair over a broken ledger.
      return healthObserved([healthUnknown({
        key: 'runtime-assets',
        summary: result.message,
        detail: result.remediation,
        incident: {
          key: 'inspection-failed',
          title: 'Plugin asset status is unknown',
          impact: 'Health cannot confirm whether plugin-provided runtime skills and binaries are current.',
          disposition: 'watch',
          resources: [{ kind: 'asset', id: 'plugin-runtime-assets', label: 'Plugin assets' }],
          resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
        },
      })])
    }
    if (result.status === 'ok') {
      return healthObserved([healthHealthy({
        key: 'runtime-assets',
        summary: result.message,
        evidence: { inSync: true, ...(result.details ?? {}) },
      })])
    }
    type SkillRef = { name: string; pluginId: string }
    const scan = result.details as { missing?: unknown[]; drifted?: unknown[]; userEditedDrifted?: SkillRef[]; invalidSource?: SkillRef[]; bins?: { missing?: unknown[]; drifted?: unknown[]; unsupported?: unknown[] } } | undefined
    const repairable = (scan?.missing?.length ?? 0) + (scan?.drifted?.length ?? 0)
      + (scan?.bins?.missing?.length ?? 0) + (scan?.bins?.drifted?.length ?? 0) + (scan?.bins?.unsupported?.length ?? 0)
    const locked = scan?.userEditedDrifted ?? []
    const invalid = scan?.invalidSource ?? []
    if (repairable === 0 && (locked.length > 0 || invalid.length > 0)) {
      // Nothing the repair can fix — the user locked these skills, or the
      // plugin ships one that is not text — so offering it would be a
      // button that does nothing (#898).
      const skillResource = (ref: SkillRef) => ({ kind: 'asset' as const, id: `skill:${ref.name}`, label: `${ref.name} (${ref.pluginId})` })
      return healthObserved([healthWarning({
        key: 'runtime-assets',
        summary: result.message,
        detail: result.remediation,
        evidence: { inSync: false, ...(result.details ?? {}) },
        incident: {
          key: locked.length > 0 ? 'user-edited-drifted' : 'skill-source-invalid',
          title: locked.length > 0 ? 'User-edited plugin skills differ from the plugin' : 'A plugin ships a skill Bakin cannot install',
          impact: [
            locked.length > 0 ? 'Agents run your edited copy, not the version the plugin ships. Bakin will not overwrite a skill you locked.' : null,
            invalid.length > 0 ? 'Skills whose files are not text are never installed, so agents cannot use them.' : null,
          ].filter(Boolean).join(' '),
          disposition: 'watch',
          resources: [...locked, ...invalid].map(skillResource),
          resolution: {
            key: locked.length > 0 ? 'unlock-user-edited-skills' : 'replace-plugin',
            type: 'instructions',
            label: locked.length > 0 ? 'Keep or restore' : 'Update the plugin',
            steps: [
              locked.length > 0
                ? 'Keep your edit and acknowledge this, or delete the skill\'s .userEdited file and run `bakin install plugin-assets` to restore the plugin\'s version.'
                : 'Update or remove the plugin that ships a skill with non-text files.',
              ...(locked.length > 0 && invalid.length > 0 ? ['Update or remove the plugin that ships a skill with non-text files.'] : []),
            ],
          },
        },
      })])
    }
    const reminder = result.remediation ?? 'Run `bakin install plugin-assets` to apply.'
    return healthObserved([healthWarning({
      key: 'runtime-assets',
      summary: result.message,
      detail: reminder,
      evidence: { inSync: false, ...(result.details ?? {}) },
      incident: {
        key: 'assets-out-of-sync',
        title: 'Plugin assets need installation',
        impact: 'Runtime skills or binaries shipped by plugins are missing or differ from what the plugins declare; those plugins may not work until they are reinstalled.',
        disposition: 'action_required',
        resources: [{ kind: 'asset', id: 'plugin-runtime-assets', label: 'Plugin assets' }],
        resolution: {
          key: INSTALL_PLUGIN_ASSETS_ACTION,
          type: 'repair',
          label: 'Install plugin assets',
          actionId: INSTALL_PLUGIN_ASSETS_ACTION,
        },
      },
    })])
  } catch (err) {
    return healthObserved([healthUnknown({
      key: 'runtime-assets',
      summary: 'Plugin assets could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'inspection-failed',
        title: 'Plugin asset status is unknown',
        impact: 'Health cannot confirm whether plugin-provided runtime skills and binaries are current.',
        disposition: 'watch',
        resources: [{ kind: 'asset', id: 'plugin-runtime-assets', label: 'Plugin assets' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })])
  }
}

/** Deterministic repair: reinstall missing/drifted skills and binaries through the ONE component engine. */
export function installPluginAssetsRepair(): HealthRepairActionDefinition {
  return {
    id: INSTALL_PLUGIN_ASSETS_ACTION,
    name: 'Install plugin assets',
    resources: ['install-state'],
    operationPlan: () => PLUGIN_ASSETS_PLAN,
    async plan(target) {
      return [{
        id: INSTALL_PLUGIN_ASSETS_ACTION,
        actionId: INSTALL_PLUGIN_ASSETS_ACTION,
        title: 'Install missing or drifted plugin assets',
        reason: 'Reinstall the runtime skills and sha256-pinned binaries plugins declare, exactly as `bakin install plugin-assets` does. User-edited skills are never overwritten.',
        safety: 'safe',
        ...repairTargetSelection(target),
        changes: [
          { kind: 'runtime', target: 'runtime skill store', action: 'update', description: 'Write plugin-shipped SKILL.md files that are missing or drifted.' },
          { kind: 'file', target: '~/.bakin/bin', action: 'create', description: 'Download and verify plugin-declared binaries that are missing or drifted; record them in ~/.bakin/plugins/lock.json.' },
        ],
      }]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      try {
        const result = await applyPluginAssets(op)
        const failed = result.status === 'failed'
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: failed ? 'failed' as const : 'applied' as const,
          message: result.message,
          affectedCheckIds: [CHECK_ID],
          changes: failed || result.status === 'noop' ? [] : item.changes,
        }))
      } catch (err) {
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: err instanceof Error ? err.message : String(err),
          affectedCheckIds: [CHECK_ID],
          changes: [],
        }))
      }
    },
  }
}
