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
 * In a running Bakin server the installed plugin is activated immediately.
 * If this endpoint is exercised before the plugin registry has booted,
 * activation is deferred until the next server start.
 */
import { existsSync, readFileSync, mkdirSync, cpSync, rmSync, statSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { join, basename, resolve, isAbsolute, sep } from 'path'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { getContentDir } from '@/core/content-dir'
import { materializeCachedGithubSource } from '@/core/github-source-cache'
import { createLogger } from '@/core/logger'
import { isCorePlugin } from '@/core/plugin-registry'
import { buildUserPlugin } from '../../plugin-host/user-plugin-builder'
import { githubArtifactSource } from '@/core/whiskit/github-resolver'
import type { WhiskitArtifactLocation } from '@/core/whiskit/resolver'
import { downloadToFile } from '@/core/whiskit/download'
import { safeExtractArtifact, verifyChecksum } from '@/core/whiskit/artifact'
import { readProvenance, PROVENANCE_FILENAME } from '@/core/whiskit/provenance'
import {
  addPlugin,
  readPluginLockfile,
  writePluginLockfile,
  type PluginLockEntry,
} from '@bakin/core/plugins/lockfile'
import { getSettings } from '@bakin/core/settings'
import { parseManifestPermissions } from '@bakin/core/plugins/permissions'
import { PLUGIN_ID_RE, readPluginManifestJson, PluginManifestError } from '@bakin/core/plugins/manifest'
import { verifyPluginManifestSignature } from '@bakin/core/plugins/signatures'
import { parseGithubSource, InvalidGithubSourceError, assertGitRefValid } from '@bakin/core/plugins/source'
import { computeSourceTreeSha } from '@/core/plugins/upgrade'
import { checkPluginDependencies } from '@/core/plugins/dependencies'
import { signConsentToken, verifyConsentToken } from '@/core/plugins/consent-token'
import { findSkillsForPlugin } from '@/core/onboarding/plugin-assets'
import { appendAudit } from '@/core/audit'
import { linkPlugin, LinkRefusedError } from '@/core/plugins/link'
import {
  activateUserPluginDir,
  isLiveActivationUnavailable,
  watchLinkedPluginIfEnabled,
} from '@/core/plugins/live-lifecycle'

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
function resolveGitProvenance(
  targetDir: string,
  type: 'github' | 'local',
  requestedRef = '',
): { ref: string; commitSha: string } {
  if (type === 'local') return { ref: '', commitSha: '' }
  let ref = requestedRef
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
  if (!ref) {
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
  gitProvenance?: { ref: string; commitSha: string }
}): void {
  const { id, targetDir, manifestSha, manifest, source, type } = args
  try {
    const { ref, commitSha } = args.gitProvenance ?? resolveGitProvenance(targetDir, type)

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

    // Record the runtime skills this plugin shipped — used as the
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
  /** Optional git ref to install for github sources. */
  ref?: string
  /** Developer-mode local install: symlink source and watch/reload it. */
  dev?: boolean
  /** Used with dev=true to replace an existing install/link for the same id. */
  force?: boolean
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
 * Thin adapter over the shared `parseGithubSource` parser — kept as a
 * named function returning the result/error tuple so the caller's
 * existing branching shape doesn't change.
 */
function resolveGithubCloneUrl(
  rawSource: string,
): { ok: true; url: string; subpath: string; ref: string } | { ok: false; error: string } {
  try {
    const parsed = parseGithubSource(rawSource)
    return { ok: true, url: parsed.cloneUrl, subpath: parsed.subpath, ref: parsed.ref ?? '' }
  } catch (err) {
    if (err instanceof InvalidGithubSourceError) return { ok: false, error: err.message }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function consentSourceIdentity(source: string, ref: string): string {
  return ref ? JSON.stringify({ source, ref }) : source
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
  if (body.ref !== undefined) {
    if (typeof body.ref !== 'string') {
      return Response.json({ ok: false, error: 'ref must be a string' }, { status: 400 })
    }
    try {
      assertGitRefValid(body.ref)
    } catch (err) {
      return Response.json({
        ok: false,
        error: err instanceof InvalidGithubSourceError ? err.message : String(err),
      }, { status: 400 })
    }
    if (body.type !== 'github') {
      return Response.json({ ok: false, error: '--ref only applies to github plugin installs' }, { status: 400 })
    }
  }
  if (body.dev !== undefined && typeof body.dev !== 'boolean') {
    return Response.json({ ok: false, error: 'dev must be a boolean' }, { status: 400 })
  }
  if (body.force !== undefined && typeof body.force !== 'boolean') {
    return Response.json({ ok: false, error: 'force must be a boolean' }, { status: 400 })
  }
  if (body.dev === true) {
    if (body.type !== 'local') {
      return Response.json({
        ok: false,
        error: 'dev installs only support local plugin paths; clone the source locally and run `bakin plugins install --dev <path>`',
      }, { status: 400 })
    }
    try {
      const result = await linkPlugin(body.source, { force: body.force === true })
      let runtimeVersion: number | undefined
      let activated = false
      try {
        const activation = await activateUserPluginDir(result.pluginDir)
        runtimeVersion = activation.runtimeVersion
        activated = true
      } catch (activationErr) {
        if (!isLiveActivationUnavailable(activationErr)) throw activationErr
      }
      const watching = activated
        ? await watchLinkedPluginIfEnabled(result.id, result.linkedSource)
        : false
      log.info(`Dev-installed plugin "${result.id}"`, {
        source: result.linkedSource,
        version: result.version,
        activated,
        watching,
      })
      return Response.json({
        ok: true,
        id: result.id,
        pluginDir: result.pluginDir,
        linkedSource: result.linkedSource,
        version: result.version,
        ...(runtimeVersion !== undefined ? { runtimeVersion } : {}),
        activated,
        watching,
        message: activated
          ? `Dev-installed "${result.id}" and activated it${watching ? ' with hot reload' : ''}.`
          : `Dev-installed "${result.id}". It will activate on the next Bakin start.`,
      })
    } catch (err) {
      if (err instanceof LinkRefusedError) {
        return Response.json({ ok: false, error: err.message }, { status: 400 })
      }
      const message = err instanceof Error ? err.message : String(err)
      log.error('Plugin dev install failed', err as Error, { source: body.source })
      return Response.json({ ok: false, error: message }, { status: 500 })
    }
  }

  const pluginsRoot = join(getContentDir(), 'plugins')
  if (!existsSync(pluginsRoot)) mkdirSync(pluginsRoot, { recursive: true })

  try {
    const stagingDir = join(pluginsRoot, `.staging-${Date.now()}`)
    mkdirSync(stagingDir, { recursive: true })

    try {
      // `effectivePluginDir` points at the directory whose `bakin-plugin.json`
      // we read and whose contents we copy into `~/.bakin/plugins/<id>/`.
      // For local installs and github installs without a subpath this is the
      // staging dir itself; for github monorepo installs
      // (`github:user/repo#plugins/foo`) it is `<stagingDir>/<subpath>`.
      let effectivePluginDir: string = stagingDir
      let requestedRef = ''
      let gitProvenance: { ref: string; commitSha: string } | undefined
      // True when a published Whiskit artifact was installed (already built —
      // skip the source build step).
      let installedFromArtifact = false

      if (body.type === 'local') {
        if (body.source.includes('#')) {
          rmSync(stagingDir, { recursive: true, force: true })
          auditInstallRejected('local_subpath_unsupported', body.source)
          return Response.json({
            ok: false,
            error: 'local install paths cannot use `#subpath`; point directly at the plugin directory instead',
          }, { status: 400 })
        }
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
        if (body.ref && parsedUrl.ref && body.ref !== parsedUrl.ref) {
          rmSync(stagingDir, { recursive: true, force: true })
          auditInstallRejected('ref_conflict', body.source, { sourceRef: parsedUrl.ref, bodyRef: body.ref })
          return Response.json({
            ok: false,
            error: `conflicting refs: source uses "${parsedUrl.ref}" but request body uses "${body.ref}"`,
          }, { status: 400 })
        }
        requestedRef = body.ref ?? parsedUrl.ref

        // Whiskit: for a subpath github source, prefer a published artifact
        // (toolchain-free). The plugin is identified by the subpath. Only fall
        // back to git-clone + build when no published artifact exists; a
        // verify/extract failure AFTER a match is a hard error (never silently
        // build a tampered artifact's source).
        if (parsedUrl.subpath) {
          const platform = `${process.platform}-${process.arch}`
          let location: WhiskitArtifactLocation | null = null
          try {
            const gh = githubArtifactSource(body.source)
            location = await gh.resolver.resolve(gh.pluginId, 'latest', platform)
          } catch {
            // No published index/release (or unresolvable) — fall back to source.
            location = null
          }
          if (location) {
            const tarball = join(stagingDir, '.whiskit-artifact.tar.gz')
            await downloadToFile(location.artifactUrl, tarball)
            await verifyChecksum(tarball, location.sha256)
            await safeExtractArtifact(tarball, stagingDir)
            rmSync(tarball, { force: true })
            effectivePluginDir = stagingDir
            const prov = readProvenance(join(stagingDir, '.whiskit', PROVENANCE_FILENAME))
            gitProvenance = { ref: requestedRef, commitSha: prov.sourceCommitSha }
            installedFromArtifact = true
          }
        }

        if (!installedFromArtifact) {
          try {
            await materializeCachedGithubSource({
              cloneUrl: parsedUrl.url,
              ref: requestedRef || undefined,
              stagingDir,
            })
            gitProvenance = resolveGitProvenance(stagingDir, body.type, requestedRef)
          } catch (err) {
            rmSync(stagingDir, { recursive: true, force: true })
            const message = err instanceof Error ? err.message : String(err)
            auditInstallRejected('git_clone_failed', body.source, { ref: requestedRef, error: message })
            return Response.json({ ok: false, error: message }, { status: 400 })
          }

          if (parsedUrl.subpath) {
            // `parseGithubSource` already rejects `..` segments and leading
            // slashes, so this `join` cannot escape `stagingDir`. Belt + suspenders:
            // re-confirm containment before reading files from it.
            const candidate = join(stagingDir, parsedUrl.subpath)
            const stagingReal = realpathSync(stagingDir)
            let candidateReal: string
            try {
              candidateReal = realpathSync(candidate)
            } catch {
              rmSync(stagingDir, { recursive: true, force: true })
              auditInstallRejected('subpath_missing', body.source, { subpath: parsedUrl.subpath })
              return Response.json({
                ok: false,
                error: `subpath "${parsedUrl.subpath}" not found in repository`,
              }, { status: 400 })
            }
            if (!candidateReal.startsWith(stagingReal + sep) && candidateReal !== stagingReal) {
              rmSync(stagingDir, { recursive: true, force: true })
              auditInstallRejected('subpath_traversal', body.source, { subpath: parsedUrl.subpath })
              return Response.json({
                ok: false,
                error: `subpath "${parsedUrl.subpath}" escapes the cloned repository`,
              }, { status: 400 })
            }
            effectivePluginDir = candidateReal
          }
        }
      }

      // Validate manifest
      const manifestPath = join(effectivePluginDir, 'bakin-plugin.json')
      if (!existsSync(manifestPath)) {
        rmSync(stagingDir, { recursive: true, force: true })
        const where = effectivePluginDir === stagingDir
          ? 'Plugin source is missing bakin-plugin.json'
          : `subpath "${body.source.split('#')[1] ?? ''}" is missing bakin-plugin.json`
        return Response.json({ ok: false, error: where }, { status: 400 })
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

      let manifest: Record<string, unknown> & { id: string; version: string }
      let rawManifest: unknown
      try {
        const manifestText = readFileSync(manifestPath, 'utf-8')
        manifest = readPluginManifestJson(manifestText) as unknown as Record<string, unknown> & { id: string; version: string }
        rawManifest = JSON.parse(manifestText)
      } catch (err) {
        rmSync(stagingDir, { recursive: true, force: true })
        return Response.json({
          ok: false,
          error: err instanceof PluginManifestError ? err.message : 'Invalid bakin-plugin.json',
        }, { status: 400 })
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

      try {
        verifyPluginManifestSignature(rawManifest, getSettings().plugins)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        rmSync(stagingDir, { recursive: true, force: true })
        auditInstallRejected('signature_verification_failed', body.source, { id, error: message })
        return Response.json({
          ok: false,
          error: `plugin "${id}": ${message}`,
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
        return Response.json({
          ok: false,
          error: `Plugin "${id}" dependency check failed: ${problems}. Install dependencies first, then retry.`,
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
        const consentSource = consentSourceIdentity(body.source, requestedRef)
        const consentToken = signConsentToken({
          source: consentSource,
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
        const consentSource = consentSourceIdentity(body.source, requestedRef)
        if (token.source !== consentSource) {
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
            source: consentSource,
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
      // Copy from the effective plugin dir (the subpath for monorepo
      // installs, the staging root otherwise). This intentionally drops
      // the rest of the cloned repo + its `.git/` for subpath installs;
      // the subpath upgrade flow re-clones to staging since there's no
      // local `.git/` to fetch into.
      cpSync(effectivePluginDir, targetDir, { recursive: true, dereference: false })
      rmSync(stagingDir, { recursive: true, force: true })

      // Compile the plugin to dist/ so the runtime loader (Phase F) and
      // the server-side dynamic import (plugin-registry) have built
      // artifacts ready on next boot. Failures here are fatal for the
      // install request — shipping an installed-but-unbuilt plugin would
      // crash startup instead of surfacing the error to the user now.
      //
      // A Whiskit artifact install is already built (dist/ shipped + verified),
      // so the build step is skipped entirely.
      if (!installedFromArtifact) {
        try {
          // A source install must never execute a dist/ it shipped with —
          // only provenance-verified artifacts skip the rebuild. Deleting
          // the copied dist also closes the freshness-check mtime race
          // (cpSync stamps everything ~now; a tie would skip the compile).
          rmSync(join(targetDir, 'dist'), { recursive: true, force: true })
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
        gitProvenance,
      })

      let runtimeVersion: number | undefined
      let activated = false
      try {
        const activation = await activateUserPluginDir(targetDir)
        runtimeVersion = activation.runtimeVersion
        activated = true
      } catch (activationErr) {
        if (isLiveActivationUnavailable(activationErr)) {
          log.info('Plugin installed outside a running registry; activation deferred until next start', { id })
        } else {
          const message = activationErr instanceof Error ? activationErr.message : String(activationErr)
          log.error('Plugin install activation failed', activationErr as Error, { id })
          return Response.json({
            ok: false,
            id,
            error: `Installed "${id}" but failed to activate it: ${message}`,
          }, { status: 500 })
        }
      }

      log.info(`Installed plugin "${id}"`, { source: body.source, type: body.type, ref: requestedRef })

      return Response.json({
        ok: true,
        id,
        ...(runtimeVersion !== undefined ? { runtimeVersion } : {}),
        activated,
        message: activated
          ? `Installed "${id}" and activated it.`
          : `Installed "${id}". It will activate on the next Bakin start.`,
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
