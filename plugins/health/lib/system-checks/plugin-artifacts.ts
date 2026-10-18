/**
 * System check — installed Whiskit plugin artifacts. Surfaces plugins whose
 * provenance no longer matches this host (needs-update after a Bakin upgrade)
 * or is invalid, so a plugin that startup skipped isn't silently missing.
 *
 * A needs-update plugin whose source has published a release THIS host can
 * run gets the one-click `upgrade-plugin-artifact` repair: its plan previews
 * the upgrade (version, new permissions, new binaries) and it is `manual`, so
 * escalation asks for approval with exactly that change set — approving it is
 * the consent. With no compatible release yet, the incident says so plainly
 * instead of pointing at an upgrade that would refuse.
 */
import { existsSync, readdirSync, type Dirent } from 'fs'
import { join } from 'path'
import { getContentDir } from '../../../../src/core/content-dir'
import { verifyInstalledArtifact } from '../../../../src/core/whiskit/verify'
import { healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthObservationInput, HealthRepairActionDefinition, HealthResolution } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'
import { readPluginLockfile } from '@bakin/core/plugins/lockfile'
import { createLogger } from '../../../../src/core/logger'
import type { PublishedVersions } from '../../../../src/core/plugins/upgrade-artifact'
import { stableKeyPart } from './key'

const log = createLogger('health:plugin-artifacts')

export const UPGRADE_PLUGIN_ARTIFACT_ACTION = 'upgrade-plugin-artifact'
const CHECK_ID = 'health.plugin-artifacts'

export interface PluginArtifactDeps {
  publishedVersions: (source: string) => Promise<PublishedVersions>
}

// The upgrade stack loads lazily: the check runs on every Health pass, the
// network + install machinery only when a plugin is actually stranded.
const defaultDeps: PluginArtifactDeps = {
  publishedVersions: async (source) => (await import('../../../../src/core/plugins/upgrade-artifact')).publishedVersions(source),
}

const PROVENANCE_PATH = join('.whiskit', 'build.json')

/** What the plugin's source offers this host: a compatible newer release, none yet, or unknown (fetch failed / not an artifact install). */
type Offer = { kind: 'upgrade'; version: string } | { kind: 'none'; newest: string | null } | { kind: 'unknown' }

async function offerFor(pluginId: string, pluginDir: string, deps: PluginArtifactDeps): Promise<Offer> {
  const entry = readPluginLockfile().plugins[pluginId]
  if (!entry || entry.type !== 'github' || !existsSync(join(pluginDir, PROVENANCE_PATH))) return { kind: 'unknown' }
  try {
    const published = await deps.publishedVersions(entry.source)
    if (published.compatible && published.compatible !== entry.version) return { kind: 'upgrade', version: published.compatible }
    return { kind: 'none', newest: published.latest }
  } catch (err) {
    log.warn('Could not read the plugin source index', { pluginId, err: err instanceof Error ? err.message : String(err) })
    return { kind: 'unknown' }
  }
}

