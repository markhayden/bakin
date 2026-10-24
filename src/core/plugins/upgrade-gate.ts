/**
 * Shared plumbing for the plugin upgrade lanes: result/option types, the
 * refusal error, the security audit trail, manifest reading + the
 * id-stability / signature-policy / permission gates every lane runs
 * before mutating disk, and the post-commit plugin-asset projection.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { execFileSync, type ExecFileSyncOptions } from 'child_process'
import type { OperationContext } from '@makinbakin/sdk/types'
import { gitArgs } from '@bakin/core/net/git-args'
import { createHash } from 'crypto'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { appendAudit } from '@/core/audit'
import { BinRequirementsSchema, type BinRequirement } from '@bakin/core/plugins/bin-requirement'
import type { PluginLockEntry } from '@bakin/core/plugins/lockfile'
import { deleteBinsWithoutOwners } from './bin-owners'
import { preflightPluginBins } from './bin-preflight'
import { consentBinsOf, sameBins, type ConsentBin } from './consent-bins'
import { getSettings } from '@bakin/core/settings'
import { parseManifestPermissions, type Permission } from '@bakin/core/plugins/permissions'
import { verifyPluginManifestSignature } from '@bakin/core/plugins/signatures'
import { PLUGIN_STAGES } from './operation-plans'
import {
  findSkillsForPlugin,
  assertPluginSkillsAreText,
  installPluginAssets,
  type InstallReport,
} from '@/core/onboarding/plugin-assets'

const log = createLogger('plugin-upgrade')

/**
 * The exact declaration the user consented to — what the route verified out
 * of the consent token. An upgrade commits only when the target manifest
 * still matches it (spec plugin-managed-binaries §2.5, S17).
 */
export interface UpgradeConsent {
  manifestSha: string
  permissions: string[]
  bins: ConsentBin[]
}

export interface UpgradeOptions {
  /** Consent verified from the preview token. */
  accepted?: UpgradeConsent
  /**
   * Preview (#895): fetch and gate only — never replace anything. A preview
   * with nothing new to consent to ends `ready` (with the consent to bind
   * into the commit token) instead of committing.
   */
  previewOnly?: boolean
  /** The preview or commit operation: lanes report fetch → check → the replace stages. */
  op?: OperationContext
  /**
   * The identity the operator reviewed (#1007 review r3 #1): the lane refuses
   * to install anything else — a ref that moved upstream, a republished
   * artifact — even when the manifest (and so the consent token) is unchanged.
   */
  expected?: { version?: string; sha?: string; digest?: string }
  /**
   * Reinstall (self-healing 1.3b): re-stage the RECORDED install — the
   * lockfile's version for the artifact lane, its commit for the git lanes,
   * the live source for the local lane — and replace the plugin dir through
   * the transaction even when nothing newer exists. A repair never upgrades:
   * a ref that moved on is ignored, and a recorded identity that is no longer
   * available (or no longer runs on this host) is refused without mutation.
   */
  reinstall?: boolean
}

/** The commit a git-lane reinstall re-stages; a lockfile without one cannot be repaired in place. */
export function recordedCommit(id: string, entry: { commitSha: string }): string {
  const sha = entry.commitSha.toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new UpgradeRefusedError(`${id}: the lockfile has no recorded commit to reinstall — remove the plugin and install it again.`)
  }
  return sha
}

/** The identity a lane verified: what it would install. Every lane reports it (review r4 #1). */
export interface UpgradeIdentity {
  version: string
  /** Git lanes: the commit the ref resolves to. */
  sha?: string
  /** The artifact lane: the published tarball's sha256; the local lane: the source tree's digest. */
  digest?: string
}

/**
 * Refuse a candidate that is not the reviewed one. Every field the caller
 * reviewed must be present on the candidate AND match — a lane that cannot
 * report a reviewed field cannot prove it is installing the reviewed thing.
 * Fields the caller did not review (undefined) are not compared.
 */
export function assertUpgradeTarget(id: string, expected: UpgradeOptions['expected'], candidate: UpgradeIdentity): void {
  if (!expected) return
  const drift: string[] = []
  const compare = (field: 'version' | 'sha' | 'digest', label: string, short: (value: string) => string) => {
    const want = expected[field]
    if (want === undefined) return
    const have = candidate[field]
    if (have === undefined) drift.push(`no ${label} to hold against the reviewed ${short(want)}`)
    else if (have !== want) drift.push(`${label} ${short(have)} (reviewed ${short(want)})`)
  }
  compare('version', 'version', (v) => v)
  compare('sha', 'commit', (v) => v.slice(0, 7))
  compare('digest', 'artifact', (v) => v.slice(0, 12))
  if (drift.length > 0) throw new UpgradeRefusedError(`${id}: the upgrade target changed since it was reviewed — ${drift.join(', ')}. Check for updates and apply again.`)
}

