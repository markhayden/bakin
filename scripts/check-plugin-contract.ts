/**
 * Release guard: a Bakin release that changes the plugin externals-contract
 * FAMILY must not ship until every official Bits plugin has published an
 * artifact that runs on it. Otherwise every installed copy goes
 * "needs update", is skipped at boot, and stays dark until its author
 * publishes (rc.41 on margo: projects + terminal, 2026-10-18).
 *
 * Within a family, versions are additive (an older artifact still runs), so
 * only a family change is checked for THAT. A second check runs on every
 * release: the release each official plugin would actually be installed at
 * must pass this host's manifest check. rc.47 tightened a manifest rule
 * (dispatched CLI commands must declare `args`) inside an unchanged family,
 * and the published Messaging and Projects would have been refused on
 * install and at boot. Runs from `bun run release` prep and from the release
 * workflow's gate BEFORE the tag is created.
 *
 *   bun run scripts/check-plugin-contract.ts --version 0.0.1-rc.42 [--at <commit>] [--since v0.0.1-rc.41]
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { downloadText, downloadToFile } from '@bakin/core/net/download'
import { readPluginManifestJson } from '@bakin/core/plugins/manifest'
import { safeExtractArtifact } from '../src/core/whiskit/artifact'
import { INDEX_FILENAME, parseArtifactsIndex, type ArtifactEntry, type ArtifactsIndex } from '../src/core/whiskit/artifacts-index'
import { newestCompatibleVersion } from '../src/core/whiskit/compatible-version'
import { EXTERNALS_CONTRACT } from '../src/core/whiskit/externals'
import { githubArtifactSource } from '../src/core/whiskit/github-resolver'

const REPO_ROOT = resolve(import.meta.dir, '..')
const EXTERNALS_PATH = 'src/core/whiskit/externals.ts'
const CATALOG_PATH = 'packages/host/src/data/curated-catalog.json'
/** Platforms the release ships binaries for; a neutral artifact serves all of them. */
export const RELEASE_PLATFORMS = ['darwin-arm64', 'linux-x64', 'linux-arm64'] as const

export interface OfficialPlugin {
  id: string
  source: string
}

export interface ContractCheckInput {
  previousContract: string | null
  currentContract: string
  hostVersion: string
  plugins: OfficialPlugin[]
  fetchIndex: (source: string) => Promise<ArtifactsIndex>
}

export type ContractCheckResult =
  | { ok: true; reason: 'same-family' | 'all-published'; checked: string[] }
  | { ok: false; missing: Array<{ id: string; detail: string }> }

export function contractFamily(contract: string): string {
  return contract.replace(/-v[1-9]\d*$/, '')
}

/** Parse `EXTERNALS_CONTRACT` out of a revision of externals.ts. */
export function contractFromSource(source: string): string | null {
  return /export const EXTERNALS_CONTRACT = '([^']+)'/.exec(source)?.[1] ?? null
}

/** Official Bits plugins = curated catalog plugins installed from GitHub (not built in). */
export function officialPlugins(catalog: unknown): OfficialPlugin[] {
  const entries = (catalog as { entries?: Array<Record<string, unknown>> }).entries ?? []
  return entries
    .filter((e) => e.kind === 'plugin' && e.builtin !== true && typeof e.source === 'string' && e.source.startsWith('github:'))
    .map((e) => ({ id: String(e.id), source: String(e.source) }))
}

export async function checkContractTransition(input: ContractCheckInput): Promise<ContractCheckResult> {
  if (input.previousContract && contractFamily(input.previousContract) === contractFamily(input.currentContract)) {
    return { ok: true, reason: 'same-family', checked: [] }
  }
  const missing: Array<{ id: string; detail: string }> = []
  for (const plugin of input.plugins) {
    let index: ArtifactsIndex
    try {
      index = await input.fetchIndex(plugin.source)
    } catch (err) {
      missing.push({ id: plugin.id, detail: `could not read its published index: ${err instanceof Error ? err.message : String(err)}` })
      continue
    }
    const pluginId = githubArtifactSource(plugin.source).pluginId
    for (const platform of RELEASE_PLATFORMS) {
      const found = newestCompatibleVersion(index, pluginId, { platform, hostContract: input.currentContract, hostVersion: input.hostVersion })
      if (!found) {
        missing.push({ id: plugin.id, detail: `no published release runs on ${input.currentContract} / Bakin ${input.hostVersion} for ${platform} (newest is ${index.plugins[pluginId]?.latest ?? 'none'})` })
        break
      }
    }
  }
  return missing.length === 0
    ? { ok: true, reason: 'all-published', checked: input.plugins.map((p) => p.id) }
    : { ok: false, missing }
}

