/**
 * Source fetcher for agent-package installs.
 *
 * Resolves a user-supplied source spec into a staging directory + a pinned
 * commit SHA. The installer (Phase E-5) calls this once per install /
 * dependency, then validates the manifest, then projects the package.
 *
 * Two source kinds:
 *
 *   - **Local path** — relative or absolute path on the user's filesystem.
 *     Refused if it escapes their HOME or the current working directory
 *     (path-traversal guard, mirrors `packages/host/src/api/plugins/
 *     install.ts`). Copied (not symlinked) to staging so the installer's
 *     subsequent atomic-rename pattern works regardless of which volume
 *     the source lived on. Commit SHA is empty for local sources — if
 *     the user actually wants a pinned commit, they should pass
 *     `github:user/repo@<sha>`.
 *
 *   - **github** — `github:user/repo[@ref][#subpath]` form. The sync path
 *     clones with `--depth 1 --branch <ref>` first; if that fails (commit
 *     SHAs aren't accepted by --branch), it falls back to a deeper clone +
 *     checkout. The async install path uses a shared cached checkout so
 *     onboarding can install multiple subpaths from the same repo without
 *     redownloading it.
 *     Commit SHA is read via `git rev-parse HEAD` after checkout.
 *     When `#subpath` is present, only that directory is staged as the
 *     package source.
 *
 * Bare names like `pixel` (no prefix and not a path) are explicitly
 * rejected — the spec says "use github:user/repo[@ref][#subpath] or a
 * local path" and pretending bare names are valid would let typos silently
 * succeed.
 *
 * Pure failure mode: any error inside the fetch path cleans up the
 * staging directory before throwing. Callers never have to clean up.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { execFileSync, spawn } from 'child_process'
import { homedir, tmpdir } from 'os'
import { isAbsolute, join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { createLogger } from '../logger'
import { getContentDir } from '../content-dir'
import {
  materializeCachedGithubSource,
  type AsyncGitRunner,
} from '../github-source-cache'
import { getStagingDir, getPackagesRoot } from '../../../packages/core/src/agent-packages/package-paths'
import { checkSubpath } from '../../../packages/core/src/install-core/source-guards'
import { synthesizeSkillPack, type SynthesisSourceInfo } from './skill-synthesis'

const log = createLogger('agent-pkg:fetch')

export type SourceKind = 'local' | 'github'

export interface FetchedSource {
  /** Absolute path to the staging directory containing the package source. */
  stagingDir: string
  /** Resolved commit SHA — populated for github sources, empty string for local. */
  commitSha: string
  /** Echoed back from the input so callers don't have to re-parse the source. */
  kind: SourceKind
  /** The original ref string (tag/branch/sha for github; '' for local). */
  ref: string
  /** Present when the source was a raw skill bundle synthesized in staging (#687). */
  synthesis?: { skillName: string; warnings: string[]; mentions: string[] }
}

interface ParsedGithubSpec {
  owner: string
  repo: string
  /** ref is null when none was specified — installer falls back to default branch. */
  ref: string | null
  /** Monorepo path inside the clone; empty string when none was specified. */
  subpath: string
}

// ─── Source parsing ──────────────────────────────────────────────────────────

const GITHUB_PREFIX = 'github:'

/** True iff the input looks like a github source spec. */
function isGithubSource(source: string): boolean {
  return source.startsWith(GITHUB_PREFIX)
}

/** True iff the input looks like a filesystem path (relative or absolute). */
function isLocalPath(source: string): boolean {
  return (
    source.startsWith('./') ||
    source.startsWith('../') ||
    source.startsWith('/') ||
    source.startsWith('~/')
  )
}

function assertSubpathValid(source: string, subpath: string): void {
  // Rules live in the shared install-core guard; this function owns only the
  // agent-package-side message wording (preserved exactly).
  switch (checkSubpath(subpath)) {
    case 'empty':
      throw new Error(`Malformed github source: "${source}" — subpath after # must not be empty`)
    case 'invalid-chars':
      throw new Error(
        `Malformed github source: "${source}" — subpath must match /^[A-Za-z0-9._/-]+$/`,
      )
    case 'leading-or-trailing-slash':
      throw new Error(
        `Malformed github source: "${source}" — subpath must not start or end with "/"`,
      )
    case 'dot-segment':
      throw new Error(
        `Malformed github source: "${source}" — subpath must not contain . or .. segments`,
      )
  }
}

