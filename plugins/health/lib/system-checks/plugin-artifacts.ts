/**
 * System check — installed Whiskit plugin artifacts — and the two
 * plugin-family repair actions every plugin incident points at
 * (self-healing PR1 slice 1.3b; re-homing rows 93–101).
 *
 * The check surfaces plugins whose provenance no longer matches this host
 * (needs-update after a Bakin upgrade) or is invalid, so a plugin that
 * startup skipped isn't silently missing.
 *
 * - `plugin-upgrade` (renamed from `upgrade-plugin-artifact`) installs the
 *   release the updates engine OBSERVED for the plugin (#1007; the `plugin:<id>`
 *   record, never an index). Its plan previews the upgrade (version, EVERY
 *   declared permission and binary) and it is `manual` until PR6, so
 *   escalation asks for approval with exactly that change set — approving it
 *   is the consent.
 * - `plugin-reinstall` re-stages the RECORDED install (`upgradePlugin(reinstall)`):
 *   the fallback when nothing newer is offered and the install itself is the
 *   problem — invalid provenance, a binary declaration Bakin cannot verify,
 *   a skill that is not text.
 *
 * `pluginUpgradeOffer` is the ONE answer plugin-assets and plugin-registry
 * use to choose between the two.
 */
import { existsSync, readdirSync, type Dirent } from 'fs'
import { join } from 'path'
import type { UpdateRecord } from '@makinbakin/sdk/types'
import { getContentDir } from '../../../../src/core/content-dir'
import { verifyInstalledArtifact } from '../../../../src/core/whiskit/verify'
import { healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthIncidentDeclaration, HealthObservationInput, HealthRepairActionDefinition, HealthRepairApplyResult, HealthRepairChange, HealthRepairPlanItem, HealthRepairPlanItemInput, HealthRepairTarget, HealthResolution, OperationContext } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'
import { isLinked, readPluginLockfile } from '@bakin/core/plugins/lockfile'
import { createLogger } from '../../../../src/core/logger'
import { getUpdatesEngine } from '../../../../src/core/updates/service'
import { stableKeyPart } from './key'

const log = createLogger('health:plugin-artifacts')

export const PLUGIN_UPGRADE_ACTION = 'plugin-upgrade'
export const PLUGIN_REINSTALL_ACTION = 'plugin-reinstall'
const CHECK_ID = 'health.plugin-artifacts'
/**
 * Rows 96–99: a stranded plugin with an offered release upgrades (97); one
 * with no compatible release yet is upstream-blocked — the operator decides
 * (98; the containment control lands in PR6, so the decision lives on the
 * Updates tab); an unknown offer or invalid provenance reinstalls (99); an
 * unreadable directory is an observation (96).
 */
export const PLUGIN_ARTIFACTS_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'needs-update', subjectKind: 'plugin', resolution: { type: 'repair', actionId: PLUGIN_UPGRADE_ACTION }, required: 'always' },
  { id: 'needs-update-blocked', subjectKind: 'plugin', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
  { id: 'needs-update-reinstall', subjectKind: 'plugin', resolution: { type: 'repair', actionId: PLUGIN_REINSTALL_ACTION }, required: 'always' },
  { id: 'invalid', subjectKind: 'plugin', resolution: { type: 'repair', actionId: PLUGIN_REINSTALL_ACTION }, required: 'always' },
  { id: 'invalid-upgrade', subjectKind: 'plugin', resolution: { type: 'repair', actionId: PLUGIN_UPGRADE_ACTION }, required: 'always' },
]
/** Every check whose incidents point at the plugin repairs — a reinstall can resolve any of them. */
const PLUGIN_CHECK_IDS = [CHECK_ID, 'health.plugin-assets', 'health.plugin-registry']

export interface PluginArtifactDeps {
  /** The updates engine's record for `plugin:<id>` — the check never probes an index itself (#1007). */
  record: (pluginId: string) => Promise<UpdateRecord | undefined>
}

const defaultDeps: PluginArtifactDeps = {
  record: async (pluginId) => {
    const engine = getUpdatesEngine()
    if (!engine) return undefined
    const id = `plugin:${pluginId}`
    return (await engine.snapshot()).records.find((record) => record.id === id)
  },
}

