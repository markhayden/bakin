/**
 * Available row: the Bakin release (#1007, D7.6). GitHub REST with the
 * persisted ETag (304 ⇒ unchanged), 403/429 backing off on the server's own
 * hint, the release-list fallback when the repo only has prereleases. A
 * source/dev runtime is `unsupported` — honest, never "current".
 */
import { fingerprintOf } from '../inventory'
import { conditionalFetchJson, HttpStatusError, type FetchLike } from '../net'
import {
  compareVersions,
  currentTriple,
  GITHUB_HEADERS,
  LATEST_RELEASE_API,
  normalizeVersion,
  RELEASES_API,
  selfUpdateSupport,
  type GithubRelease,
} from '../../self-update'
import type { UpdateObservation, UpdateSource } from '../types'
import { applyRoute } from './search-engine'

export const BAKIN_RECORD_ID = 'bakin:bakin'

export interface BakinSourceDeps {
  currentVersion: () => string
  execPath?: () => string
  platform?: () => string | null
  fetch?: FetchLike
}

export function createBakinSource(deps: BakinSourceDeps): UpdateSource {
  const triple = (): string | null => (deps.platform ? deps.platform() : currentTriple())
  return {
    kind: 'bakin',
    async inventory() {
      return [{
        subject: { kind: 'bakin', id: 'bakin', label: 'Bakin' },
        group: 'available',
        fingerprint: fingerprintOf({ version: deps.currentVersion(), platform: triple() }),
        source: { kind: 'github-release', endpoint: LATEST_RELEASE_API },
      }]
    },
    async observe(_entry, { signal, conditional }) {
      const currentVersion = deps.currentVersion()
      const installed = { version: currentVersion, display: `v${currentVersion}` }
      const support = selfUpdateSupport(currentVersion, deps.execPath?.() ?? process.execPath)
      if (!support.supported) {
        return { installed, outcome: 'unsupported', blockedReason: `self-update is not available on a ${support.reason}`, action: { kind: 'manual', pointer: 'Update from the source checkout (git pull + rebuild).' } }
      }
      const platform = triple()
      if (!platform) {
        return { installed, outcome: 'unsupported', blockedReason: `no prebuilt binary for ${process.platform}/${process.arch}` }
      }
      const release = await latestRelease({ fetch: deps.fetch, signal, conditional })
      const latestVersion = normalizeVersion(release.tag_name)
      const observation: UpdateObservation = {
        installed,
        source: { kind: 'github-release', endpoint: LATEST_RELEASE_API, ref: release.tag_name },
        outcome: 'current',
        ...(release.html_url ? { notesUrl: release.html_url } : {}),
      }
      if (compareVersions(latestVersion, currentVersion) <= 0) return observation
      return {
        ...observation,
        available: { version: latestVersion, display: `v${latestVersion}` },
        reason: 'newer-version',
        outcome: 'update-available',
        action: { kind: 'operation', start: { route: applyRoute(BAKIN_RECORD_ID) }, impact: ['download', 'server-restart'] },
      }
    },
  }
}

/** The latest published, non-draft release: `/releases/latest`, falling back to the list when the repo has only prereleases. Both conditional. */
async function latestRelease(opts: { fetch?: FetchLike; signal: AbortSignal; conditional: Parameters<typeof conditionalFetchJson>[1]['conditional'] }): Promise<GithubRelease> {
  try {
    return (await conditionalFetchJson<GithubRelease>(LATEST_RELEASE_API, { conditional: opts.conditional, headers: GITHUB_HEADERS, signal: opts.signal, fetch: opts.fetch })).body
  } catch (err) {
    if (!(err instanceof HttpStatusError) || err.status !== 404) throw err
  }
  const releases = (await conditionalFetchJson<GithubRelease[]>(RELEASES_API, { conditional: opts.conditional, headers: GITHUB_HEADERS, signal: opts.signal, fetch: opts.fetch })).body
  const release = releases.find((candidate) => !candidate.draft)
  if (!release) throw new HttpStatusError(404, RELEASES_API)
  return release
}