/**
 * Parse `github:user/repo[@ref][#subpath]` into its parts. Throws on malformed
 * input — the manifest's zod schema accepts a wider class of source strings,
 * but the fetcher needs the exact `<owner>/<repo>` shape, optional ref, and
 * safe optional subpath.
 */
export function parseGithubSpec(source: string): ParsedGithubSpec {
  if (!isGithubSource(source)) {
    throw new Error(`Not a github source: "${source}"`)
  }
  const hashParts = source.split('#')
  if (hashParts.length > 2) {
    throw new Error(`Malformed github source: "${source}" — subpath may contain only one #`)
  }

  const subpath = hashParts.length === 2 ? hashParts[1] : ''
  if (hashParts.length === 2) assertSubpathValid(source, subpath)

  const body = hashParts[0].slice(GITHUB_PREFIX.length)
  const [pathPart, refPart] = body.split('@', 2)
  const pathSegments = pathPart.split('/')
  if (pathSegments.length !== 2 || !pathSegments[0] || !pathSegments[1]) {
    throw new Error(
      `Malformed github source: "${source}" — expected github:owner/repo[@ref][#subpath]`,
    )
  }
  return {
    owner: pathSegments[0],
    repo: pathSegments[1],
    ref: refPart && refPart.length > 0 ? refPart : null,
    subpath,
  }
}

export function sourceSpecWithRef(source: string, ref: string | null | undefined): string {
  if (!isGithubSource(source) || !ref) return source

  const hashIndex = source.indexOf('#')
  const sourceHead = hashIndex === -1 ? source : source.slice(0, hashIndex)
  const sourceTail = hashIndex === -1 ? '' : source.slice(hashIndex)
  if (sourceHead.includes('@')) return source
  return `${sourceHead}@${ref}${sourceTail}`
}

// ─── Path safety ─────────────────────────────────────────────────────────────

/**
 * Resolve a local source string against the user's home (`~/`) or the
 * current working directory (relative paths) and refuse anything that
 * escapes both.
 */
function resolveLocalPath(source: string): string {
  let resolved: string
  if (source.startsWith('~/')) {
    resolved = join(homedir(), source.slice(2))
  } else if (isAbsolute(source)) {
    resolved = source
  } else {
    resolved = resolve(process.cwd(), source)
  }
  return resolved
}

function ensureSafeLocalPath(absPath: string): void {
  // The literal resolved path must live under a user-writable root. We accept:
  //   - ~/                — the user's home
  //   - cwd               — the directory bakin was invoked from
  //   - os.tmpdir()       — for fixtures, build artifacts, and tests
  // The cpSync call below uses dereference:false so symlinks under a safe
  // root that point outside still don't escape — they'd land in staging
  // as symlinks (not their resolved targets) and the projector refuses to
  // copy symlinks regardless.
  const home = homedir()
  const cwd = process.cwd()
  const tmp = tmpdir()
  for (const safeRoot of [home, cwd, tmp]) {
    if (absPath === safeRoot || absPath.startsWith(safeRoot + '/')) return
  }
  throw new Error(
    `Refusing to install from "${absPath}" — local sources must live under your home, cwd, or temp dir.`,
  )
}

// ─── Staging ─────────────────────────────────────────────────────────────────

function ensureStagingRoot(): void {
  const root = getPackagesRoot(getContentDir())
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
}

function freshStagingDir(label: string): string {
  ensureStagingRoot()
  return getStagingDir(getContentDir(), `${label}-${Date.now()}-${randomUUID()}`)
}

