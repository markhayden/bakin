/**
 * System check — installed Whiskit plugin artifacts. Surfaces plugins whose
 * provenance no longer matches this host (needs-update after a Bakin upgrade)
 * or is invalid, so a plugin that startup skipped isn't silently missing.
 *
 * A needs-update plugin whose source has published a release THIS host can
 * run gets the one-click `upgrade-plugin-artifact` repair: its plan previews
 * the upgrade (version, EVERY declared permission and binary) and it is `manual`, so
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

/** One index read per source per window, bounded well inside the check budget; a failure is retried sooner. */
const INDEX_TIMEOUT_MS = 8_000
const INDEX_TTL_MS = 10 * 60_000
const INDEX_FAILURE_TTL_MS = 60_000
const indexCache = new Map<string, { at: number; ttl: number; value: Promise<PublishedVersions> }>()

// The upgrade stack loads lazily: the check runs on every Health pass, the
// network + install machinery only when a plugin is actually stranded.
const defaultDeps: PluginArtifactDeps = {
  publishedVersions: (source) => {
    const hit = indexCache.get(source)
    if (hit && Date.now() - hit.at < hit.ttl) return hit.value
    const value = import('../../../../src/core/plugins/upgrade-artifact')
      .then(({ publishedVersions }) => publishedVersions(source, { timeoutMs: INDEX_TIMEOUT_MS, retries: 0 }))
    const record = { at: Date.now(), ttl: INDEX_TTL_MS, value }
    value.catch(() => { record.ttl = INDEX_FAILURE_TTL_MS })
    indexCache.set(source, record)
    return value
  },
}

/** Tests only. */
export function __clearIndexCacheForTests(): void {
  indexCache.clear()
}

const PROVENANCE_PATH = join('.whiskit', 'build.json')

/** What the plugin's source offers this host: a compatible newer release, none yet, or unknown (fetch failed / not an artifact install). */
type Offer = { kind: 'upgrade'; version: string } | { kind: 'none'; newest: string | null } | { kind: 'unknown' }

