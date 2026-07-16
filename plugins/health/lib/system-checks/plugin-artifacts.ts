/**
 * System check — installed Whiskit plugin artifacts. Surfaces plugins whose
 * provenance no longer matches this host (needs-update after a Bakin upgrade)
 * or is invalid, so a plugin that startup skipped isn't silently missing. The
 * repair is to reinstall (fetch a compatible published artifact); never
 * auto-fixed.
 */
import { existsSync, readdirSync, type Dirent } from 'fs'
import { join } from 'path'
import { getContentDir } from '../../../../src/core/content-dir'
import { verifyInstalledArtifact } from '../../../../src/core/whiskit/verify'
import { healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthObservationInput } from '@makinbakin/sdk'
import { stableKeyPart } from './key'

export async function checkPluginArtifacts(): Promise<HealthCheckRunInput> {
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
    const verification = verifyInstalledArtifact(join(pluginsDir, name))
    if (verification.status === 'needs-update') {
      observations.push(pluginArtifactWarning(name, 'needs-update', verification.reason))
    } else if (verification.status === 'invalid') {
      observations.push(pluginArtifactWarning(name, 'invalid', verification.reason))
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

function pluginArtifactWarning(name: string, status: 'needs-update' | 'invalid', reason: string) {
  const id = stableKeyPart(name)
  const label = name.slice(0, 120)
  return healthWarning({
    key: `plugin:${id}`,
    summary: status === 'needs-update'
      ? `${label} needs a compatible update.`
      : `${label} has invalid artifact provenance.`,
    detail: reason.slice(0, 4_000),
    evidence: { pluginId: name.slice(0, 500), verificationStatus: status, reason: reason.slice(0, 4_000) },
    incident: {
      key: `${status}:${id}`,
      title: status === 'needs-update' ? 'Plugin artifact needs an update' : 'Plugin artifact failed verification',
      impact: 'The plugin remains inactive until a compatible, verified artifact is installed.',
      disposition: 'action_required',
      resources: [{ kind: 'plugin', id, label }],
      resolution: {
        key: 'upgrade-plugin',
        type: 'instructions',
        label: 'Install a compatible artifact',
        steps: [`Upgrade or reinstall ${label} from its trusted source, then rerun Health.`],
        command: `bakin plugins upgrade ${id}`,
      },
    },
  })
}