/**
 * What the plugin's source offers this host, as the updates engine observed
 * it: a compatible release (an `update-available` record — for a stranded
 * plugin ANY compatible release is an offer, a rebuild under the installed
 * version number included, D7 `compatible-rebuild`), none yet (`blocked`,
 * with the engine's reason), or unknown (no record, no successful
 * observation, not an installed plugin, a linked dev plugin). `observedAt`
 * is the record's last successful observation; `error` its last failed attempt.
 */
export type PluginUpgradeOffer =
  | { kind: 'upgrade'; version: string; observedAt?: string; error?: string }
  | { kind: 'none'; reason: string; observedAt?: string; error?: string }
  | { kind: 'unknown'; observedAt?: string; error?: string }

export async function pluginUpgradeOffer(pluginId: string, deps: PluginArtifactDeps = defaultDeps): Promise<PluginUpgradeOffer> {
  let entry
  try {
    entry = readPluginLockfile().plugins[pluginId]
  } catch (err) {
    log.warn('Could not read the plugin lockfile for the upgrade offer', { pluginId, err: err instanceof Error ? err.message : String(err) })
    return { kind: 'unknown' }
  }
  // A linked plugin is edited in place, never upgraded or reinstalled by Bakin.
  if (!entry || isLinked(entry)) return { kind: 'unknown' }
  let record: UpdateRecord | undefined
  try {
    record = await deps.record(pluginId)
  } catch (err) {
    log.warn('Could not read the plugin update record', { pluginId, err: err instanceof Error ? err.message : String(err) })
    return { kind: 'unknown' }
  }
  if (!record) return { kind: 'unknown' }
  // The two clocks ride along: a retained observation AND the last attempt's failure, never one hiding the other.
  const clocks = { observedAt: record.observedAt, error: record.attempt?.error }
  if (record.outcome === 'update-available' && record.available?.version) return { kind: 'upgrade', version: record.available.version, ...clocks }
  if (record.outcome === 'blocked') return { kind: 'none', reason: record.blockedReason ?? 'no published release runs on this Bakin yet', ...clocks }
  return { kind: 'unknown', ...clocks }
}

/**
 * The repair a plugin incident points at: the offered upgrade when the
 * engine has one for EVERY named plugin, the reinstall of the recorded
 * install otherwise (rows 93, 99, 101).
 */
export function pluginRepairResolution(offers: ReadonlyArray<{ pluginId: string; offer: PluginUpgradeOffer }>): HealthResolution {
  const names = offers.map((row) => row.pluginId)
  const subject = names.length === 1 ? names[0]! : `${names.length} plugins`
  const upgrades = offers.flatMap((row) => (row.offer.kind === 'upgrade' ? [row.offer.version] : []))
  if (offers.length > 0 && upgrades.length === offers.length) {
    const label = names.length === 1 ? `Upgrade ${subject} to ${upgrades[0]}` : `Upgrade ${subject}`
    return { key: PLUGIN_UPGRADE_ACTION, type: 'repair', label: label.slice(0, 120), actionId: PLUGIN_UPGRADE_ACTION }
  }
  return { key: PLUGIN_REINSTALL_ACTION, type: 'repair', label: `Reinstall ${subject}`.slice(0, 120), actionId: PLUGIN_REINSTALL_ACTION }
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
      detail: `${err instanceof Error ? err.message : String(err)} (${pluginsDir})`,
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
    if (verification.status === 'needs-update' || verification.status === 'invalid') {
      const status = verification.status
      pending.push(pluginUpgradeOffer(name, deps).then((offer) => pluginArtifactWarning(name, status, verification.reason, offer)))
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

function pluginArtifactWarning(name: string, status: 'needs-update' | 'invalid', reason: string, offer: PluginUpgradeOffer) {
  const id = stableKeyPart(name)
  const label = name.slice(0, 120)
  // A stranded plugin with no compatible release yet is upstream-blocked: the
  // operator decides (wait, or disable it) instead of a reinstall that would
  // refuse (row 98 — a human row).
  const blocked = status === 'needs-update' && offer.kind === 'none'
  const resolution: HealthResolution = status === 'needs-update' && offer.kind === 'upgrade'
    ? { key: PLUGIN_UPGRADE_ACTION, type: 'repair', label: `Install ${offer.version} for this Bakin`.slice(0, 120), actionId: PLUGIN_UPGRADE_ACTION }
    : blocked
      ? { key: 'await-compatible-release', type: 'human', needs: 'decision', label: 'Wait for a compatible release, or disable the plugin', href: '/health?tab=updates' }
      : pluginRepairResolution([{ pluginId: id, offer }])
  const declarationId = status === 'needs-update'
    ? (offer.kind === 'upgrade' ? 'needs-update' : blocked ? 'needs-update-blocked' : 'needs-update-reinstall')
    : (resolution.type === 'repair' && resolution.actionId === PLUGIN_UPGRADE_ACTION ? 'invalid-upgrade' : 'invalid')
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
      updateObservedAt: offer.observedAt ?? null,
      ...(offer.error ? { updateCheckError: offer.error.slice(0, 1_000) } : {}),
    },
    incident: {
      key: `${status}:${id}`,
      title: status === 'needs-update' ? 'Plugin artifact needs an update' : 'Plugin artifact failed verification',
      impact: blocked
        ? `The plugin remains inactive until a compatible, verified artifact is installed. ${offer.kind === 'none' ? `${offer.reason.charAt(0).toUpperCase()}${offer.reason.slice(1)}. ` : ''}Its author has to publish one; Health offers the upgrade as soon as the updates engine observes it.`
        : 'The plugin remains inactive until a compatible, verified artifact is installed.',
      disposition: 'action_required',
      subject: { kind: 'plugin', id, label },
      declarationId,
      // An installed artifact is presumed enabled and referenced (row 98 "AR while enabled and referenced").
      ...(blocked ? { required: true } : {}),
      resources: [{ kind: 'plugin', id, label }],
      resolution,
    },
  })
}