async function offerFor(pluginId: string, pluginDir: string, deps: PluginArtifactDeps): Promise<Offer> {
  const entry = readPluginLockfile().plugins[pluginId]
  if (!entry || entry.type !== 'github' || !existsSync(join(pluginDir, PROVENANCE_PATH))) return { kind: 'unknown' }
  try {
    // Only stranded (needs-update) plugins get here, so ANY compatible
    // release is an offer — including a rebuild published under the
    // installed version number for the new contract.
    const published = await deps.publishedVersions(entry.source)
    if (published.compatible) return { kind: 'upgrade', version: published.compatible }
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

  let installed = 0
  const pending: Array<Promise<HealthObservationInput>> = []
  for (const entry of entries) {
    const name = String(entry.name)
    if (!entry.isDirectory() || name.startsWith('.')) continue
    installed += 1
    const pluginDir = join(pluginsDir, name)
    const verification = verifyInstalledArtifact(pluginDir)
    if (verification.status === 'needs-update') {
      // Index reads run concurrently (each bounded), so N stranded plugins
      // cost one read's time, not N — the check budget is shared.
      pending.push(offerFor(name, pluginDir, deps).then((offer) => pluginArtifactWarning(name, 'needs-update', verification.reason, offer)))
    } else if (verification.status === 'invalid') {
      pending.push(Promise.resolve(pluginArtifactWarning(name, 'invalid', verification.reason, { kind: 'unknown' })))
    }
  }
  const observations: HealthObservationInput[] = await Promise.all(pending)

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
    ? { key: UPGRADE_PLUGIN_ARTIFACT_ACTION, type: 'repair' as const, label: `Install ${offer.version} for this Bakin`.slice(0, 120), actionId: UPGRADE_PLUGIN_ARTIFACT_ACTION }
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
  const stranded = (readdirSync(pluginsDir, { withFileTypes: true }) as Dirent[])
    .map((entry) => String(entry.name))
    .filter((name) => !name.startsWith('.') && verifyInstalledArtifact(join(pluginsDir, name)).status === 'needs-update')
  const offers = await Promise.all(stranded.map(async (name) => ({ id: name, offer: await offerFor(name, join(pluginsDir, name), deps) })))
  return offers.flatMap(({ id, offer }) => (offer.kind === 'upgrade' ? [{ id, version: offer.version }] : []))
}

/** Whether a repair target names this plugin's incident or observation (ids end in their keys). */
function targetSelects(target: { type: string; ids?: readonly string[] }, pluginId: string): boolean {
  if (target.type === 'all_actionable') return true
  const id = stableKeyPart(pluginId)
  const suffix = target.type === 'incidents' ? `:needs-update:${id}` : `:plugin:${id}`
  return (target.ids ?? []).some((selected) => selected.endsWith(suffix))
}

interface UpgradeIdentity {
  id: string
  version: string
  manifestSha: string
  /** The published artifact's sha256 — the bytes the approval covers. */
  digest: string
}

function upgradeTarget(id: string, version: string, manifestSha: string, digest: string): string {
  return `plugin:${id}@${version}#${manifestSha}!${digest}`
}

/** The plugin/version/manifest/artifact an approved change names, or null for a permission/bin row. */
function parseUpgradeTarget(target: string): UpgradeIdentity | null {
  const match = /^plugin:([a-z0-9][a-z0-9-]*)@([^#]+)#([0-9a-f]{64})!([0-9a-f]{64})$/.exec(target)
  return match ? { id: match[1]!, version: match[2]!, manifestSha: match[3]!, digest: match[4]! } : null
}

function approvedBins(items: ReadonlyArray<{ changes: ReadonlyArray<{ target: string }> }>, id: string): string[] {
  const prefix = `plugin:${id}:bin:`
  return items.flatMap((item) => item.changes.map((c) => c.target)).filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length)).sort()
}

function sameBins(bins: ReadonlyArray<{ name: string; version: string; sha256: string }>, approved: string[]): boolean {
  const now = bins.map((b) => `${b.name}@${b.version}#${b.sha256}`).sort()
  return now.length === approved.length && now.every((b, i) => b === approved[i])
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
      // One incident's repair upgrades THAT plugin; only "all actionable"
      // bundles every stranded plugin.
      const upgradable = (await upgradablePlugins(deps)).filter((plugin) => targetSelects(target, plugin.id))
      if (upgradable.length === 0) return []
      const { upgradePlugin } = await import('../../../../src/core/plugins/upgrade')
      const changes = []
      for (const plugin of upgradable) {
        try {
          const preview = await upgradePlugin(plugin.id, { previewOnly: true })
          if (preview.noop) continue
          if (!preview.consent) continue
          // Identity lives in the TARGETS: an approval freezes the change set
          // and Apply refuses when a re-plan's targets differ, so the version,
          // full manifest sha, the artifact's sha256 and every binary's sha
          // are what gets approved — a republish under the same version and
          // manifest is a different artifact and never rides an old approval.
          const digest = preview.identity?.digest
          if (!digest) {
            log.warn('Upgrade preview carried no artifact digest; not proposing it', { pluginId: plugin.id })
            continue
          }
          changes.push({
            kind: 'file' as const,
            target: upgradeTarget(plugin.id, preview.after.version, preview.consent.manifestSha, digest),
            action: 'update' as const,
            description: `Upgrade ${plugin.id} ${preview.before.version} → ${preview.after.version} (manifest ${preview.consent.manifestSha.slice(0, 12)}, artifact ${digest.slice(0, 12)}).`,
          })
          for (const permission of preview.declaredPermissions) {
            changes.push({ kind: 'setting' as const, target: `plugin:${plugin.id}:permission:${permission}`, action: 'create' as const, description: `${plugin.id} is granted the "${permission}" permission.` })
          }
          for (const bin of preview.declaredBins) {
            changes.push({ kind: 'file' as const, target: `plugin:${plugin.id}:bin:${bin.name}@${bin.version}#${bin.sha256}`, action: 'create' as const, description: `${plugin.id} installs ${bin.name} ${bin.version} (sha256 ${bin.sha256.slice(0, 12)}) into ~/.bakin/bin.` })
          }
        } catch (err) {
          log.warn('Upgrade preview failed; not proposing it', { pluginId: plugin.id, err: err instanceof Error ? err.message : String(err) })
        }
      }
      if (changes.length === 0) return []
      const ids = [...new Set(changes.map((c) => c.target.split(/[:@]/)[1]))]
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
      const approved = items.flatMap((item) => item.changes.map((c) => parseUpgradeTarget(c.target)).filter((t): t is UpgradeIdentity => t !== null))
      const ids = approved.map((a) => a.id)
      const { upgradePlugin, UpgradeRefusedError } = await import('../../../../src/core/plugins/upgrade')
      const { activateUserPluginDir } = await import('../../../../src/core/plugins/live-lifecycle')
      const upgraded: string[] = []
      const problems: string[] = []
      op.stage('upgrade')
      for (const id of ids) {
        op.item('upgrade', { id, label: id, status: 'active' })
        try {
          const want = approved.find((a) => a.id === id)!
          const preview = await upgradePlugin(id, { previewOnly: true })
          if (preview.noop) {
            op.item('upgrade', { id, label: id, status: 'skipped', message: 'already current' })
            continue
          }
          // Commit ONLY what was approved: same version, same manifest, same
          // artifact bytes, and (through the consent) the same permissions and
          // binaries. The lane holds the commit to the approved identity too.
          if (!preview.consent || preview.after.version !== want.version || preview.consent.manifestSha !== want.manifestSha
            || preview.identity?.digest !== want.digest || !sameBins(preview.declaredBins, approvedBins(items, id))) {
            throw new UpgradeRefusedError(`${id}: the published release changed since it was approved (approved ${want.version}) — rerun Health to review the new change set.`)
          }
          const result = await upgradePlugin(id, { accepted: preview.consent, expected: { version: want.version, digest: want.digest } })
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
        changes: item.changes.filter((change) => upgraded.includes(change.target.split(/[:@]/)[1]!)),
      }))
    },
  }
}
