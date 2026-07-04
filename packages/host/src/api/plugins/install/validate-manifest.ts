/**
 * Install phase (c) — manifest validation over the staged source.
 *
 * Size-bounds and parses `bakin-plugin.json`, validates the plugin id
 * (shape + core-id squatting), verifies the manifest signature policy,
 * parses declared permissions, checks dependencies, and computes the
 * staged manifest sha that the consent token binds to. Every failure
 * tears down the staging dir and returns the exact error Response the
 * monolithic handler produced.
 */
import { existsSync, readFileSync, rmSync, statSync } from 'fs'
import { join, basename } from 'path'
import { createHash } from 'crypto'
import { isCorePlugin } from '@/core/plugin-registry'
import { checkPluginDependencies } from '@/core/plugins/dependencies'
import type { PluginLockEntry } from '@bakin/core/plugins/lockfile'
import { getSettings } from '@bakin/core/settings'
import { parseManifestPermissions } from '@bakin/core/plugins/permissions'
import { PLUGIN_ID_RE, readPluginManifestJson, PluginManifestError } from '@bakin/core/plugins/manifest'
import { verifyPluginManifestSignature } from '@bakin/core/plugins/signatures'
import { auditInstallRejected } from './audit'
import type { InstallBody } from './body'

/** Hard ceiling for any plugin source we'll accept — a manifest that big is malicious. */
export const MANIFEST_MAX_BYTES = 1 * 1024 * 1024  // 1MB

/**
 * Reject id collisions with core plugin ids unless explicitly opted in.
 * Otherwise a malicious source named "tasks" or "schedule" can replace
 * a core plugin permanently after the next restart.
 *
 * Returns the rejection message, or null when the id is allowed.
 */
export function coreIdSquattingError(id: string, overrideCore: boolean | undefined): string | null {
  if (isCorePlugin(id) && overrideCore !== true) {
    return `Plugin id "${id}" collides with a core plugin. Re-run with overrideCore:true to intentionally replace the built-in (rare).`
  }
  return null
}

/** Output of the manifest-validation phase — inputs to consent + commit. */
export interface ValidatedManifest {
  id: string
  manifest: Record<string, unknown> & { id: string; version: string }
  parsedPermissions: PluginLockEntry['permissions']
  /**
   * sha256 of the staged manifest bytes — bound into the consent token AND
   * re-checked at commit time. Same hash function `recordInstall` uses.
   */
  stagedManifestSha: string
}

/**
 * Validate the staged plugin's manifest end-to-end. On failure the staging
 * dir has already been removed and `response` is the exact error the
 * client should receive.
 */
