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
import { getSettings } from '@bakin/core/settings'
import { parseManifestPermissions, type Permission } from '@bakin/core/plugins/permissions'
import { verifyPluginManifestSignature } from '@bakin/core/plugins/signatures'
import {
  findSkillsForPlugin,
  installPluginAssets,
  type InstallReport,
} from '@/core/onboarding/plugin-assets'

const log = createLogger('plugin-upgrade')

export interface UpgradeOptions {
  /** Skip consent prompt even when permissions widen. */
  yes?: boolean
}

export interface UpgradeResult {
  id: string
  before: { version: string; commitSha: string }
  after: { version: string; commitSha: string }
  /** True when nothing changed and no rebuild ran. */
  noop: boolean
  /** Permissions present in the new manifest that weren't in the lockfile entry. */
  newPermissions: string[]
  /**
   * True when the new manifest declares permissions not present in the
   * lockfile entry AND the caller did not pass `--yes`. Caller is expected
   * to surface a consent prompt (C9) and re-invoke with `yes: true` once
   * the user accepts.
   */
  awaitingConsent: boolean
  /** Runtime skills projected from defaults/runtime-skills during a committed upgrade. */
  pluginAssets?: InstallReport
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
      pluginAssets: { installed: [], unchanged: [], skipped: [] },
    }
  }

  const pluginAssets = await installPluginAssets([{ id, path: pluginDir }])
  return { installedSkills, pluginAssets }
}
