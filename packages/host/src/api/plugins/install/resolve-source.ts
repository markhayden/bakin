/**
 * Install phase (b) — source resolution into the staging directory.
 *
 * Local sources are realpath-resolved and contained to the trusted roots;
 * github sources are parsed/validated before any `git` invocation, with a
 * published Whiskit artifact preferred over a source clone for subpath
 * installs. Every failure tears down the staging dir and returns the exact
 * error Response the monolithic handler produced.
 */
import { existsSync, cpSync, rmSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { join, resolve, isAbsolute, sep } from 'path'
import { execFileSync } from 'child_process'
import { getContentDir } from '@/core/content-dir'
import { materializeCachedGithubSource } from '@/core/github-source-cache'
import { githubArtifactSource } from '@/core/whiskit/github-resolver'
import type { WhiskitArtifactLocation } from '@/core/whiskit/resolver'
import { downloadToFile } from '@/core/whiskit/download'
import { safeExtractArtifact, verifyChecksum } from '@/core/whiskit/artifact'
import { readProvenance, PROVENANCE_FILENAME } from '@/core/whiskit/provenance'
import { parseGithubSource, InvalidGithubSourceError } from '@bakin/core/plugins/source'
import { auditInstallRejected } from './audit'
import type { InstallBody } from './body'

/**
 * Resolve git provenance for a freshly installed plugin dir. Returns empty
 * strings for either field if the corresponding git command fails — happens
 * for local installs (no .git/) and for github installs in detached-HEAD
 * state. Both failures are non-fatal; the lockfile records the honest
 * emptiness rather than fabricating a synthetic value.
 */
export function resolveGitProvenance(
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
 * Resolve a local install source to an absolute path AND verify it lives
 * under one of the trusted roots. Symlinks are followed so a foo→/etc
 * shortcut can't sneak past containment.
 *
 * Trusted roots: ~/.bakin/, $HOME, process.cwd(). Anything else is a
 * path-traversal attempt or a misconfiguration; reject.
 */
export function resolveAndContainLocalSource(rawSource: string): { ok: true; path: string } | { ok: false; error: string } {
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
export function resolveGithubCloneUrl(
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

/** Result of staging an install source — inputs to the validate + commit phases. */
export interface StagedSource {
  /**
   * `effectivePluginDir` points at the directory whose `bakin-plugin.json`
   * we read and whose contents we copy into `~/.bakin/plugins/<id>/`.
   * For local installs and github installs without a subpath this is the
   * staging dir itself; for github monorepo installs
   * (`github:user/repo#plugins/foo`) it is `<stagingDir>/<subpath>`.
   */
  effectivePluginDir: string
  requestedRef: string
  gitProvenance: { ref: string; commitSha: string } | undefined
  /**
   * True when a published Whiskit artifact was installed (already built —
   * skip the source build step).
   */
  installedFromArtifact: boolean
}

/**
 * Populate `stagingDir` from the requested source (local copy, Whiskit
 * artifact, or git clone). On failure the staging dir has already been
 * removed and `response` is the exact error the client should receive.
 */
export async function stageInstallSource(
  body: InstallBody,
  stagingDir: string,
): Promise<{ ok: true; staged: StagedSource } | { ok: false; response: Response }> {
  let effectivePluginDir: string = stagingDir
  let requestedRef = ''
  let gitProvenance: { ref: string; commitSha: string } | undefined
  let installedFromArtifact = false

  if (body.type === 'local') {
    if (body.source.includes('#')) {
      rmSync(stagingDir, { recursive: true, force: true })
      auditInstallRejected('local_subpath_unsupported', body.source)
      return {
        ok: false,
        response: Response.json({
          ok: false,
          error: 'local install paths cannot use `#subpath`; point directly at the plugin directory instead',
        }, { status: 400 }),
      }
    }
    const contained = resolveAndContainLocalSource(body.source)
    if (!contained.ok) {
      rmSync(stagingDir, { recursive: true, force: true })
      auditInstallRejected('path_traversal', body.source, { error: contained.error })
      return { ok: false, response: Response.json({ ok: false, error: contained.error }, { status: 400 }) }
    }
    cpSync(contained.path, stagingDir, { recursive: true, dereference: false })
  } else {
    const parsedUrl = resolveGithubCloneUrl(body.source)
    if (!parsedUrl.ok) {
      rmSync(stagingDir, { recursive: true, force: true })
      auditInstallRejected('invalid_github_url', body.source, { error: parsedUrl.error })
      return { ok: false, response: Response.json({ ok: false, error: parsedUrl.error }, { status: 400 }) }
    }
    if (body.ref && parsedUrl.ref && body.ref !== parsedUrl.ref) {
      rmSync(stagingDir, { recursive: true, force: true })
      auditInstallRejected('ref_conflict', body.source, { sourceRef: parsedUrl.ref, bodyRef: body.ref })
      return {
        ok: false,
        response: Response.json({
          ok: false,
          error: `conflicting refs: source uses "${parsedUrl.ref}" but request body uses "${body.ref}"`,
        }, { status: 400 }),
      }
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
        return { ok: false, response: Response.json({ ok: false, error: message }, { status: 400 }) }
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
          return {
            ok: false,
            response: Response.json({
              ok: false,
              error: `subpath "${parsedUrl.subpath}" not found in repository`,
            }, { status: 400 }),
          }
        }
        if (!candidateReal.startsWith(stagingReal + sep) && candidateReal !== stagingReal) {
          rmSync(stagingDir, { recursive: true, force: true })
          auditInstallRejected('subpath_traversal', body.source, { subpath: parsedUrl.subpath })
          return {
            ok: false,
            response: Response.json({
              ok: false,
              error: `subpath "${parsedUrl.subpath}" escapes the cloned repository`,
            }, { status: 400 }),
          }
        }
        effectivePluginDir = candidateReal
      }
    }
  }

  return { ok: true, staged: { effectivePluginDir, requestedRef, gitProvenance, installedFromArtifact } }
}