/** Installed plugins that need an update AND have a release this host can run. */
async function strandedWithOffer(deps: PluginArtifactDeps): Promise<string[]> {
  const pluginsDir = join(getContentDir(), 'plugins')
  if (!existsSync(pluginsDir)) return []
  const stranded = (readdirSync(pluginsDir, { withFileTypes: true }) as Dirent[])
    .map((entry) => String(entry.name))
    .filter((name) => !name.startsWith('.') && verifyInstalledArtifact(join(pluginsDir, name)).status === 'needs-update')
  const offers = await Promise.all(stranded.map(async (name) => ({ id: name, offer: await pluginUpgradeOffer(name, deps) })))
  return offers.flatMap(({ id, offer }) => (offer.kind === 'upgrade' ? [id] : []))
}

/** The plugin a check's incident or observation key names, when the key carries it. */
function pluginIdFromKey(id: string): string | null {
  const match = /:(?:needs-update|invalid|activation-failed|plugin):([a-z0-9][a-z0-9-]*)$/.exec(id)
  return match ? match[1]! : null
}

/**
 * The plugins a repair target names. Incident and observation ids resolve
 * through the cached Health report to the incidents' `plugin` resources
 * (the plugin-assets incidents carry the plugin only there); an id the
 * report does not know falls back to the key's own suffix. `all_actionable`
 * is every action-required incident pointing at this action.
 */
async function pluginsNamedBy(target: HealthRepairTarget, actionId: string): Promise<string[]> {
  const named = new Set<string>()
  type Incident = { id: string; effectiveDisposition: string; resources: ReadonlyArray<{ kind: string; id: string }>; resolution: { type: string; actionId?: string }; observationIds: readonly string[] }
  let incidents: readonly Incident[] = []
  try {
    const { getHealthReport } = await import('../../../../src/core/doctor-report-cache')
    incidents = getHealthReport().incidents
  } catch (err) {
    log.warn('Health report unavailable while resolving the repair target; using the target ids alone', { err: err instanceof Error ? err.message : String(err) })
  }
  const addPlugins = (incident: Incident) => {
    for (const resource of incident.resources) if (resource.kind === 'plugin') named.add(resource.id)
  }
  if (target.type === 'all_actionable') {
    for (const incident of incidents) {
      if (incident.effectiveDisposition === 'action_required' && incident.resolution.type === 'repair' && incident.resolution.actionId === actionId) addPlugins(incident)
    }
    return [...named]
  }
  for (const id of target.ids) {
    const matches = target.type === 'incidents'
      ? incidents.filter((incident) => incident.id === id)
      : incidents.filter((incident) => incident.observationIds.includes(id))
    if (matches.length > 0) {
      matches.forEach(addPlugins)
      continue
    }
    const parsed = pluginIdFromKey(id)
    if (parsed) named.add(parsed)
  }
  return [...named]
}

