/**
 * POST /api/plugins/install — install a plugin from a local directory or
 * GitHub URL into ~/.bakin/plugins/<id>/.
 *
 * Migrated from src/app/api/plugins/install/route.ts for Phase B of #147.
 *
 * Security boundaries enforced here:
 * - Local source paths are realpath-resolved and contained to one of:
 *   ~/.bakin/, $HOME, or the current working directory. Anything else is
 *   rejected as a path-traversal attempt.
 * - The github URL is parsed and validated against a strict shape before
 *   it reaches `git clone`; refs that look like options (leading `-`) are
 *   refused. `git clone` is invoked with `--` to end-of-options.
 * - manifest.id is regex-validated; collisions with core plugin ids are
 *   refused unless --override-core was passed (file an issue first).
 * - Plugin source size is bounded to keep a hostile manifest from
 *   exhausting memory in JSON.parse / Levenshtein.
 *
 * Restart required for the plugin's UI (nav items, pages, slot
 * registrations) to take effect — the server-side plugin loader picks
 * up the new manifest on next boot.
 */
import { existsSync, readFileSync, mkdirSync, cpSync, rmSync, statSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { join, basename, resolve, isAbsolute, sep } from 'path'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { isCorePlugin } from '@/lib/plugin-registry'
import { buildUserPlugin } from '../../plugin-host/user-plugin-builder'
import {
  addPlugin,
  readPluginLockfile,
  writePluginLockfile,
  type PluginLockEntry,
} from '@bakin/core/plugins/lockfile'
import { parseManifestPermissions } from '@bakin/core/plugins/permissions'
import { computeSourceTreeSha } from '@/core/plugins/upgrade'
import { signConsentToken, verifyConsentToken } from '@/core/plugins/consent-token'
import { findSkillsForPlugin } from '@/core/onboarding/plugin-assets'
import { appendAudit } from '@/core/audit'

/** Hard ceiling for any plugin source we'll accept — a manifest that big is malicious. */
const MANIFEST_MAX_BYTES = 1 * 1024 * 1024  // 1MB

/**
 * Append a `plugin.install.rejected` audit entry with `kind: 'security'`
 * so operators can grep `~/.bakin/audit.jsonl` for the forensic trail
 * across path-traversal rejections, core-id collisions, manifest size
 * limits, consent-token failures, etc. Best-effort — never throws.
 */
function auditInstallRejected(reason: string, source: string, extra: Record<string, unknown> = {}): void {
  try {
    appendAudit(getContentDir(), 'plugin.install.rejected', 'system', {
      kind: 'security',
      reason,
      source,
      ...extra,
    }, 'system')
  } catch {
    // best-effort
  }
}

const log = createLogger('plugin-install')

/**
 * Resolve git provenance for a freshly installed plugin dir. Returns empty
 * strings for either field if the corresponding git command fails — happens
 * for local installs (no .git/) and for github installs in detached-HEAD
 * state. Both failures are non-fatal; the lockfile records the honest
 * emptiness rather than fabricating a synthetic value.
 */
function resolveGitProvenance(targetDir: string, type: 'github' | 'local'): { ref: string; commitSha: string } {
  if (type === 'local') return { ref: '', commitSha: '' }
  let ref = ''
  let commitSha = ''
  try {
    commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: targetDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
    }).trim().toLowerCase()
  } catch {
    // commitSha stays ''
  }
  try {
    ref = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: targetDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
    }).trim()
  } catch {
    // detached HEAD or other — ref stays ''
  }
  return { ref, commitSha }
}

/**
 * Write a `PluginLockEntry` for a freshly installed plugin.
 *
 * `manifestSha` is computed by the caller BEFORE the staging→target copy
 * (so the same hash drives both the consent token and this lockfile
 * entry). Previously this function re-read the manifest from
 * `manifestPath` AFTER the staging dir had been deleted — the resulting
 * ENOENT was swallowed by the catch and every install silently returned
 * `ok: true` with no lockfile entry written. That broke consent tokens,
 * `installedSkills`, --check, upgrade, and remove for fresh installs.
 */