export async function checkPluginArtifacts(deps: PluginArtifactDeps = defaultDeps): Promise<HealthCheckRunInput> {
  const pluginsDir = join(getContentDir(), 'plugins')
  if (!existsSync(pluginsDir)) {
    return healthObserved([healthHealthy({
      key: 'installed',
      summary: 'No user-installed plugin artifacts are present.',
      evidence: { installed: 0 },
    })])
  }

  let entries: Dirent[]
  try {
    entries = readdirSync(pluginsDir, { withFileTypes: true }) as Dirent[]
  } catch (err) {
    return healthObserved([healthUnknown({
      key: 'installed',
      summary: 'Installed plugin artifacts could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'directory-unreadable',
        title: 'Installed plugin directory is unreadable',
        impact: 'Health cannot confirm whether installed plugin artifacts are compatible with this host.',
        disposition: 'watch',
        resources: [{ kind: 'directory', id: 'installed-plugins', label: pluginsDir }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })])
  }

  const observations: HealthObservationInput[] = []
  let installed = 0
  for (const entry of entries) {
    const name = String(entry.name)
    if (!entry.isDirectory() || name.startsWith('.')) continue
    installed += 1
    const pluginDir = join(pluginsDir, name)
    const verification = verifyInstalledArtifact(pluginDir)
    if (verification.status === 'needs-update') {
      observations.push(pluginArtifactWarning(name, 'needs-update', verification.reason, await offerFor(name, pluginDir, deps)))
    } else if (verification.status === 'invalid') {
      observations.push(pluginArtifactWarning(name, 'invalid', verification.reason, { kind: 'unknown' }))
    }
  }

  if (observations.length === 0) {
    return healthObserved([healthHealthy({
      key: 'installed',
      summary: installed === 0
        ? 'No user-installed plugin artifacts are present.'
        : 'All installed plugin artifacts are compatible.',
      evidence: { installed },
    })])
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

function pluginArtifactWarning(name: string, status: 'needs-update' | 'invalid', reason: string, offer: Offer) {
  const id = stableKeyPart(name)
  const label = name.slice(0, 120)
  const resolution: HealthResolution = status === 'needs-update' && offer.kind === 'upgrade'
    ? { key: UPGRADE_PLUGIN_ARTIFACT_ACTION, type: 'repair' as const, label: `Upgrade to ${offer.version}`.slice(0, 120), actionId: UPGRADE_PLUGIN_ARTIFACT_ACTION }
    : status === 'needs-update' && offer.kind === 'none'
      ? {
          key: 'await-compatible-release',
          type: 'instructions' as const,
          label: 'Wait for a compatible release',
          steps: [
            `No published release of ${label} runs on this Bakin yet${offer.newest ? ` (newest is ${offer.newest})` : ''}. Its author has to publish one; Health offers the upgrade as soon as it exists.`,
          ],
        }
      : {
          key: 'upgrade-plugin',
          type: 'instructions' as const,
          label: 'Install a compatible artifact',
          steps: [`Upgrade or reinstall ${label} from its trusted source, then rerun Health.`],
          command: `bakin plugins upgrade ${id}`,
        }
  return healthWarning({
    key: `plugin:${id}`,
    summary: status === 'needs-update'
      ? `${label} needs a compatible update.`
      : `${label} has invalid artifact provenance.`,
    detail: reason.slice(0, 4_000),
    evidence: {
      pluginId: name.slice(0, 500),
      verificationStatus: status,
      reason: reason.slice(0, 4_000),
      ...(offer.kind === 'upgrade' ? { compatibleVersion: offer.version } : {}),
    },
    incident: {
      key: `${status}:${id}`,
      title: status === 'needs-update' ? 'Plugin artifact needs an update' : 'Plugin artifact failed verification',
      impact: 'The plugin remains inactive until a compatible, verified artifact is installed.',
      disposition: 'action_required',
      resources: [{ kind: 'plugin', id, label }],
      resolution,
    },
  })
}

/** Installed plugins that need an update AND have a release this host can run. */
async function upgradablePlugins(deps: PluginArtifactDeps): Promise<Array<{ id: string; version: string }>> {
  const pluginsDir = join(getContentDir(), 'plugins')
  if (!existsSync(pluginsDir)) return []
  const out: Array<{ id: string; version: string }> = []
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true }) as Dirent[]) {
    const name = String(entry.name)
    if (!entry.isDirectory() || name.startsWith('.')) continue
    const pluginDir = join(pluginsDir, name)
    if (verifyInstalledArtifact(pluginDir).status !== 'needs-update') continue
    const offer = await offerFor(name, pluginDir, deps)
    if (offer.kind === 'upgrade') out.push({ id: name, version: offer.version })
  }
  return out
}

/**
 * One-click upgrade of stranded plugins to the newest release this host can
 * run. `plan()` PREVIEWS each upgrade so the change set names the target
 * version, its manifest and every new permission or binary; `manual` safety
 * routes it through an approval showing exactly that, and `apply()` previews
 * again and commits with that consent (a changed manifest re-plans).
 */