function cleanupStaging(stagingDir: string): void {
  if (existsSync(stagingDir)) {
    try {
      rmSync(stagingDir, { recursive: true, force: true })
    } catch (err) {
      log.warn('Failed to clean up staging dir', {
        stagingDir,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// ─── Manifest validation (presence only — full zod parse happens in installer) ─

/**
 * A staged source must either be a real pack (bakin-package.json) or a raw
 * Agent-Skills bundle (SKILL.md at root, #687) — the latter is synthesized
 * IN PLACE into a skill-pack so everything downstream sees a normal pack.
 * Anything else throws the classic missing-manifest error, with the bundle
 * shape mentioned so hub users get a hint.
 */
function ensureInstallableStaging(stagingDir: string, sourceInfo: SynthesisSourceInfo): FetchedSource['synthesis'] {
  if (existsSync(join(stagingDir, 'bakin-package.json'))) return undefined
  const hasSkillMd = readdirSync(stagingDir, { withFileTypes: true })
    .some((e) => e.isFile() && /^skill\.md$/i.test(e.name))
  if (!hasSkillMd) {
    throw new Error(
      `Source is missing bakin-package.json (and has no SKILL.md, so it is not a raw skill bundle either): ${stagingDir}`,
    )
  }
  const result = synthesizeSkillPack(stagingDir, sourceInfo)
  if (!result.ok) throw new Error(`Cannot install skill bundle: ${result.error}`)
  return { skillName: result.skillName, warnings: result.warnings, mentions: result.mentions }
}

function resolveGithubSubpath(cloneDir: string, subpath: string): string {
  const cloneRoot = resolve(cloneDir)
  const subpathDir = resolve(cloneDir, subpath)
  if (subpathDir !== cloneRoot && !subpathDir.startsWith(cloneRoot + '/')) {
    throw new Error(`Github source subpath "${subpath}" escapes the cloned repository`)
  }
  return subpathDir
}

function ensureGithubSubpathPackagePresent(cloneDir: string, subpath: string): string {
  const subpathDir = resolveGithubSubpath(cloneDir, subpath)
  if (!existsSync(subpathDir) || !statSync(subpathDir).isDirectory()) {
    throw new Error(`Github source subpath "${subpath}" not found in repository`)
  }
  // Manifest OR raw skill bundle — ensureInstallableStaging on the copied
  // staging decides (raw bundles are synthesized there, #687).
  return subpathDir
}

// ─── Local fetch ─────────────────────────────────────────────────────────────

function fetchLocal(source: string): FetchedSource {
  const absSource = resolveLocalPath(source)
  ensureSafeLocalPath(absSource)
  if (!existsSync(absSource)) {
    throw new Error(`Source path does not exist: ${absSource}`)
  }
  if (!statSync(absSource).isDirectory()) {
    throw new Error(`Source path is not a directory: ${absSource}`)
  }

  const stagingDir = freshStagingDir('local')
  let synthesis: FetchedSource['synthesis']
  try {
    mkdirSync(stagingDir, { recursive: true })
    cpSync(absSource, stagingDir, { recursive: true, dereference: false })
    synthesis = ensureInstallableStaging(stagingDir, { source })
  } catch (err) {
    cleanupStaging(stagingDir)
    throw err
  }
  return { stagingDir, commitSha: '', kind: 'local', ref: '', ...(synthesis ? { synthesis } : {}) }
}

// ─── Github fetch ────────────────────────────────────────────────────────────

interface GitRunner {
  /** Run `git <args>` and return stdout; throw on non-zero exit. */
  (args: string[]): string
}

const realGit: GitRunner = (args) =>
  execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf-8')

const realGitAsync: AsyncGitRunner = (args) => new Promise((resolve, reject) => {
  const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''

  child.stdout.setEncoding('utf-8')
  child.stderr.setEncoding('utf-8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('error', reject)
  child.on('close', code => {
    if (code === 0) {
      resolve(stdout)
      return
    }
    reject(new Error(stderr.trim() || `git ${args.join(' ')} exited with code ${code}`))
  })
})

/**
 * Internal helper — split out so unit tests can pass a mock runner.
 */
export function fetchGithubWithRunner(
  source: string,
  git: GitRunner,
  staging: string,
): FetchedSource {
  const spec = parseGithubSpec(source)
  const url = `https://github.com/${spec.owner}/${spec.repo}.git`
  const cloneTarget = spec.subpath ? `${staging}.clone` : staging

  cleanupStaging(staging)
  if (spec.subpath) cleanupStaging(cloneTarget)
  mkdirSync(staging, { recursive: true })

  try {
    if (spec.ref) {
      // Try the cheap path first: shallow clone of a tag or branch. This
      // fails if `ref` is a commit SHA (--branch refuses arbitrary SHAs);
      // we fall back to a deeper clone + checkout in that case.
      try {
        git(['clone', '--depth', '1', '--branch', spec.ref, url, cloneTarget])
      } catch {
        cleanupStaging(cloneTarget)
        if (!spec.subpath) mkdirSync(cloneTarget, { recursive: true })
        git(['clone', '--depth', '50', url, cloneTarget])
        git(['-C', cloneTarget, 'checkout', spec.ref])
      }
    } else {
      // No ref — clone the default branch shallowly.
      git(['clone', '--depth', '1', url, cloneTarget])
    }

    if (spec.subpath) {
      const packageDir = ensureGithubSubpathPackagePresent(cloneTarget, spec.subpath)
      cpSync(packageDir, staging, { recursive: true, dereference: false })
    }

    const commitSha = git(['-C', cloneTarget, 'rev-parse', 'HEAD']).trim()
    const synthesis = ensureInstallableStaging(staging, {
      source,
      ref: spec.ref ?? undefined,
      resolvedSha: commitSha,
    })
    if (spec.subpath) cleanupStaging(cloneTarget)
    return { stagingDir: staging, commitSha, kind: 'github', ref: spec.ref ?? '', ...(synthesis ? { synthesis } : {}) }
  } catch (err) {
    cleanupStaging(staging)
    if (spec.subpath) cleanupStaging(cloneTarget)
    throw err
  }
}

export async function fetchGithubWithRunnerAsync(
  source: string,
  git: AsyncGitRunner,
  staging: string,
): Promise<FetchedSource> {
  const spec = parseGithubSpec(source)
  const url = `https://github.com/${spec.owner}/${spec.repo}.git`

  cleanupStaging(staging)
  mkdirSync(staging, { recursive: true })

  try {
    const checkout = await materializeCachedGithubSource({
      cloneUrl: url,
      ref: spec.ref ?? undefined,
      stagingDir: staging,
      subpath: spec.subpath || undefined,
      git,
    })
    const synthesis = ensureInstallableStaging(staging, {
      source,
      ref: spec.ref ?? undefined,
      resolvedSha: checkout.commitSha,
    })
    return { stagingDir: staging, commitSha: checkout.commitSha, kind: 'github', ref: spec.ref ?? '', ...(synthesis ? { synthesis } : {}) }
  } catch (err) {
    cleanupStaging(staging)
    throw err
  }
}

function fetchGithub(source: string): FetchedSource {
  const staging = freshStagingDir('github')
  try {
    return fetchGithubWithRunner(source, realGit, staging)
  } catch (err) {
    cleanupStaging(staging)
    throw err
  }
}

async function fetchGithubAsync(source: string): Promise<FetchedSource> {
  const staging = freshStagingDir('github')
  try {
    return await fetchGithubWithRunnerAsync(source, realGitAsync, staging)
  } catch (err) {
    cleanupStaging(staging)
    throw err
  }
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Fetch a package source into a staging directory. Throws on malformed
 * source spec, escaped paths, missing manifest, or git failures. Callers
 * are responsible for moving the staging dir into the final install
 * location and cleaning it up after success.
 */
export function fetchSource(source: string): FetchedSource {
  if (typeof source !== 'string' || source.length === 0) {
    throw new Error('Source must be a non-empty string')
  }
  if (isGithubSource(source)) return fetchGithub(source)
  if (isLocalPath(source)) return fetchLocal(source)

  // Bare name → explicit error per Q5 of the spec refinement.
  throw new Error(
    `"${source}" is not a valid source. Use github:user/repo[@ref][#subpath] or a local path (./, ../, /, ~/).`,
  )
}

export async function fetchSourceAsync(source: string): Promise<FetchedSource> {
  if (typeof source !== 'string' || source.length === 0) {
    throw new Error('Source must be a non-empty string')
  }
  if (isGithubSource(source)) return await fetchGithubAsync(source)
  if (isLocalPath(source)) return fetchLocal(source)

  throw new Error(
    `"${source}" is not a valid source. Use github:user/repo[@ref][#subpath] or a local path (./, ../, /, ~/).`,
  )
}
