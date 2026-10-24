/**
 * System check — plugin-shipped runtime skills AND declared binaries
 * (spec plugin-managed-binaries S5): surface install state + drift, with a
 * one-click `install-plugin-assets` repair that calls the onboarding
 * component's `install()` — the same engine as `bakin install plugin-assets`.
 */
import { applyPluginAssets, PLUGIN_ASSETS_PLAN, pluginAssetsComponent } from '../../../../src/core/onboarding/plugin-assets'
import { healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthIncidentDeclaration, HealthRepairActionDefinition, HealthRepairPlanItemInput, HealthResolution, HealthSubject } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'
import { PLUGIN_REINSTALL_ACTION, PLUGIN_UPGRADE_ACTION, pluginRepairResolution, pluginUpgradeOffer, type PluginArtifactDeps } from './plugin-artifacts'

export const INSTALL_PLUGIN_ASSETS_ACTION = 'install-plugin-assets'
const CHECK_ID = 'health.plugin-assets'
const ASSETS_SUBJECT: HealthSubject = { kind: 'system', id: 'plugin-assets', label: 'Plugin assets' }
/**
 * Rows 93–95. A plugin incident lands in the upgrade family when the updates
 * engine offers a release, in the reinstall family otherwise (one family per
 * action). The user-edited row keeps the install repair: its one-click
 * restore item (D) IS the operator's decision, Keep = acknowledge the card.
 */
export const PLUGIN_ASSETS_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'plugin-bins-invalid-upgrade', subjectKind: 'plugin', resolution: { type: 'repair', actionId: PLUGIN_UPGRADE_ACTION }, required: 'always' },
  { id: 'plugin-bins-invalid', subjectKind: 'plugin', resolution: { type: 'repair', actionId: PLUGIN_REINSTALL_ACTION }, required: 'always' },
  { id: 'skill-source-invalid-upgrade', subjectKind: 'plugin', resolution: { type: 'repair', actionId: PLUGIN_UPGRADE_ACTION }, required: 'never' },
  { id: 'skill-source-invalid', subjectKind: 'plugin', resolution: { type: 'repair', actionId: PLUGIN_REINSTALL_ACTION }, required: 'never' },
  { id: 'user-edited-drifted', subjectKind: 'plugin', resolution: { type: 'repair', actionId: INSTALL_PLUGIN_ASSETS_ACTION }, required: 'never' },
  { id: 'assets-out-of-sync', subjectKind: 'system', resolution: { type: 'repair', actionId: INSTALL_PLUGIN_ASSETS_ACTION }, required: 'always' },
]

/** The family a plugin repair resolution belongs to: `<base>-upgrade` when the offered release is the fix. */
function pluginFamily(base: string, resolution: HealthResolution): string {
  return resolution.type === 'repair' && resolution.actionId === PLUGIN_UPGRADE_ACTION ? `${base}-upgrade` : base
}

/** The repair for the plugins an incident names: the offered upgrade, else the reinstall (rows 93–94). */
async function pluginRepair(pluginIds: string[], deps?: PluginArtifactDeps) {
  const unique = [...new Set(pluginIds)]
  return pluginRepairResolution(await Promise.all(unique.map(async (pluginId) => ({ pluginId, offer: await pluginUpgradeOffer(pluginId, deps) }))))
}

