/**
 * The core update sources, registered once before `startUpdates` (#1007).
 * Everything here reads through the factories — the active runtime and
 * the configured search adapter's setup — never an adapter module.
 */
import { join } from 'node:path'
import { APP_VERSION } from '@bakin/core/constants'
import { gitArgs } from '@bakin/core/net/git-args'
import { readPluginLockfile, type PluginLockEntry } from '@bakin/core/plugins/lockfile'
import { getContentDir } from '../../content-dir'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createLogger } from '../../logger'
import { compareStoredSourceTreeSha } from '../../plugins/source-tree-sha'
import { installedArtifactRuns, isArtifactInstall } from '../../plugins/upgrade-artifact'
import { githubCloneUrl } from '../../plugins/upgrade-github'
import { getSearchAdapterRequiredModels, getSearchAdapterSetup } from '../../search-adapter-factory'
import { getSettings } from '../../settings'
import { EXTERNALS_CONTRACT } from '../../whiskit/externals'
import { hostPlatform } from '../../whiskit/compatible-version'
import { githubArtifactSource } from '../../whiskit/github-resolver'
import { registerUpdateSource } from '../service'
import { createBakinSource } from './bakin'
import { createGatewaySource, type GatewaySourceDeps } from './gateway'
import { createPluginSource } from './plugin'
import { createSearchEngineSource, type SearchSettingsFacts } from './search-engine'
import { createSearchModelsSource } from './search-models'
import { createPackageSource, packageIdOfKey, type InstalledPackage } from './package'
import { createHubSkillSource } from './hub-skill'
import { readLockfile, type PackageEntry } from '../../../../packages/core/src/agent-packages/lockfile'
import { parseManifest, type Manifest } from '../../../../packages/core/src/agent-packages/manifest'
import { getPackageSourceDir } from '../../../../packages/core/src/agent-packages/package-paths'
import { clawhubHasVersion, clawhubLatestVersion, fetchSourceAsync, parseGithubSpec } from '../../agent-packages/source-fetcher'

/**
 * `git ls-remote` as an async child under the observe signal — never the
 * synchronous upgrade-gate wrapper (C15). Foreground-only git config via
 * `gitArgs`; an abort kills the child and the promise settles on exit.
 */
