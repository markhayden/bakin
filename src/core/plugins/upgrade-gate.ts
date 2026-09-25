/**
 * Shared plumbing for the plugin upgrade lanes: result/option types, the
 * refusal error, the security audit trail, manifest reading + the
 * id-stability / signature-policy / permission gates every lane runs
 * before mutating disk, and the post-commit plugin-asset projection.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { execFileSync, type ExecFileSyncOptions } from 'child_process'
import { createHash } from 'crypto'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { appendAudit } from '@/core/audit'
import type { InstallProgressFn } from '@/core/agent-packages/install-progress'
import { BinRequirementsSchema, type BinRequirement } from '@bakin/core/plugins/bin-requirement'
import type { PluginLockEntry } from '@bakin/core/plugins/lockfile'
import { deleteBinsWithoutOwners, samePin } from './bin-owners'
import { preflightPluginBins } from './bin-preflight'
import { consentBinsOf, sameBins, type ConsentBin } from './consent-bins'
import { getSettings } from '@bakin/core/settings'
import { parseManifestPermissions, type Permission } from '@bakin/core/plugins/permissions'
import { verifyPluginManifestSignature } from '@bakin/core/plugins/signatures'
import {
  findSkillsForPlugin,
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
  /** Staged progress for install jobs (fetch-source / project / bins / finalize). */
  progress?: InstallProgressFn
  /** Consent verified from the preview token; absent = preview only. */
  accepted?: UpgradeConsent
}

export interface UpgradeResult {
  id: string
  before: { version: string; commitSha: string }
  after: { version: string; commitSha: string }
  /** True when nothing changed and no rebuild ran. */
  noop: boolean
  /** Permissions present in the new manifest that weren't in the lockfile entry. */
  newPermissions: string[]
  /** Binaries the new manifest adds or re-pins for this platform. */
  newBins: ConsentBin[]
  /**
   * True when the new manifest widens permissions or binaries and no matching
   * consent was passed. `consent` carries the declaration to bind into the
   * token; the caller re-invokes with `accepted` once the user agrees.
   */
  awaitingConsent: boolean
  consent?: UpgradeConsent
  /** Set when `accepted` was passed but the target changed since the preview — re-consent. */
  manifestChanged?: boolean
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

/** Permissions present in `next` that weren't in `prev` — used for consent diff. */
export function diffNewPermissions(prev: string[], next: string[]): string[] {
  const prevSet = new Set(prev)
  return next.filter(p => !prevSet.has(p))
}

export async function installUpgradedPluginAssets(
  id: string,
  pluginDir: string,
): Promise<{ installedSkills: string[]; pluginAssets: InstallReport }> {
  const installedSkills = findSkillsForPlugin({ id, path: pluginDir }).map(s => s.name).sort()
  if (installedSkills.length === 0) {
    return {
      installedSkills,
      pluginAssets: { installed: [], unchanged: [], skipped: [], bins: { installed: [], unchanged: [], failed: [] } },
    }
  }

  const pluginAssets = await installPluginAssets([{ id, path: pluginDir }])
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

/** Bins the new manifest adds or re-pins (for this platform) relative to what the lockfile records — the consent diff. */
export function diffNewBins(prev: PluginLockEntry['installedBins'], next: readonly BinRequirement[]): ConsentBin[] {
  const before = new Map((prev ?? []).map((b) => [b.name, b]))
  return consentBinsOf(next).filter((bin) => {
    const recorded = before.get(bin.name)
    // A re-pin OR a different member of the same archive is a new binary.
    return !recorded || !samePin(recorded, bin)
  })
}

export type UpgradeConsentGate =
  | { proceed: true; newPerms: Permission[]; newBins: ConsentBin[]; widened: Permission[]; bins: BinRequirement[] }
  | { proceed: false; result: UpgradeResult }

/**
 * ONE consent gate for every upgrade lane. Runs BEFORE any mutation:
 * platform/conflict preflight for the declared bins (fail closed), then the
 * widening diff (permissions OR bins). Widening without consent ⇒ the
 * awaiting result carrying the declaration to sign; consent that no longer
 * matches the target ⇒ awaiting + `manifestChanged` (S17); otherwise proceed.
 */
export function gateUpgradeConsent(args: {
  id: string
  entry: PluginLockEntry
  manifest: Record<string, unknown>
  manifestSha: string
  opts: UpgradeOptions
  before: { version: string; commitSha: string }
  after: { version: string; commitSha: string }
}): UpgradeConsentGate {
  const { id, entry, manifest, manifestSha, opts, before, after } = args
  const newPerms = manifestPermissions(manifest, id)
  const bins = manifestBins(manifest, id)
  const preflight = preflightPluginBins(id, bins)
  if (!preflight.ok) throw new UpgradeRefusedError(`${id}: ${preflight.error}`)
  const widened = diffNewPermissions(entry.permissions, newPerms) as Permission[]
  const newBins = diffNewBins(entry.installedBins, bins)
  const consent: UpgradeConsent = { manifestSha, permissions: newPerms, bins: consentBinsOf(bins) }
  const awaiting = (manifestChanged: boolean): UpgradeConsentGate => ({
    proceed: false,
    result: {
      id, before, after, noop: false, newPermissions: widened, newBins, awaitingConsent: true, consent,
      ...(manifestChanged ? { manifestChanged: true } : {}),
    },
  })
  if (widened.length > 0 || newBins.length > 0) {
    if (!opts.accepted) return awaiting(false)
    const accepted = opts.accepted
    const samePerms = accepted.permissions.length === newPerms.length && accepted.permissions.every((p) => (newPerms as string[]).includes(p))
    if (accepted.manifestSha !== manifestSha || !samePerms || !sameBins(accepted.bins, consent.bins)) return awaiting(true)
  }
  return { proceed: true, newPerms, newBins, widened, bins }
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