/** What an approval freezes: the plugin, its version, the full manifest sha and the bytes (artifact digest or git commit). */
interface ApprovedIdentity {
  id: string
  version: string
  manifestSha: string
  /** The published artifact's sha256 (64 hex) or the git commit (40 hex). */
  bytes: string
}

function identityTarget(id: string, version: string, manifestSha: string, bytes: string): string {
  return `plugin:${id}@${version}#${manifestSha}!${bytes}`
}

/** The identity an approved change names, or null for a permission/bin row. */
function parseIdentityTarget(target: string): ApprovedIdentity | null {
  const match = /^plugin:([a-z0-9][a-z0-9-]*)@([^#]+)#([0-9a-f]{64})!([0-9a-f]{64}|[0-9a-f]{40})$/.exec(target)
  return match ? { id: match[1]!, version: match[2]!, manifestSha: match[3]!, bytes: match[4]! } : null
}

function expectedFor(identity: ApprovedIdentity): { version: string; digest?: string; sha?: string } {
  return identity.bytes.length === 64 ? { version: identity.version, digest: identity.bytes } : { version: identity.version, sha: identity.bytes }
}

function approvedBins(items: ReadonlyArray<{ changes: ReadonlyArray<{ target: string }> }>, id: string): string[] {
  const prefix = `plugin:${id}:bin:`
  return items.flatMap((item) => item.changes.map((c) => c.target)).filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length)).sort()
}

function sameBins(bins: ReadonlyArray<{ name: string; version: string; sha256: string }>, approved: string[]): boolean {
  const now = bins.map((b) => `${b.name}@${b.version}#${b.sha256}`).sort()
  return now.length === approved.length && now.every((b, i) => b === approved[i])
}

type UpgradeModule = typeof import('../../../../src/core/plugins/upgrade')
type Preview = Awaited<ReturnType<UpgradeModule['upgradePlugin']>>

/**
 * The change set a preview names. Identity lives in the TARGETS: an approval
 * freezes the change set and Apply refuses when a re-plan's targets differ,
 * so the version, full manifest sha, the bytes (artifact sha256 or commit)
 * and every binary's sha are what gets approved — a republish under the same
 * version and manifest is a different artifact and never rides an old approval.
 */
function previewChanges(id: string, preview: Preview, reinstall: boolean): HealthRepairChange[] | null {
  if (preview.noop || !preview.consent) return null
  const bytes = preview.identity?.digest ?? preview.identity?.sha
  if (!bytes) {
    log.warn('Preview carried no artifact digest or commit; not proposing it', { pluginId: id })
    return null
  }
  const what = preview.identity?.digest ? 'artifact' : 'commit'
  const changes: HealthRepairChange[] = [{
    kind: 'file',
    target: identityTarget(id, preview.after.version, preview.consent.manifestSha, bytes),
    action: 'update',
    description: reinstall
      ? `Reinstall ${id} ${preview.after.version} from its recorded source (manifest ${preview.consent.manifestSha.slice(0, 12)}, ${what} ${bytes.slice(0, 12)}).`
      : `Upgrade ${id} ${preview.before.version} → ${preview.after.version} (manifest ${preview.consent.manifestSha.slice(0, 12)}, ${what} ${bytes.slice(0, 12)}).`,
  }]
  for (const permission of preview.declaredPermissions) {
    changes.push({ kind: 'setting', target: `plugin:${id}:permission:${permission}`, action: 'create', description: `${id} is granted the "${permission}" permission.` })
  }
  for (const bin of preview.declaredBins) {
    changes.push({ kind: 'file', target: `plugin:${id}:bin:${bin.name}@${bin.version}#${bin.sha256}`, action: 'create', description: `${id} installs ${bin.name} ${bin.version} (sha256 ${bin.sha256.slice(0, 12)}) into ~/.bakin/bin.` })
  }
  return changes
}