export interface UpgradeResult {
  id: string
  before: { version: string; commitSha: string }
  after: { version: string; commitSha: string }
  /** True when nothing changed and no rebuild ran. */
  noop: boolean
  /** The identity this lane verified it would install (absent on a noop): what an approval or an `expected` holds it to. */
  identity?: UpgradeIdentity
  /**
   * EVERY permission the target manifest declares — the consent disclosure.
   * Never a diff against the lockfile: the lock is inventory, and an edited
   * lock entry must not be able to hide a permission from the prompt.
   */
  declaredPermissions: string[]
  /** EVERY binary the target manifest declares for this platform (same rule). */
  declaredBins: ConsentBin[]
  /**
   * True when the target declares any permission or binary and no matching
   * consent was passed. `consent` carries the declaration to bind into the
   * token; the caller re-invokes with `accepted` once the user agrees.
   */
  awaitingConsent: boolean
  consent?: UpgradeConsent
  /** Set when `accepted` was passed but the target changed since the preview — re-consent. */
  manifestChanged?: boolean
  /** A preview with nothing to consent to (no declared permissions or binaries): commit (with the token for `consent`) to apply it. */
  ready?: boolean
  /** Runtime skills projected from defaults/runtime-skills during a committed upgrade. */
  pluginAssets?: InstallReport
  /** Binaries the previous manifest declared that this upgrade dropped and deleted (zero remaining owners). */
  droppedBins?: string[]
}

/** Tag for refusal errors so the API layer can map them to HTTP 400. */
export class UpgradeRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UpgradeRefusedError'
  }
}

/**
 * Append a `plugin.upgrade.rejected` audit entry with `kind: 'security'`
 * for forensic-trail symmetry with `auditInstallRejected` in install.ts.
 * Best-effort — never throws. C24's docs claim "install/upgrade/remove
 * security events all carry kind:'security'", which only matched code
 * for install + remove until this lands.
 */
export function auditUpgradeRejected(reason: string, pluginId: string, extra: Record<string, unknown> = {}): void {
  try {
    appendAudit(getContentDir(), 'plugin.upgrade.rejected', 'system', {
      kind: 'security',
      reason,
      pluginId,
      ...extra,
    }, 'system')
  } catch {
    // best-effort
  }
}

/**
 * Run an external command and return stdout. Wraps execFileSync so the
 * caller doesn't have to repeat the `stdio` boilerplate. maxBuffer caps
 * the output at 10MB so a malicious git server can't OOM us by streaming
 * unbounded data.
 */
export function run(cmd: string, args: string[], cwd: string): string {
  const opts: ExecFileSyncOptions = {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  }
  return execFileSync(cmd, args, opts).toString().trim()
}

/**
 * `run('git', …)` with the foreground-only config (`gitArgs`): no detached
 * `gc --auto` may outlive the command inside a directory the replace
 * transaction is about to rename or delete (#978).
 */
export function git(args: string[], cwd: string): string {
  return run('git', gitArgs(args), cwd)
}

export function readManifest(pluginDir: string): { manifest: Record<string, unknown>; manifestSha: string } {
  const path = join(pluginDir, 'bakin-plugin.json')
  if (!existsSync(path)) {
    throw new Error(`Plugin source missing bakin-plugin.json at ${path}`)
  }
  const raw = readFileSync(path)
  const manifest = JSON.parse(raw.toString('utf-8'))
  const manifestSha = createHash('sha256').update(raw).digest('hex')
  return { manifest, manifestSha }
}