function recordInstall(args: {
  id: string
  targetDir: string
  manifestSha: string
  manifest: Record<string, unknown>
  source: string
  type: 'github' | 'local'
  permissions: PluginLockEntry['permissions']
}): void {
  const { id, targetDir, manifestSha, manifest, source, type } = args
  try {
    const { ref, commitSha } = resolveGitProvenance(targetDir, type)

    let version: string
    if (typeof manifest.version === 'string' && manifest.version.length > 0) {
      version = manifest.version
    } else {
      log.warn('plugin manifest missing version; defaulting to 0.0.0', { id })
      version = '0.0.0'
    }

    // For local installs, capture the install-time source-tree sha so the
    // first `bakin plugins list --check` doesn't false-positive (the check
    // would compare against an undefined value otherwise).
    let sourceTreeSha: string | undefined
    if (type === 'local' && existsSync(source)) {
      try {
        sourceTreeSha = computeSourceTreeSha(source)
      } catch (err) {
        log.warn('failed to hash local source tree at install', { id, err: String(err) })
      }
    }

    // Record the OpenClaw skills this plugin shipped — used as the
    // authoritative allowlist at uninstall time.
    let installedSkills: string[] = []
    try {
      installedSkills = findSkillsForPlugin({ id, path: targetDir }).map(s => s.name)
    } catch (err) {
      log.warn('failed to scan plugin skills at install', { id, err: String(err) })
    }

    // Permissions are validated up-front by the caller (POST handler) and
    // passed in pre-parsed; recordInstall just records them as-is.
    const entry: PluginLockEntry = {
      source,
      type,
      ref,
      commitSha,
      installedAt: new Date().toISOString(),
      version,
      permissions: args.permissions,
      manifestSha,
      sourceTreeSha,
      installedSkills,
    }

    const lock = readPluginLockfile()
    writePluginLockfile(addPlugin(lock, id, entry))
  } catch (err) {
    log.error('failed to record plugin install in lockfile', err as Error, { id })
  }
}

interface InstallBody {
  source: string
  type: 'local' | 'github'
  /**
   * #142 layer 2 — set true after the user accepts the consent prompt. When
   * the manifest declares permissions and this is false, the endpoint
   * stages, validates, and returns awaitingConsent: true with the diff
   * before doing any irreversible work.
   */
  accepted?: boolean
  /** Required when accepted=true and the prior preflight returned a token (C13 binding). */
  consentToken?: string
  /** Allow installing a user plugin whose id matches a core plugin id (rare; opt-in). */
  overrideCore?: boolean
}

/**
 * Resolve a local install source to an absolute path AND verify it lives
 * under one of the trusted roots. Symlinks are followed so a foo→/etc
 * shortcut can't sneak past containment.
 *
 * Trusted roots: ~/.bakin/, $HOME, process.cwd(). Anything else is a
 * path-traversal attempt or a misconfiguration; reject.
 */
function resolveAndContainLocalSource(rawSource: string): { ok: true; path: string } | { ok: false; error: string } {
  const candidate = isAbsolute(rawSource) ? rawSource : resolve(process.cwd(), rawSource)
  if (!existsSync(candidate)) return { ok: false, error: `Source path does not exist: ${candidate}` }
  let real: string
  try {
    real = realpathSync(candidate)
  } catch (err) {
    return { ok: false, error: `Cannot resolve source path: ${err instanceof Error ? err.message : String(err)}` }
  }
  const allowedRoots: string[] = []
  for (const r of [getContentDir(), homedir(), process.cwd()]) {
    try {
      allowedRoots.push(realpathSync(r))
    } catch {
      // skip a root that doesn't exist (e.g. process.cwd() under test)
    }
  }
  const contained = allowedRoots.some(root => real === root || real.startsWith(root + sep))
  if (!contained) {
    return {
      ok: false,
      error: `source path is outside the permitted roots (~/.bakin/, $HOME, cwd): ${real}`,
    }
  }
  return { ok: true, path: real }
}

/**
 * Validate a github install source string before it reaches `git clone`.
 * Rejects anything that looks like a smuggled option (leading `-`, control
 * chars, whitespace, suspicious schemes). Returns the canonical clone URL.
 */
function resolveGithubCloneUrl(rawSource: string): { ok: true; url: string } | { ok: false; error: string } {
  const stripped = rawSource.startsWith('github:') ? rawSource.slice(7) : rawSource
  if (stripped.length === 0) return { ok: false, error: 'empty github source' }
  if (/[\s\x00-\x1f]/.test(stripped)) return { ok: false, error: 'github source contains control characters or whitespace' }
  if (stripped.startsWith('-')) return { ok: false, error: 'github source must not start with "-"' }
  let url: string
  if (stripped.startsWith('http://') || stripped.startsWith('https://')) {
    url = stripped
  } else if (stripped.startsWith('git@')) {
    url = stripped
  } else {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*(\.git)?$/.test(stripped)) {
      return { ok: false, error: `invalid github user/repo shorthand: ${stripped}` }
    }
    url = `https://github.com/${stripped}.git`
  }
  if (url.length > 2048) return { ok: false, error: 'github source URL is suspiciously long' }
  return { ok: true, url }
}

