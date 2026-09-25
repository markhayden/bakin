/**
 * System check — plugin-shipped runtime skills AND declared binaries
 * (spec plugin-managed-binaries S5): surface install state + drift, with a
 * one-click `install-plugin-assets` repair that calls the onboarding
 * component's `install()` — the same engine as `bakin install plugin-assets`.
 */
import { pluginAssetsComponent } from '../../../../src/core/onboarding/plugin-assets'
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
    async apply(items) {
      if (items.length === 0) return []
      try {
        const result = await pluginAssetsComponent.install({ interactive: false, autoApprove: true, json: false, checkOnly: false, force: false })
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
