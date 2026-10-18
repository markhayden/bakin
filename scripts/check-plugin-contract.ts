/**
 * Release guard: a Bakin release that changes the plugin externals-contract
 * FAMILY must not ship until every official Bits plugin has published an
 * artifact that runs on it. Otherwise every installed copy goes
 * "needs update", is skipped at boot, and stays dark until its author
 * publishes (rc.41 on margo: projects + terminal, 2026-10-18).
 *
 * Within a family, versions are additive (an older artifact still runs), so
 * only a family change is checked. Runs from `bun run release` prep and from
 * the release workflow's gate BEFORE the tag is created.
 *
 *   bun run scripts/check-plugin-contract.ts --version 0.0.1-rc.42 [--since v0.0.1-rc.41]
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { downloadText } from '@bakin/core/net/download'
import { INDEX_FILENAME, parseArtifactsIndex, type ArtifactsIndex } from '../src/core/whiskit/artifacts-index'
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

function git(args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8' })
  return { status: result.status, stdout: (result.stdout ?? '').trim() }
}

/** The release before this one: the newest v* tag reachable from HEAD that is not the one being cut. */
function previousReleaseTag(version: string): string | null {
  const described = git(['describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD'])
  if (described.status !== 0 || !described.stdout) return null
  if (described.stdout !== `v${version}`) return described.stdout
  const before = git(['describe', '--tags', '--abbrev=0', '--match', 'v*', `${described.stdout}^`])
  return before.status === 0 && before.stdout ? before.stdout : null
}

async function fetchIndex(source: string): Promise<ArtifactsIndex> {
  const gh = githubArtifactSource(source)
  return parseArtifactsIndex(JSON.parse(await downloadText(`${gh.baseUrl}/${INDEX_FILENAME}`)))
}

export async function runContractGuard(version: string, since?: string): Promise<ContractCheckResult> {
  const previousTag = since ?? previousReleaseTag(version)
  const previousSource = previousTag ? git(['show', `${previousTag}:${EXTERNALS_PATH}`]) : null
  const previousContract = previousSource?.status === 0 ? contractFromSource(previousSource.stdout) : null
  const catalog = JSON.parse(readFileSync(resolve(REPO_ROOT, CATALOG_PATH), 'utf-8')) as unknown
  return checkContractTransition({
    previousContract,
    currentContract: EXTERNALS_CONTRACT,
    hostVersion: version,
    plugins: officialPlugins(catalog),
    fetchIndex,
  })
}

/** Plain words for the release log; throws when the release must not ship. */
export function reportContractGuard(result: ContractCheckResult): string {
  if (result.ok) {
    return result.reason === 'same-family'
      ? `Plugin contract: unchanged family (${EXTERNALS_CONTRACT}).`
      : `Plugin contract: family changed to ${EXTERNALS_CONTRACT}; every official plugin has a compatible release (${result.checked.join(', ')}).`
  }
  throw new Error([
    `Plugin contract family changed to ${EXTERNALS_CONTRACT}, but not every official plugin has a release that runs on it:`,
    ...result.missing.map((m) => `  - ${m.id}: ${m.detail}`),
    'Publish compatible Bits releases first (bakinRange may already require this version), then cut this release.',
  ].join('\n'))
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const value = (flag: string) => {
    const at = args.indexOf(flag)
    return at === -1 ? undefined : args[at + 1]
  }
  const version = value('--version')?.replace(/^v/, '')
  if (!version) {
    console.error('usage: check-plugin-contract.ts --version <x.y.z[-rc.n]> [--since <tag>]')
    process.exit(2)
  }
  runContractGuard(version, value('--since'))
    .then((result) => console.log(reportContractGuard(result)))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
}