export function upgradePluginArtifactRepair(deps: PluginArtifactDeps = defaultDeps): HealthRepairActionDefinition {
  return {
    id: UPGRADE_PLUGIN_ARTIFACT_ACTION,
    name: 'Upgrade plugins to a compatible release',
    resources: ['install-state'],
    operationPlan: () => ({
      stages: [
        { id: 'upgrade', kind: 'committing', label: 'Upgrade the plugins' },
        { id: 'activate', kind: 'verifying', label: 'Activate them' },
      ],
      pointOfNoReturn: 'upgrade',
    }),
    async plan(target) {
      const upgradable = await upgradablePlugins(deps)
      if (upgradable.length === 0) return []
      const { upgradePlugin } = await import('../../../../src/core/plugins/upgrade')
      const changes = []
      for (const plugin of upgradable) {
        try {
          const preview = await upgradePlugin(plugin.id, { previewOnly: true })
          if (preview.noop) continue
          changes.push({
            kind: 'file' as const,
            target: `plugin:${plugin.id}`,
            action: 'update' as const,
            description: `Upgrade ${plugin.id} ${preview.before.version} → ${preview.after.version} (manifest ${preview.consent?.manifestSha.slice(0, 12) ?? 'unknown'}).`,
          })
          for (const permission of preview.newPermissions) {
            changes.push({ kind: 'setting' as const, target: `plugin:${plugin.id}:permission:${permission}`, action: 'create' as const, description: `${plugin.id} gains the "${permission}" permission.` })
          }
          for (const bin of preview.newBins) {
            changes.push({ kind: 'file' as const, target: `plugin:${plugin.id}:bin:${bin.name}`, action: 'create' as const, description: `${plugin.id} installs ${bin.name} ${bin.version} (sha256 ${bin.sha256.slice(0, 12)}) into ~/.bakin/bin.` })
          }
        } catch (err) {
          log.warn('Upgrade preview failed; not proposing it', { pluginId: plugin.id, err: err instanceof Error ? err.message : String(err) })
        }
      }
      if (changes.length === 0) return []
      const ids = [...new Set(changes.map((c) => c.target.split(':')[1]))]
      return [{
        id: UPGRADE_PLUGIN_ARTIFACT_ACTION,
        actionId: UPGRADE_PLUGIN_ARTIFACT_ACTION,
        title: `Upgrade ${ids.join(', ')} to a release this Bakin can run`,
        reason: 'A Bakin upgrade left these plugins on an artifact built for a different host contract; their sources have published compatible releases.',
        safety: 'manual',
        ...repairTargetSelection(target),
        changes,
      }]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      const ids = [...new Set(items.flatMap((item) => item.changes.map((c) => c.target.split(':')[1]!)))]
      const { upgradePlugin, UpgradeRefusedError } = await import('../../../../src/core/plugins/upgrade')
      const { activateUserPluginDir } = await import('../../../../src/core/plugins/live-lifecycle')
      const upgraded: string[] = []
      const problems: string[] = []
      op.stage('upgrade')
      for (const id of ids) {
        op.item('upgrade', { id, label: id, status: 'active' })
        try {
          const preview = await upgradePlugin(id, { previewOnly: true })
          if (preview.noop) {
            op.item('upgrade', { id, label: id, status: 'skipped', message: 'already current' })
            continue
          }
          const result = await upgradePlugin(id, { accepted: preview.consent })
          if (result.awaitingConsent) throw new UpgradeRefusedError(`${id}: its manifest changed since the preview — rerun Health to review the new change set.`)
          upgraded.push(id)
          op.item('upgrade', { id, label: `${id} → ${result.after.version}`, status: 'done' })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          problems.push(message)
          op.item('upgrade', { id, label: id, status: 'failed', message })
        }
      }
      op.stage('activate')
      for (const id of upgraded) {
        try {
          await activateUserPluginDir(join(getContentDir(), 'plugins', id))
          op.item('activate', { id, label: id, status: 'done' })
        } catch (err) {
          const message = `Upgraded ${id} but could not activate it: ${err instanceof Error ? err.message : String(err)}`
          problems.push(message)
          op.item('activate', { id, label: id, status: 'failed', message })
        }
      }
      const message = [
        upgraded.length > 0 ? `Upgraded ${upgraded.join(', ')}.` : 'Nothing upgraded.',
        ...problems,
      ].join(' ')
      return items.map((item) => ({
        itemId: item.id,
        actionId: item.actionId,
        status: problems.length > 0 ? 'failed' as const : upgraded.length > 0 ? 'applied' as const : 'skipped' as const,
        message,
        affectedCheckIds: [CHECK_ID],
        changes: item.changes.filter((change) => upgraded.includes(change.target.split(':')[1]!)),
      }))
    },
  }
}