export async function post(req: Request, _url: URL): Promise<Response> {
  let body: InstallBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.source || typeof body.source !== 'string') {
    return Response.json({ ok: false, error: 'Missing source' }, { status: 400 })
  }
  if (body.type !== 'local' && body.type !== 'github') {
    return Response.json({ ok: false, error: 'Invalid type; must be "local" or "github"' }, { status: 400 })
  }

  const pluginsRoot = join(getContentDir(), 'plugins')
  if (!existsSync(pluginsRoot)) mkdirSync(pluginsRoot, { recursive: true })

  try {
    const stagingDir = join(pluginsRoot, `.staging-${Date.now()}`)
    mkdirSync(stagingDir, { recursive: true })

    try {
      if (body.type === 'local') {
        const contained = resolveAndContainLocalSource(body.source)
        if (!contained.ok) {
          rmSync(stagingDir, { recursive: true, force: true })
          auditInstallRejected('path_traversal', body.source, { error: contained.error })
          return Response.json({ ok: false, error: contained.error }, { status: 400 })
        }
        cpSync(contained.path, stagingDir, { recursive: true, dereference: false })
      } else {
        const parsedUrl = resolveGithubCloneUrl(body.source)
        if (!parsedUrl.ok) {
          rmSync(stagingDir, { recursive: true, force: true })
          auditInstallRejected('invalid_github_url', body.source, { error: parsedUrl.error })
          return Response.json({ ok: false, error: parsedUrl.error }, { status: 400 })
        }
        // `--` ends option parsing so a bizarre URL can't be reinterpreted
        // as a git option. URL was also validated for leading `-` above.
        execFileSync('git', ['clone', '--depth', '1', '--', parsedUrl.url, stagingDir], {
          stdio: 'pipe',
          maxBuffer: 10 * 1024 * 1024,
        })
      }

      // Validate manifest
      const manifestPath = join(stagingDir, 'bakin-plugin.json')
      if (!existsSync(manifestPath)) {
        rmSync(stagingDir, { recursive: true, force: true })
        return Response.json({
          ok: false,
          error: 'Plugin source is missing bakin-plugin.json',
        }, { status: 400 })
      }

      // Bound manifest size before reading — otherwise a hostile source can
      // hand us a 100MB JSON file and OOM the parser before any validation.
      const manifestSize = statSync(manifestPath).size
      if (manifestSize > MANIFEST_MAX_BYTES) {
        rmSync(stagingDir, { recursive: true, force: true })
        auditInstallRejected('manifest_too_large', body.source, { size: manifestSize })
        return Response.json({
          ok: false,
          error: `bakin-plugin.json is too large (${manifestSize} bytes; max ${MANIFEST_MAX_BYTES})`,
        }, { status: 400 })
      }

      let manifest: Record<string, unknown>
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      } catch {
        rmSync(stagingDir, { recursive: true, force: true })
        return Response.json({ ok: false, error: 'Invalid bakin-plugin.json' }, { status: 400 })
      }

      const id = typeof manifest.id === 'string' && manifest.id.length > 0
        ? manifest.id
        : basename(body.source.replace(/\.git$/, ''))

      // Tightened from /^[a-z0-9][a-z0-9-_]{0,39}$/i — the case-insensitive
      // flag allowed mixed case which collides with case-insensitive macOS
      // filesystems, and underscore allowed exec-tool name collisions
      // between plugins like `foo_bar` + action `baz` vs `foo` + action
      // `bar_baz` (both produce bakin_exec_foo_bar_baz). Lowercase letters,
      // digits, and hyphen only; must start with a letter.
      if (!/^[a-z][a-z0-9-]{0,39}$/.test(id)) {
        rmSync(stagingDir, { recursive: true, force: true })
        auditInstallRejected('invalid_plugin_id', body.source, { id })
        return Response.json({
          ok: false,
          error: `Invalid plugin id "${id}" — must match /^[a-z][a-z0-9-]{0,39}$/`,
        }, { status: 400 })
      }

      // Reject id collisions with core plugin ids unless explicitly opted in.
      // Otherwise a malicious source named "tasks" or "schedule" can replace
      // a core plugin permanently after the next restart.
      if (isCorePlugin(id) && body.overrideCore !== true) {
        rmSync(stagingDir, { recursive: true, force: true })
        auditInstallRejected('core_id_collision', body.source, { id })
        return Response.json({
          ok: false,
          error: `Plugin id "${id}" collides with a core plugin. Re-run with overrideCore:true to intentionally replace the built-in (rare).`,
        }, { status: 400 })
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
        return Response.json({
          ok: false,
          error: `plugin "${id}": ${err instanceof Error ? err.message : String(err)}`,
        }, { status: 400 })
      }

      // Compute the manifestSha now so it's bound into the consent token AND
      // re-checked at commit time. Same hash function recordInstall uses.
      const stagedManifestSha = createHash('sha256').update(readFileSync(manifestPath)).digest('hex')

      // #142 layer 2 — if the manifest declares permissions and the caller
      // hasn't accepted yet, return awaitingConsent with the diff. CLI
      // surfaces the prompt and re-invokes with accepted:true. We tear
      // down the staging dir here so the second attempt is clean —
      // re-cloning is cheap relative to the cost of staging cleanup bugs.
      if (parsedPermissions.length > 0 && body.accepted !== true) {
        const versionForPrompt = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
        // C13 binding — the token captures (source, manifestSha,
        // permissions). Commit must echo it back; server re-validates
        // against the freshly cloned manifest. If the manifest changed
        // between preflight and commit, commit returns awaitingConsent
        // again with the new diff instead of installing.
        const consentToken = signConsentToken({
          source: body.source,
          manifestSha: stagedManifestSha,
          permissions: parsedPermissions,
        })
        rmSync(stagingDir, { recursive: true, force: true })
        return Response.json({
          ok: false,
          awaitingConsent: true,
          id,
          version: versionForPrompt,
          permissions: parsedPermissions,
          consentToken,
        })
      }

      // Commit phase — when the caller passes accepted:true AND a permission
      // set was declared at preflight, validate the consent token. Without
      // a valid token, the server has no proof the user actually saw and
      // approved this exact manifest's permissions.
      if (parsedPermissions.length > 0 && body.accepted === true) {
        if (!body.consentToken) {
          rmSync(stagingDir, { recursive: true, force: true })
          auditInstallRejected('consent_token_missing', body.source, { id })
          return Response.json({
            ok: false,
            error: 'install commit requires a consentToken from preflight (re-run install)',
          }, { status: 400 })
        }
        const token = verifyConsentToken(body.consentToken)
        if (!token) {
          rmSync(stagingDir, { recursive: true, force: true })
          auditInstallRejected('consent_token_invalid', body.source, { id })
          return Response.json({
            ok: false,
            error: 'consentToken is invalid or expired (re-run install to re-prompt)',
          }, { status: 400 })
        }
        if (token.source !== body.source) {
          rmSync(stagingDir, { recursive: true, force: true })
          auditInstallRejected('consent_source_mismatch', body.source, { id, tokenSource: token.source })
          return Response.json({
            ok: false,
            error: 'consentToken source does not match commit body source — re-run preflight',
          }, { status: 400 })
        }
        // The crux: the manifest may have changed between preflight and
        // commit. If so, the user's consent was for a different permission
        // set; bounce back to awaitingConsent with the NEW diff so they
        // can decide again.
        if (token.manifestSha !== stagedManifestSha) {
          const versionForPrompt = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
          const freshToken = signConsentToken({
            source: body.source,
            manifestSha: stagedManifestSha,
            permissions: parsedPermissions,
          })
          rmSync(stagingDir, { recursive: true, force: true })
          return Response.json({
            ok: false,
            awaitingConsent: true,
            manifestChanged: true,
            id,
            version: versionForPrompt,
            permissions: parsedPermissions,
            consentToken: freshToken,
          })
        }
      }

      const targetDir = join(pluginsRoot, id)
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true })
      }
      cpSync(stagingDir, targetDir, { recursive: true })
      rmSync(stagingDir, { recursive: true, force: true })

      // Compile the plugin to dist/ so the runtime loader (Phase F) and
      // the server-side dynamic import (plugin-registry) have built
      // artifacts ready on next boot. Failures here are fatal for the
      // install request — shipping an installed-but-unbuilt plugin would
      // crash startup instead of surfacing the error to the user now.
      try {
        await buildUserPlugin(targetDir)
      } catch (buildErr) {
        // Build failed — clean up the installed files so the install
        // appears atomic from the user's perspective.
        rmSync(targetDir, { recursive: true, force: true })
        const message = buildErr instanceof Error ? buildErr.message : String(buildErr)
        log.error('Plugin install build step failed', buildErr as Error, { id })
        return Response.json({
          ok: false,
          error: `Installed "${id}" but failed to build it: ${message}`,
        }, { status: 500 })
      }

      // For local installs, record the resolved absolute source path so the
      // upgrade flow can re-resolve it deterministically from any cwd.
      const recordedSource = body.type === 'local'
        ? (isAbsolute(body.source) ? body.source : resolve(process.cwd(), body.source))
        : body.source
      recordInstall({
        id,
        targetDir,
        manifestSha: stagedManifestSha,
        manifest,
        source: recordedSource,
        type: body.type,
        permissions: parsedPermissions,
      })

      log.info(`Installed plugin "${id}"`, { source: body.source, type: body.type })

      return Response.json({
        ok: true,
        id,
        message: `Installed "${id}". Restart Bakin to load the plugin.`,
      })
    } catch (err) {
      rmSync(stagingDir, { recursive: true, force: true })
      throw err
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('Plugin install failed', err as Error, { source: body.source })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