export function validateStagedManifest(
  body: InstallBody,
  stagingDir: string,
  effectivePluginDir: string,
): { ok: true; validated: ValidatedManifest } | { ok: false; response: Response } {
  const manifestPath = join(effectivePluginDir, 'bakin-plugin.json')
  if (!existsSync(manifestPath)) {
    rmSync(stagingDir, { recursive: true, force: true })
    const where = effectivePluginDir === stagingDir
      ? 'Plugin source is missing bakin-plugin.json'
      : `subpath "${body.source.split('#')[1] ?? ''}" is missing bakin-plugin.json`
    return { ok: false, response: Response.json({ ok: false, error: where }, { status: 400 }) }
  }

  // Bound manifest size before reading — otherwise a hostile source can
  // hand us a 100MB JSON file and OOM the parser before any validation.
  const manifestSize = statSync(manifestPath).size
  if (manifestSize > MANIFEST_MAX_BYTES) {
    rmSync(stagingDir, { recursive: true, force: true })
    auditInstallRejected('manifest_too_large', body.source, { size: manifestSize })
    return {
      ok: false,
      response: Response.json({
        ok: false,
        error: `bakin-plugin.json is too large (${manifestSize} bytes; max ${MANIFEST_MAX_BYTES})`,
      }, { status: 400 }),
    }
  }

  let manifest: Record<string, unknown> & { id: string; version: string }
  let rawManifest: unknown
  try {
    const manifestText = readFileSync(manifestPath, 'utf-8')
    manifest = readPluginManifestJson(manifestText) as unknown as Record<string, unknown> & { id: string; version: string }
    rawManifest = JSON.parse(manifestText)
  } catch (err) {
    rmSync(stagingDir, { recursive: true, force: true })
    return {
      ok: false,
      response: Response.json({
        ok: false,
        error: err instanceof PluginManifestError ? err.message : 'Invalid bakin-plugin.json',
      }, { status: 400 }),
    }
  }

  const id = manifest.id || basename(body.source.replace(/\.git$/, ''))

  // Tightened from /^[a-z0-9][a-z0-9-_]{0,39}$/i — the case-insensitive
  // flag allowed mixed case which collides with case-insensitive macOS
  // filesystems, and underscore allowed exec-tool name collisions
  // between plugins like `foo_bar` + action `baz` vs `foo` + action
  // `bar_baz` (both produce bakin_exec_foo_bar_baz). Lowercase letters,
  // digits, and hyphen only; must start with a letter.
  if (!PLUGIN_ID_RE.test(id)) {
    rmSync(stagingDir, { recursive: true, force: true })
    auditInstallRejected('invalid_plugin_id', body.source, { id })
    return {
      ok: false,
      response: Response.json({
        ok: false,
        error: `Invalid plugin id "${id}" — must match /^[a-z][a-z0-9-]{0,39}$/`,
      }, { status: 400 }),
    }
  }

  const squatError = coreIdSquattingError(id, body.overrideCore)
  if (squatError) {
    rmSync(stagingDir, { recursive: true, force: true })
    auditInstallRejected('core_id_collision', body.source, { id })
    return { ok: false, response: Response.json({ ok: false, error: squatError }, { status: 400 }) }
  }

  try {
    verifyPluginManifestSignature(rawManifest, getSettings().plugins)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    rmSync(stagingDir, { recursive: true, force: true })
    auditInstallRejected('signature_verification_failed', body.source, { id, error: message })
    return {
      ok: false,
      response: Response.json({
        ok: false,
        error: `plugin "${id}": ${message}`,
      }, { status: 400 }),
    }
  }

  // Validate manifest.permissions BEFORE moving files into place — a
  // typo'd permission should fail the install loudly with a "did you
  // mean" suggestion, not silently install with broken metadata.
  let parsedPermissions: PluginLockEntry['permissions']
  try {
    parsedPermissions = parseManifestPermissions(manifest.permissions)
  } catch (err) {
    rmSync(stagingDir, { recursive: true, force: true })
    auditInstallRejected('invalid_permissions', body.source, {
      id,
      error: err instanceof Error ? err.message : String(err),
    })
    return {
      ok: false,
      response: Response.json({
        ok: false,
        error: `plugin "${id}": ${err instanceof Error ? err.message : String(err)}`,
      }, { status: 400 }),
    }
  }

  const dependencyCheck = checkPluginDependencies({
    id,
    dependencies: Array.isArray(manifest.dependencies)
      ? manifest.dependencies.filter((dep): dep is string => typeof dep === 'string')
      : [],
  })
  if (!dependencyCheck.ok) {
    rmSync(stagingDir, { recursive: true, force: true })
    const missing = dependencyCheck.missing
    const self = dependencyCheck.selfDependencies
    auditInstallRejected('missing_dependencies', body.source, { id, missing, self })
    const problems = [
      ...(missing.length > 0 ? [`missing dependencies: ${missing.join(', ')}`] : []),
      ...(self.length > 0 ? ['plugin cannot depend on itself'] : []),
    ].join('; ')
    return {
      ok: false,
      response: Response.json({
        ok: false,
        error: `Plugin "${id}" dependency check failed: ${problems}. Install dependencies first, then retry.`,
      }, { status: 400 }),
    }
  }

  // Compute the manifestSha now so it's bound into the consent token AND
  // re-checked at commit time. Same hash function recordInstall uses.
  const stagedManifestSha = createHash('sha256').update(readFileSync(manifestPath)).digest('hex')

  return { ok: true, validated: { id, manifest, parsedPermissions, stagedManifestSha } }
}