export function manifestPermissions(manifest: Record<string, unknown>, id: string): Permission[] {
  try {
    return parseManifestPermissions(manifest.permissions)
  } catch (err) {
    throw new UpgradeRefusedError(
      `${id}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Refuse an upgrade if the new manifest's id doesn't match the lockfile-
 * recorded id. Otherwise a plugin can rename itself across an upgrade —
 * a user plugin `foo` that ships a new manifest declaring `"id": "tasks"`
 * would, after restart, get activated under `tasks` via the user-plugin
 * override path and silently impersonate the core tasks plugin.
 */
export function assertManifestIdStable(manifest: Record<string, unknown>, id: string): void {
  const manifestId = typeof manifest.id === 'string' ? manifest.id : ''
  if (manifestId !== id) {
    auditUpgradeRejected('manifest_id_rename', id, { newManifestId: manifestId })
    throw new UpgradeRefusedError(
      `${id}: upgraded manifest declares id "${manifestId}" — plugins cannot rename across upgrades. Remove and reinstall as the new id if intentional.`,
    )
  }
}

export function assertManifestSignaturePolicy(manifest: Record<string, unknown>, id: string): void {
  try {
    verifyPluginManifestSignature(manifest, getSettings().plugins)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    auditUpgradeRejected('signature_verification_failed', id, { error: message })
    throw new UpgradeRefusedError(`${id}: ${message}`)
  }
}

export function manifestVersion(manifest: Record<string, unknown>, fallback: string): string {
  if (typeof manifest.version === 'string' && manifest.version.length > 0) {
    return manifest.version
  }
  log.warn('plugin manifest missing version on upgrade; keeping previous', { fallback })
  return fallback
}

export async function installUpgradedPluginAssets(
  id: string,
  pluginDir: string,
): Promise<{ installedSkills: string[]; pluginAssets: InstallReport }> {
  const installedSkills = findSkillsForPlugin({ id, path: pluginDir }).map(s => s.name).sort()
  if (installedSkills.length === 0) {
    return {
      installedSkills,
      pluginAssets: { installed: [], unchanged: [], skipped: [], failed: [], restored: [], bins: { installed: [], unchanged: [], failed: [], invalid: [] } },
    }
  }

  assertPluginSkillsAreText({ id, path: pluginDir })
  const pluginAssets = await installPluginAssets([{ id, path: pluginDir }])
  // A skill that did not land verified fails the upgrade; the replace
  // transaction restores the previous plugin.
  if (pluginAssets.failed.length > 0) {
    throw new Error(`${id}: runtime skills could not be installed — ${pluginAssets.failed.map((f) => `${f.name}: ${f.error}`).join('; ')}`)
  }
  return { installedSkills, pluginAssets }
}

/** `requires.bins` of a raw manifest, schema-validated; invalid ⇒ refusal. */
export function manifestBins(manifest: Record<string, unknown>, id: string): BinRequirement[] {
  const raw = (manifest.requires as { bins?: unknown } | undefined)?.bins
  if (raw === undefined) return []
  const parsed = BinRequirementsSchema.safeParse(raw)
  if (!parsed.success) {
    throw new UpgradeRefusedError(`${id}: requires.bins is invalid — ${parsed.error.issues.map((i) => i.message).join('; ')}`)
  }
  return parsed.data
}

export type UpgradeConsentGate =
  | { proceed: true; newPerms: Permission[]; declaredBins: ConsentBin[]; bins: BinRequirement[] }
  | { proceed: false; result: UpgradeResult }

/**
 * ONE consent gate for every upgrade lane. Runs BEFORE any mutation:
 * platform/conflict preflight for the declared bins (fail closed), then
 * consent judged from the validated TARGET manifest alone: any declared
 * permission or binary needs consent (unchanged ones included — the lockfile
 * is never the baseline, so a forged lock entry cannot remove the prompt).
 * Without consent ⇒ the awaiting result carrying the declaration to sign;
 * consent that no longer matches the target ⇒ awaiting + `manifestChanged`
 * (S17); otherwise proceed.
 */
export function gateUpgradeConsent(args: {
  id: string
  entry: PluginLockEntry
  manifest: Record<string, unknown>
  manifestSha: string
  opts: UpgradeOptions
  before: { version: string; commitSha: string }
  after: { version: string; commitSha: string }
  /** What the lane verified it would install — stamped on every preview result so an approval can freeze it. */
  identity: UpgradeIdentity
}): UpgradeConsentGate {
  const { id, manifest, manifestSha, opts, before, after, identity } = args
  opts.op?.stage(PLUGIN_STAGES.check)
  const newPerms = manifestPermissions(manifest, id)
  const bins = manifestBins(manifest, id)
  const preflight = preflightPluginBins(id, bins)
  if (!preflight.ok) throw new UpgradeRefusedError(`${id}: ${preflight.error}`)
  const declaredBins = consentBinsOf(bins)
  const consent: UpgradeConsent = { manifestSha, permissions: newPerms, bins: declaredBins }
  const awaiting = (manifestChanged: boolean): UpgradeConsentGate => ({
    proceed: false,
    result: {
      id, before, after, noop: false, identity, declaredPermissions: newPerms, declaredBins, awaitingConsent: true, consent,
      ...(manifestChanged ? { manifestChanged: true } : {}),
    },
  })
  if ((newPerms.length > 0 || declaredBins.length > 0) && !opts.accepted) return awaiting(false)
  // A supplied consent binds THIS release whether or not it needed one: a
  // commit whose manifest, permissions or binaries differ from what was
  // consented to (a republish between preview and commit) bounces back.
  if (opts.accepted) {
    const accepted = opts.accepted
    const samePerms = accepted.permissions.length === newPerms.length && accepted.permissions.every((p) => (newPerms as string[]).includes(p))
    if (accepted.manifestSha !== manifestSha || !samePerms || !sameBins(accepted.bins, consent.bins)) return awaiting(true)
  }
  if (opts.previewOnly) {
    return {
      proceed: false,
      result: { id, before, after, noop: false, identity, declaredPermissions: newPerms, declaredBins, awaitingConsent: false, ready: true, consent },
    }
  }
  return { proceed: true, newPerms, declaredBins, bins }
}

/**
 * After a committed upgrade: delete binaries the previous manifest declared
 * that the new one dropped — only with zero remaining owners in either
 * lockfile (spec §2.4 / S6 rule). Runs AFTER the ledger write, so this
 * plugin no longer counts as an owner of what it dropped.
 */
export function sweepDroppedBins(id: string, previous: PluginLockEntry['installedBins'], kept: readonly string[]): string[] {
  const dropped = deleteBinsWithoutOwners(previous ?? [], new Set(kept))
  if (dropped.length > 0) {
    log.info('Removed binaries the upgraded manifest no longer declares', { id, dropped })
    try {
      appendAudit(getContentDir(), 'plugin.upgrade.bins_dropped', 'system', { pluginId: id, bins: dropped }, 'system')
    } catch (err) {
      log.warn('bins_dropped audit failed', { id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return dropped
}