export interface ManifestCheckInput {
  hostContract: string
  hostVersion: string
  plugins: OfficialPlugin[]
  fetchIndex: (source: string) => Promise<ArtifactsIndex>
  /** The `bakin-plugin.json` inside a published artifact, as text. */
  fetchManifest: (entry: ArtifactEntry) => Promise<string>
  /** This host's manifest check; throws on a manifest it would refuse. */
  parse?: (text: string) => unknown
}

export type ManifestCheckResult =
  | { ok: true; checked: Array<{ id: string; version: string }> }
  | { ok: false; rejected: Array<{ id: string; version: string | null; detail: string }> }

/**
 * For every official plugin: the release this host would install (newest
 * compatible, per release platform) must pass this host's manifest check.
 * Unlike the family check this fetches on every release — a manifest rule
 * can tighten without the contract moving at all.
 */
export async function checkPublishedManifests(input: ManifestCheckInput): Promise<ManifestCheckResult> {
  const parse = input.parse ?? readPluginManifestJson
  const checked: Array<{ id: string; version: string }> = []
  const rejected: Array<{ id: string; version: string | null; detail: string }> = []
  for (const plugin of input.plugins) {
    let index: ArtifactsIndex
    try {
      index = await input.fetchIndex(plugin.source)
    } catch (err) {
      rejected.push({ id: plugin.id, version: null, detail: `could not read its published index: ${err instanceof Error ? err.message : String(err)}` })
      continue
    }
    const pluginId = githubArtifactSource(plugin.source).pluginId
    // One artifact usually serves every platform (neutral); judge each distinct one once.
    const targets = new Map<string, { version: string; entry: ArtifactEntry }>()
    let unavailable: string | null = null
    for (const platform of RELEASE_PLATFORMS) {
      const found = newestCompatibleVersion(index, pluginId, { platform, hostContract: input.hostContract, hostVersion: input.hostVersion })
      if (!found) {
        unavailable = platform
        break
      }
      targets.set(found.entry.url, found)
    }
    if (unavailable) {
      rejected.push({ id: plugin.id, version: null, detail: `no published release runs on ${input.hostContract} / Bakin ${input.hostVersion} for ${unavailable}` })
      continue
    }
    for (const { version, entry } of targets.values()) {
      try {
        parse(await input.fetchManifest(entry))
        checked.push({ id: plugin.id, version })
      } catch (err) {
        rejected.push({ id: plugin.id, version, detail: err instanceof Error ? err.message : String(err) })
      }
    }
  }
  return rejected.length === 0 ? { ok: true, checked } : { ok: false, rejected }
}

function git(args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8' })
  return { status: result.status, stdout: (result.stdout ?? '').trim() }
}

/** The release before this one: the newest v* tag reachable from `at` that is not the one being cut. */
function previousReleaseTag(version: string, at: string): string | null {
  const described = git(['describe', '--tags', '--abbrev=0', '--match', 'v*', at])
  if (described.status !== 0 || !described.stdout) return null
  if (described.stdout !== `v${version}`) return described.stdout
  const before = git(['describe', '--tags', '--abbrev=0', '--match', 'v*', `${described.stdout}^`])
  return before.status === 0 && before.stdout ? before.stdout : null
}

function contractAt(rev: string): string | null {
  const source = git(['show', `${rev}:${EXTERNALS_PATH}`])
  return source.status === 0 ? contractFromSource(source.stdout) : null
}

async function fetchIndex(source: string): Promise<ArtifactsIndex> {
  const gh = githubArtifactSource(source)
  return parseArtifactsIndex(JSON.parse(await downloadText(`${gh.baseUrl}/${INDEX_FILENAME}`)))
}