export async function lsRemoteSha(url: string, ref: string, signal: AbortSignal): Promise<string | null> {
  // git filters every output row against the patterns, the peeled `^{}` row
  // included — ask for both, or an annotated tag only ever shows its tag object.
  const proc = Bun.spawn(['git', ...gitArgs(['ls-remote', '--', url, ref, `${ref}^{}`])], { cwd: getContentDir(), stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  const onAbort = (): void => { try { proc.kill() } catch { /* already gone */ } }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  try {
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('ls-remote aborted')
    if (code !== 0) throw new Error(`git ls-remote ${url} ${ref} failed (exit ${code}): ${stderr.trim().slice(-300)}`)
    return pickLsRemoteSha(stdout, ref)
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

function userPluginLockEntries(): Record<string, PluginLockEntry> {
  return readPluginLockfile().plugins
}

/**
 * Every installed agent package with its installed manifest's provenance
 * (D7.12): a skill-pack whose manifest carries `upstream` is a hub skill,
 * everything else a package — never both. When one id is installed under
 * several keys (a superseded version not yet forgotten), the newest wins.
 */
function installedPackages(): InstalledPackage[] {
  const byId = new Map<string, InstalledPackage>()
  for (const [key, entry] of Object.entries(readLockfile().packages)) {
    const id = packageIdOfKey(key)
    const manifest = installedPackageManifest(entry.kind, id, entry.version)
    const upstream = entry.kind === 'skill-pack' && manifest?.kind === 'skill-pack' && manifest.upstream ? manifest.upstream : null
    const candidate: InstalledPackage = { key, id, entry, upstream }
    const held = byId.get(id)
    if (!held || Date.parse(candidate.entry.installedAt) >= Date.parse(held.entry.installedAt)) byId.set(id, candidate)
  }
  return [...byId.values()]
}

function installedPackageManifest(kind: PackageEntry['kind'], id: string, version: string): Manifest | null {
  const path = join(getPackageSourceDir(getContentDir(), kind, id, version), 'bakin-package.json')
  if (!existsSync(path)) return null
  try {
    return parseManifest(JSON.parse(readFileSync(path, 'utf-8')))
  } catch (err) {
    log.warn('installed package manifest unreadable — treated as a plain package', { id, version, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

function packageCloneUrl(source: string): string {
  const spec = parseGithubSpec(source)
  return `https://github.com/${spec.owner}/${spec.repo}.git`
}

/** The manifest at a github source+ref: a staged clone (the fetcher's own temp dir), removed after. */
async function fetchPackageManifest(sourceWithRef: string): Promise<{ id: string; version: string; commitSha: string }> {
  const fetched = await fetchSourceAsync(sourceWithRef)
  try {
    const manifest = parseManifest(JSON.parse(readFileSync(join(fetched.stagingDir, 'bakin-package.json'), 'utf-8')))
    return { id: manifest.id, version: manifest.version, commitSha: fetched.commitSha }
  } finally {
    rmSync(fetched.stagingDir, { recursive: true, force: true })
  }
}

function localPackageManifest(path: string): { id: string; version: string } | null {
  const manifestPath = join(path, 'bakin-package.json')
  if (!existsSync(manifestPath)) return null
  const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))
  return { id: manifest.id, version: manifest.version }
}


const log = createLogger('updates-sources')

function searchSettingsFacts(): SearchSettingsFacts {
  const search = getSettings().search
  const models = getSearchAdapterRequiredModels(search.adapter, search.settings) as ReadonlyArray<{ model?: unknown }>
  return {
    adapter: search.adapter,
    url: String(search.settings.url ?? ''),
    enabled: search.settings.enabled !== false,
    requiredModelIds: models.map((m) => String(m.model ?? '')).filter(Boolean).sort(),
  }
}

export function registerCoreUpdateSources(deps: GatewaySourceDeps): void {
  const searchDeps = {
    setup: () => {
      const search = getSettings().search
      try {
        return getSearchAdapterSetup(search.adapter, log, search.settings)
      } catch (err) {
        log.warn('search adapter setup unavailable for update checks', { error: err instanceof Error ? err.message : String(err) })
        return null
      }
    },
    settings: searchSettingsFacts,
  }
  registerUpdateSource(createSearchEngineSource(searchDeps))
  registerUpdateSource(createSearchModelsSource(searchDeps))
  registerUpdateSource(createGatewaySource(deps))
  registerUpdateSource(createBakinSource({ currentVersion: () => APP_VERSION }))
  const packageDeps = {
    installed: installedPackages,
    hostVersion: () => APP_VERSION,
    cloneUrl: packageCloneUrl,
    lsRemote: lsRemoteSha,
  }
  registerUpdateSource(createPackageSource({
    ...packageDeps,
    fetchManifest: fetchPackageManifest,
    localManifest: localPackageManifest,
  }))
  registerUpdateSource(createHubSkillSource({
    ...packageDeps,
    hub: {
      latest: (slug, owner, signal) => clawhubLatestVersion({ slug, owner }, signal),
      hasVersion: (slug, version, owner, signal) => clawhubHasVersion({ slug, owner }, version, signal),
    },
  }))
  registerUpdateSource(createPluginSource({
    lockEntries: userPluginLockEntries,
    host: () => ({ version: APP_VERSION, platform: hostPlatform(), contract: EXTERNALS_CONTRACT }),
    artifact: (id) => {
      const dir = join(getContentDir(), 'plugins', id)
      const installed = isArtifactInstall(dir)
      return { installed, runs: installed ? installedArtifactRuns(dir) : false }
    },
    artifactSource: (source) => { const gh = githubArtifactSource(source); return { baseUrl: gh.baseUrl, pluginId: gh.pluginId } },
    cloneUrl: githubCloneUrl,
    lsRemote: lsRemoteSha,
    localTree: (id, entry) => { const cmp = compareStoredSourceTreeSha(entry, entry.source, join(getContentDir(), 'plugins', id)); return { changed: cmp.changed, liveSha: cmp.liveSha } },
  }))
}