const PLUGIN_OPERATION_PLAN = (verb: string) => ({
  stages: [
    { id: 'upgrade', kind: 'committing' as const, label: `${verb} the plugins` },
    { id: 'activate', kind: 'verifying' as const, label: 'Activate them' },
  ],
  pointOfNoReturn: 'upgrade',
})

/**
 * Commit exactly what was approved, plugin by plugin: preview again, hold the
 * lane to the approved identity (version, manifest, bytes, binaries), commit
 * with that consent, activate. Returns the plugins that went through and the
 * per-plugin problems.
 */
async function commitApproved(
  approved: ApprovedIdentity[],
  items: ReadonlyArray<HealthRepairPlanItem>,
  op: OperationContext,
  reinstall: boolean,
): Promise<{ done: string[]; problems: Map<string, string> }> {
  const { upgradePlugin, UpgradeRefusedError } = await import('../../../../src/core/plugins/upgrade')
  const { activateUserPluginDir } = await import('../../../../src/core/plugins/live-lifecycle')
  const verb = reinstall ? 'Reinstall' : 'Upgrade'
  const done: string[] = []
  const problems = new Map<string, string>()
  op.stage('upgrade')
  for (const want of approved) {
    const id = want.id
    op.item('upgrade', { id, label: id, status: 'active' })
    try {
      const preview = await upgradePlugin(id, { previewOnly: true, ...(reinstall ? { reinstall: true } : {}) })
      if (preview.noop) {
        op.item('upgrade', { id, label: id, status: 'skipped', message: 'already current' })
        continue
      }
      const bytes = preview.identity?.digest ?? preview.identity?.sha
      if (!preview.consent || preview.after.version !== want.version || preview.consent.manifestSha !== want.manifestSha
        || bytes !== want.bytes || !sameBins(preview.declaredBins, approvedBins(items, id))) {
        throw new UpgradeRefusedError(`${id}: the ${reinstall ? 'source' : 'published release'} changed since it was approved (approved ${want.version}) — rerun Health to review the new change set.`)
      }
      const result = await upgradePlugin(id, { accepted: preview.consent, expected: expectedFor(want), ...(reinstall ? { reinstall: true } : {}) })
      if (result.awaitingConsent) throw new UpgradeRefusedError(`${id}: its manifest changed since the preview — rerun Health to review the new change set.`)
      done.push(id)
      op.item('upgrade', { id, label: `${id} → ${result.after.version}`, status: 'done' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      problems.set(id, message)
      op.item('upgrade', { id, label: id, status: 'failed', message })
    }
  }
  op.stage('activate')
  for (const id of done) {
    try {
      await activateUserPluginDir(join(getContentDir(), 'plugins', id))
      op.item('activate', { id, label: id, status: 'done' })
    } catch (err) {
      const message = `${verb}ed ${id} but could not activate it: ${err instanceof Error ? err.message : String(err)}`
      problems.set(id, message)
      op.item('activate', { id, label: id, status: 'failed', message })
    }
  }
  return { done, problems }
}

/**
 * One-click upgrade to the release the updates engine offers. One incident's
 * repair upgrades THAT plugin; "all actionable" bundles every stranded plugin
 * with an offer plus every incident pointing here.
 */
export function pluginUpgradeRepair(deps: PluginArtifactDeps = defaultDeps): HealthRepairActionDefinition {
  return {
    id: PLUGIN_UPGRADE_ACTION,
    name: 'Upgrade plugins to the offered release',
    // Rows 93/97/99/101: none — a non-empty consent delta is the ONE
    // authorization gate's business (an unattended upgrade is refused
    // `consent-unreviewed` until PR6's consent records exist, R3 N2).
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false },
    mutation: 'upgrade',
    resources: ['install-state'],
    operationPlan: () => PLUGIN_OPERATION_PLAN('Upgrade'),
    async plan(target) {
      const named = await pluginsNamedBy(target, PLUGIN_UPGRADE_ACTION)
      const candidates = [...new Set(target.type === 'all_actionable' ? [...await strandedWithOffer(deps), ...named] : named)]
      if (candidates.length === 0) return []
      const { upgradePlugin } = await import('../../../../src/core/plugins/upgrade')
      const changes: HealthRepairChange[] = []
      for (const id of candidates) {
        try {
          if ((await pluginUpgradeOffer(id, deps)).kind !== 'upgrade') continue
          changes.push(...(previewChanges(id, await upgradePlugin(id, { previewOnly: true }), false) ?? []))
        } catch (err) {
          log.warn('Upgrade preview failed; not proposing it', { pluginId: id, err: err instanceof Error ? err.message : String(err) })
        }
      }
      if (changes.length === 0) return []
      const ids = [...new Set(changes.map((c) => c.target.split(/[:@]/)[1]))]
      return [{
        id: PLUGIN_UPGRADE_ACTION,
        actionId: PLUGIN_UPGRADE_ACTION,
        title: `Upgrade ${ids.join(', ')} to the release its source published for this Bakin`,
        reason: 'These plugins have a newer release — or one built for this Bakin after an upgrade stranded them — observed by the updates engine.',
        ...repairTargetSelection(target),
        changes,
      }]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      const approved = items.flatMap((item) => item.changes.map((c) => parseIdentityTarget(c.target)).filter((t): t is ApprovedIdentity => t !== null))
      const { done, problems } = await commitApproved(approved, items, op, false)
      const message = [
        done.length > 0 ? `Upgraded ${done.join(', ')}.` : 'Nothing upgraded.',
        ...problems.values(),
      ].join(' ')
      return items.map((item) => ({
        itemId: item.id,
        actionId: item.actionId,
        status: problems.size > 0 ? 'failed' as const : done.length > 0 ? 'applied' as const : 'skipped' as const,
        message,
        affectedCheckIds: PLUGIN_CHECK_IDS,
        changes: item.changes.filter((change) => done.includes(change.target.split(/[:@]/)[1]!)),
      }))
    },
  }
}

/**
 * Reinstall of the RECORDED install, one item per plugin the target names.
 * The fallback behind `plugin-upgrade` when the install itself is broken and
 * nothing newer is offered; a reinstall never changes the version.
 */
export function pluginReinstallRepair(): HealthRepairActionDefinition {
  return {
    id: PLUGIN_REINSTALL_ACTION,
    name: 'Reinstall plugins from their recorded source',
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false },
    mutation: 'reinstall',
    resources: ['install-state'],
    operationPlan: () => PLUGIN_OPERATION_PLAN('Reinstall'),
    async plan(target) {
      const named = await pluginsNamedBy(target, PLUGIN_REINSTALL_ACTION)
      if (named.length === 0) return []
      const { upgradePlugin } = await import('../../../../src/core/plugins/upgrade')
      const items: HealthRepairPlanItemInput[] = []
      for (const id of named) {
        try {
          const preview = await upgradePlugin(id, { previewOnly: true, reinstall: true })
          const changes = previewChanges(id, preview, true)
          if (!changes) continue
          items.push({
            id,
            actionId: PLUGIN_REINSTALL_ACTION,
            title: `Reinstall ${id} ${preview.after.version}`.slice(0, 120),
            reason: 'The installed copy cannot be trusted as it stands; re-staging the recorded release from its source replaces it byte for byte.',
            ...repairTargetSelection(target),
            changes,
          })
        } catch (err) {
          log.warn('Reinstall preview failed; not proposing it', { pluginId: id, err: err instanceof Error ? err.message : String(err) })
        }
      }
      return items
    },
    async apply(items, op) {
      if (items.length === 0) return []
      const approved = items.flatMap((item) => item.changes.map((c) => parseIdentityTarget(c.target)).filter((t): t is ApprovedIdentity => t !== null))
      const { done, problems } = await commitApproved(approved, items, op, true)
      return items.map((item): HealthRepairApplyResult => {
        const problem = problems.get(item.id)
        return {
          itemId: item.id,
          actionId: item.actionId,
          status: problem ? 'failed' : done.includes(item.id) ? 'applied' : 'skipped',
          message: problem ?? (done.includes(item.id) ? `Reinstalled ${item.id}.` : `${item.id} was already current.`),
          affectedCheckIds: PLUGIN_CHECK_IDS,
          changes: done.includes(item.id) ? item.changes : [],
        }
      })
    },
  }
}