/**
 * The manifest inside a plugin artifact, read the way an install reads it:
 * the guarded extractor, then the file. Published artifacts name their
 * members `./bakin-plugin.json`; asking tar for the bare name works with
 * bsdtar (macOS) and fails with GNU tar (the release runner), which is how
 * the guard's first real run refused every plugin (rc.48).
 */
export async function readArtifactManifest(tarballPath: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'bakin-contract-guard-'))
  try {
    await safeExtractArtifact(tarballPath, dir)
    return readFileSync(join(dir, 'bakin-plugin.json'), 'utf-8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Download a published artifact (sha256-pinned by its index entry) and read its manifest. */
async function fetchManifest(entry: ArtifactEntry): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'bakin-contract-guard-'))
  try {
    const tarball = join(dir, 'artifact.tar.gz')
    await downloadToFile(entry.url, tarball, { sha256: entry.sha256 })
    return await readArtifactManifest(tarball)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Judge the commit that will SHIP (`at`, default HEAD): its contract and its
 * catalog, against the release before it — never the working tree, so a
 * retried dispatch of an existing tag is judged on that tag's commit.
 */
export async function runContractGuard(version: string, opts: { since?: string; at?: string } = {}): Promise<ContractCheckResult & { contract: string; manifests: ManifestCheckResult }> {
  const at = opts.at ?? 'HEAD'
  const currentContract = (at === 'HEAD' ? null : contractAt(at)) ?? EXTERNALS_CONTRACT
  const previousTag = opts.since ?? previousReleaseTag(version, at)
  const previousContract = previousTag ? contractAt(previousTag) : null
  const catalogSource = at === 'HEAD' ? { status: 0, stdout: readFileSync(resolve(REPO_ROOT, CATALOG_PATH), 'utf-8') } : git(['show', `${at}:${CATALOG_PATH}`])
  if (catalogSource.status !== 0) throw new Error(`Could not read ${CATALOG_PATH} at ${at}`)
  const plugins = officialPlugins(JSON.parse(catalogSource.stdout) as unknown)
  const result = await checkContractTransition({ previousContract, currentContract, hostVersion: version, plugins, fetchIndex })
  // The manifest rules are the ones in the tree this script runs from: the
  // release workflow and release prep both run it on the commit that ships.
  const manifests = await checkPublishedManifests({ hostContract: currentContract, hostVersion: version, plugins, fetchIndex, fetchManifest })
  return { ...result, contract: currentContract, manifests }
}

/** Plain words for the release log; throws when the release must not ship. */
export function reportContractGuard(result: ContractCheckResult & { contract?: string; manifests?: ManifestCheckResult }): string {
  const contract = result.contract ?? EXTERNALS_CONTRACT
  if (!result.ok) {
    throw new Error([
      `Plugin contract family changed to ${contract}, but not every official plugin has a release that runs on it:`,
      ...result.missing.map((m) => `  - ${m.id}: ${m.detail}`),
      'Publish compatible Bits releases first (bakinRange may already require this version), then cut this release.',
    ].join('\n'))
  }
  const manifests = result.manifests
  if (manifests && !manifests.ok) {
    throw new Error([
      'This release would refuse the official plugin releases it installs:',
      ...manifests.rejected.map((r) => `  - ${r.id}${r.version ? ` ${r.version}` : ''}: ${r.detail}`),
      'Publish Bits releases that pass this host\'s manifest check first, then cut this release.',
    ].join('\n'))
  }
  const family = result.reason === 'same-family'
    ? `Plugin contract: unchanged family (${contract}).`
    : `Plugin contract: family changed to ${contract}; every official plugin has a compatible release (${result.checked.join(', ')}).`
  return manifests
    ? `${family}\nPlugin manifests: every official plugin's installable release passes this host's check (${manifests.checked.map((c) => `${c.id} ${c.version}`).join(', ')}).`
    : family
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const value = (flag: string) => {
    const at = args.indexOf(flag)
    return at === -1 ? undefined : args[at + 1]
  }
  const version = value('--version')?.replace(/^v/, '')
  if (!version) {
    console.error('usage: check-plugin-contract.ts --version <x.y.z[-rc.n]> [--at <commit>] [--since <tag>]')
    process.exit(2)
  }
  runContractGuard(version, { since: value('--since'), at: value('--at') })
    .then((result) => console.log(reportContractGuard(result)))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
}
