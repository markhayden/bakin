/**
 * The package + hub-skill sources and everything they read (#1007 B): the
 * lockfile partition (D7.12), `git ls-remote`, staged manifest reads and the
 * ClawHub questions. Kept apart from the rest of the core wiring so the
 * in-process observer (`../observe.ts`) can build exactly these two sources
 * without the search/runtime factories the other kinds need.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { APP_VERSION } from '@bakin/core/constants'
import { gitArgs } from '@bakin/core/net/git-args'
import { getContentDir } from '../../content-dir'
import { createLogger } from '../../logger'
import { clawhubHasVersion, clawhubLatestVersion, fetchSourceAsync, parseGithubSpec, resolveLocalPath } from '../../agent-packages/source-fetcher'
import { canonicalPackageEntries, readLockfile, type PackageEntry } from '../../../../packages/core/src/agent-packages/lockfile'
import { parseManifest, type Manifest } from '../../../../packages/core/src/agent-packages/manifest'
import { computeDirSha } from '../../../../packages/core/src/agent-packages/markers'
import { getPackageSourceDir } from '../../../../packages/core/src/agent-packages/package-paths'
import type { UpdateSource } from '../types'
import { createHubSkillSource } from './hub-skill'
import { createPackageSource, isClawhubPackageSource, type InstalledPackage } from './package'

const log = createLogger('updates-sources')

/**
 * `git ls-remote` as an async child under the observe signal — never the
 * synchronous upgrade-gate wrapper (C15). Foreground-only git config via
 * `gitArgs`; an abort kills the child and the promise settles on exit.
 */
export async function lsRemoteSha(url: string, ref: string, signal: AbortSignal): Promise<string | null> {
  // git filters every output row against the patterns, the peeled `^{}` row
  // included — ask for both, or an annotated tag only ever shows its tag object.
  return pickLsRemoteSha(await runLsRemote(['ls-remote', '--', url, ref, `${ref}^{}`], `${url} ${ref}`, signal), ref)
}

/** The remote's default branch — what a clone without `--branch` checks out — or null when HEAD is unborn/detached. */
export async function lsRemoteDefaultBranch(url: string, signal: AbortSignal): Promise<string | null> {
  return pickDefaultBranch(await runLsRemote(['ls-remote', '--symref', '--', url, 'HEAD'], `${url} HEAD`, signal))
}

/** `ref: refs/heads/<name>\tHEAD` from `ls-remote --symref … HEAD`; a detached or unborn HEAD prints no such row. */
export function pickDefaultBranch(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    const match = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/.exec(line.trim())
    if (match) return match[1]!
  }
  return null
}