export async function checkPluginAssets(deps?: PluginArtifactDeps): Promise<HealthCheckRunInput> {
  try {
    const result = await pluginAssetsComponent.check()
    if (result.status === 'error') {
      // Discovery failed (unreadable ledger): the state is UNKNOWN — never a
      // clean bill, never an "install assets" repair over a broken ledger.
      return healthObserved([healthUnknown({
        key: 'runtime-assets',
        summary: result.message,
        detail: result.remediation,
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
    const scan = result.details as { missing?: unknown[]; drifted?: unknown[]; userEditedDrifted?: SkillRef[]; invalidSource?: SkillRef[]; bins?: { missing?: unknown[]; drifted?: unknown[]; unsupported?: unknown[]; invalid?: Array<{ pluginId: string; reason: string }> } } | undefined
    const repairable = (scan?.missing?.length ?? 0) + (scan?.drifted?.length ?? 0)
      + (scan?.bins?.missing?.length ?? 0) + (scan?.bins?.drifted?.length ?? 0) + (scan?.bins?.unsupported?.length ?? 0)
    const locked = scan?.userEditedDrifted ?? []
    const invalid = scan?.invalidSource ?? []
    const invalidBins = scan?.bins?.invalid ?? []
    if (repairable === 0 && invalidBins.length > 0) {
      // The plugin's declaration is the problem — the install repair has
      // nothing it could verify against, so it is not offered (#898 D); the
      // plugin itself is upgraded when a release is offered, else reinstalled.
      const resolution = await pluginRepair(invalidBins.map((row) => row.pluginId), deps)
      return healthObserved([healthWarning({
        key: 'runtime-assets',
        summary: result.message,
        detail: result.remediation,
        evidence: { inSync: false, ...(result.details ?? {}) },
        incident: {
          key: 'plugin-bins-invalid',
          title: 'A plugin declares binaries Bakin cannot verify',
          impact: 'Bakin will not install or trust these plugin binaries until the plugin ships a declaration that pins each binary it runs.',
          disposition: 'action_required',
          subject: { kind: 'plugin', id: invalidBins[0]!.pluginId, label: invalidBins[0]!.pluginId },
          declarationId: pluginFamily('plugin-bins-invalid', resolution),
          resources: [...new Set(invalidBins.map((row) => row.pluginId))].map((id) => ({ kind: 'plugin' as const, id, label: id })),
          resolution,
        },
      })])
    }
    if (repairable === 0 && (locked.length > 0 || invalid.length > 0)) {
      // Nothing the repair can fix — the user locked these skills, or the
      // plugin ships one that is not text — so offering it would be a
      // button that does nothing (#898).
      const skillResource = (ref: SkillRef) => ({ kind: 'asset' as const, id: `skill:${ref.name}`, label: `${ref.name} (${ref.pluginId})` })
      // A skill that is not text is the plugin's to fix: reinstall (or the
      // offered upgrade). A user-edited skill is the operator's decision —
      // its Keep/Restore control lands in 1.4, so the text stays until then.
      // Keep = acknowledge the incident; Restore = the install repair's per-skill manual item (row 94).
      const resolution = locked.length > 0
        ? { key: INSTALL_PLUGIN_ASSETS_ACTION, type: 'repair' as const, label: 'Restore the shipped copies', actionId: INSTALL_PLUGIN_ASSETS_ACTION }
        : await pluginRepair(invalid.map((ref) => ref.pluginId), deps)
      return healthObserved([healthWarning({
        key: 'runtime-assets',
        summary: result.message,
        detail: result.remediation,
        evidence: { inSync: false, ...(result.details ?? {}) },
        incident: {
          key: locked.length > 0 ? 'user-edited-drifted' : 'skill-source-invalid',
          declarationId: locked.length > 0 ? 'user-edited-drifted' : pluginFamily('skill-source-invalid', resolution),
          subject: { kind: 'plugin', id: (locked[0] ?? invalid[0])!.pluginId, label: (locked[0] ?? invalid[0])!.pluginId },
          title: locked.length > 0 ? 'User-edited plugin skills differ from the plugin' : 'A plugin ships a skill Bakin cannot install',
          impact: [
            locked.length > 0 ? 'Agents run your edited copy, not the version the plugin ships. Bakin will not overwrite a skill you locked.' : null,
            invalid.length > 0 ? 'Skills whose files are not text are never installed, so agents cannot use them.' : null,
          ].filter(Boolean).join(' '),
          disposition: 'watch',
          resources: [
            ...[...locked, ...invalid].map(skillResource),
            ...(locked.length === 0 ? [...new Set(invalid.map((ref) => ref.pluginId))].map((id) => ({ kind: 'plugin' as const, id, label: id })) : []),
          ],
          resolution,
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
        subject: ASSETS_SUBJECT,
        declarationId: 'assets-out-of-sync',
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
    })])
  }
}

/** Deterministic repair: reinstall missing/drifted skills and binaries through the ONE component engine. */
export function installPluginAssetsRepair(): HealthRepairActionDefinition {
  return {
    id: INSTALL_PLUGIN_ASSETS_ACTION,
    name: 'Install plugin assets',
    // Re-projects what installed plugins already declare (sha256-pinned
    // binaries, their own skills): self-heal. The per-skill restore item
    // below replaces a user's edit, so it stamps D and waits for the click.
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false },
    mutation: 'rebuild', // re-materializes sha256-pinned content the plugin already declared — nothing new to authorize
    resources: ['install-state'],
    operationPlan: () => PLUGIN_ASSETS_PLAN,
    async plan(target) {
      // One manual item per user-edited skill whose content drifted from the plugin's — ONLY
      // when the operator targeted that row; "all actionable" never offers to replace an edit.
      const restoreItems: HealthRepairPlanItemInput[] = []
      if (target.type !== 'all_actionable') {
        let drifted: Array<{ pluginId: string; name: string }> = []
        try {
          const scan = (await pluginAssetsComponent.check()).details as { userEditedDrifted?: Array<{ pluginId: string; name: string }> } | undefined
          drifted = scan?.userEditedDrifted ?? []
        } catch {
          drifted = []
        }
        for (const ref of drifted) {
          restoreItems.push({
            id: `restore:${ref.name}`,
            actionId: INSTALL_PLUGIN_ASSETS_ACTION,
            title: `Restore the shipped copy of ${ref.name}`,
            reason: `Your edited copy of ${ref.name} differs from what ${ref.pluginId} ships. Keeping it is fine (acknowledge the incident); restoring replaces your edit.`,
            effects: { deletesUserContent: true, spendsMoney: false, widensAuthorization: false },
            ...repairTargetSelection(target),
            changes: [{ kind: 'runtime', target: `skill:${ref.name}`, action: 'update', description: `Replace your edited ${ref.name} with the copy ${ref.pluginId} ships (the .userEdited lock is released).` }],
          })
        }
      }
      return [{
        id: INSTALL_PLUGIN_ASSETS_ACTION,
        actionId: INSTALL_PLUGIN_ASSETS_ACTION,
        title: 'Install missing or drifted plugin assets',
        reason: 'Reinstall the runtime skills and sha256-pinned binaries plugins declare, exactly as `bakin install plugin-assets` does. User-edited skills are never overwritten.',
        ...repairTargetSelection(target),
        changes: [
          { kind: 'runtime', target: 'runtime skill store', action: 'update', description: 'Write plugin-shipped SKILL.md files that are missing or drifted.' },
          { kind: 'file', target: '~/.bakin/bin', action: 'create', description: 'Download and verify plugin-declared binaries that are missing or drifted; record them in ~/.bakin/plugins/lock.json.' },
        ],
      }, ...restoreItems]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      try {
        const restoreUserEdited = items.filter((item) => item.localId.startsWith('restore:')).map((item) => item.localId.slice('restore:'.length))
        const result = await applyPluginAssets(op, restoreUserEdited.length > 0 ? { restoreUserEdited } : {})
        const failed = result.status === 'failed'
        const restored = new Set(result.restored ?? [])
        const restoreName = (item: { localId: string }) => item.localId.slice('restore:'.length)
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: failed ? 'failed' as const : item.localId.startsWith('restore:') ? (restored.has(restoreName(item)) ? 'applied' as const : 'skipped' as const) : 'applied' as const,
          message: item.localId.startsWith('restore:')
            ? (restored.has(restoreName(item)) ? `${restoreName(item)} restored to the plugin's copy.` : `${restoreName(item)} was not locked any more; nothing to restore.`)
            : result.message,
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