async function runLsRemote(args: string[], what: string, signal: AbortSignal): Promise<string> {
  const proc = Bun.spawn(['git', ...gitArgs(args)], { cwd: getContentDir(), stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  const onAbort = (): void => { try { proc.kill() } catch { /* already gone */ } }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  try {
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('ls-remote aborted')
    if (code !== 0) throw new Error(`git ls-remote ${what} failed (exit ${code}): ${stderr.trim().slice(-300)}`)
    return stdout
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * The commit `git clone --branch <ref>` would check out, from `ls-remote`
 * output (review r5 #3, r6 #3): ONLY an exact candidate — for a bare name
 * the branch first (clone prefers it), then the tag; for a fully qualified
 * `refs/...` name that ref itself — and for an annotated tag the PEELED
 * commit (`<tag>^{}`), never the tag object, which is what the lanes compare
 * against `HEAD`. A suffix match (`feature/main` for `main`), a
 * remote-tracking row or "the first row" is never an answer: when the
 * tracked ref is gone the result is null and the subject is blocked.
 */
export function pickLsRemoteSha(stdout: string, ref: string): string | null {
  const rows = stdout.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [sha, name] = line.split(/\s+/)
    return { sha: (sha ?? '').toLowerCase(), name: name ?? '' }
  }).filter((row) => /^[0-9a-f]{40}$/.test(row.sha))
  const exact = (name: string) => rows.find((row) => row.name === name)
  const candidates = ref.startsWith('refs/')
    ? [`${ref}^{}`, ref]
    : [`refs/heads/${ref}`, `refs/tags/${ref}^{}`, `refs/tags/${ref}`]
  for (const name of candidates) {
    const row = exact(name)
    if (row) return row.sha
  }
  return null
}

/**
 * Every installed agent package with its installed manifest's provenance
 * (D7.12): a skill-pack whose manifest carries `upstream` is a hub skill,
 * everything else a package — never both. When one id is installed under
 * several keys (a superseded version not yet forgotten), the newest wins.
 */
export function installedPackages(): InstalledPackage[] {
  // ONE selection per id (`canonicalPackageEntries`) shared with every lockfile consumer, so a superseded key still present never makes Team/Explore show one version beside another's record.
  return canonicalPackageEntries(readLockfile()).map(({ key, id, entry }) => {
    const read = installedPackageManifest(entry.kind, id, entry.version)
    const manifestUpstream = entry.kind === 'skill-pack' && read.manifest?.kind === 'skill-pack' && read.manifest.upstream ? read.manifest.upstream : null
    // Ownership (r6 #2, r7 #4): the ledger's `hub` flag first; otherwise a manifest with `upstream` OR a `clawhub:` lock
    // source (a hub by definition — a legacy manifest without `upstream` and an unreadable one alike) — never a silent
    // flip to "package". KNOWN LIMIT: an unflagged GITHUB hub skill whose manifest is unreadable is observed as a package
    // (blocked, "manifest unreadable — reinstall") until it is reinstalled.
    const hub = entry.hub ?? (manifestUpstream !== null || isClawhubPackageSource(entry.source))
    const upstream = manifestUpstream ?? (hub ? { source: entry.source } : null)
    return { key, id, entry, upstream, ...(read.error ? { manifestError: read.error } : {}), ...(read.manifest ? { manifestId: read.manifest.id } : {}) }
  })
}

/** The installed manifest, or the reason it could not be read — an absent file is neither (a pre-manifest install). */
function installedPackageManifest(kind: PackageEntry['kind'], id: string, version: string): { manifest: Manifest | null; error?: string } {
  const path = join(getPackageSourceDir(getContentDir(), kind, id, version), 'bakin-package.json')
  if (!existsSync(path)) return { manifest: null }
  try {
    return { manifest: parseManifest(JSON.parse(readFileSync(path, 'utf-8'))) }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.warn('installed package manifest unreadable — reported on its subject, never re-partitioned', { id, version, error })
    return { manifest: null, error }
  }
}

function packageCloneUrl(source: string): string {
  const spec = parseGithubSpec(source)
  return `https://github.com/${spec.owner}/${spec.repo}.git`
}

/** The manifest at a github source+ref: a staged clone (the fetcher's own temp dir), removed after; the git child dies with the signal. */
async function fetchPackageManifest(sourceWithRef: string, signal: AbortSignal, opts: { fresh?: boolean } = {}): Promise<{ id: string; version: string; commitSha: string; treeSha: string }> {
  const fetched = await fetchSourceAsync(sourceWithRef, { signal, fresh: opts.fresh })
  try {
    const manifest = parseManifest(JSON.parse(readFileSync(join(fetched.stagingDir, 'bakin-package.json'), 'utf-8')))
    // The staged folder is what an install commits byte for byte — the same digest the installed folder carries.
    return { id: manifest.id, version: manifest.version, commitSha: fetched.commitSha, treeSha: computeDirSha(fetched.stagingDir) }
  } finally {
    rmSync(fetched.stagingDir, { recursive: true, force: true })
  }
}

/** The installed package folder's digest, or null when it is missing or unreadable (never assumed current). */
function installedPackageTreeSha(pkg: InstalledPackage): string | null {
  const dir = getPackageSourceDir(getContentDir(), pkg.entry.kind, pkg.id, pkg.entry.version)
  if (!existsSync(dir)) return null
  try {
    return computeDirSha(dir)
  } catch (err) {
    log.warn('installed package folder unreadable — its update check falls back to the commit', { id: pkg.id, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/** The manifest of a local-path source — resolved the way the installer resolved it (`~/`, relative to cwd, absolute). */
export function localPackageManifest(path: string): { id: string; version: string } | null {
  const manifestPath = join(resolveLocalPath(path), 'bakin-package.json')
  if (!existsSync(manifestPath)) return null
  const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))
  return { id: manifest.id, version: manifest.version }
}



/** The `package` and `hub-skill` sources over this home, in that order. */
export function createPackageUpdateSources(): UpdateSource[] {
  const packageDeps = {
    installed: installedPackages,
    hostVersion: () => APP_VERSION,
    cloneUrl: packageCloneUrl,
    lsRemote: lsRemoteSha,
    defaultBranch: lsRemoteDefaultBranch,
  }
  return [
    createPackageSource({
      ...packageDeps,
      fetchManifest: fetchPackageManifest,
      localManifest: localPackageManifest,
      installedTreeSha: installedPackageTreeSha,
    }),
    createHubSkillSource({
      ...packageDeps,
      hub: {
        latest: (slug, owner, signal) => clawhubLatestVersion({ slug, owner }, signal),
        hasVersion: (slug, version, owner, signal) => clawhubHasVersion({ slug, owner }, version, signal),
      },
    }),
  ]
}
