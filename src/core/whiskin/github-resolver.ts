/**
 * GitHub-release artifact resolver (Open Q2, v1 backend).
 *
 * Turns a `github:owner/repo[@ref]#subpath` source into a resolver pointed at
 * the right release's `whiskin-artifacts.json`, plus the pluginId derived from
 * the subpath:
 *   - no `@ref`  → the stable, non-API `releases/latest/download/` redirect.
 *   - `@<tag>`   → that tag's `releases/download/<tag>/`.
 *
 * Reuses the single source-string parser (`parseGithubSource`) so the github
 * shorthand / `@ref` / `#subpath` rules stay in one place.
 *
 * Part of the Whiskin consumer install path (Phase 6).
 */
import { parseGithubSource } from '@bakin/core/plugins/source'
import { httpIndexResolver, type WhiskinArtifactResolver } from './resolver'

export interface GithubArtifactSource {
  resolver: WhiskinArtifactResolver
  /** Plugin id, derived from the last segment of the `#subpath`. */
  pluginId: string
  /** Base URL the index is read from (exposed for diagnostics/tests). */
  baseUrl: string
}

function ownerRepoFromCloneUrl(cloneUrl: string): { owner: string; repo: string } | null {
  const m = cloneUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!m) return null
  return { owner: m[1]!, repo: m[2]! }
}

/**
 * Build a GitHub-release resolver + pluginId from a plugin source string.
 * Throws on a non-github source, a source without a `#subpath`, or one whose
 * owner/repo can't be derived.
 */
export function githubArtifactSource(source: string): GithubArtifactSource {
  const parsed = parseGithubSource(source)
  const ownerRepo = ownerRepoFromCloneUrl(parsed.cloneUrl)
  if (!ownerRepo) {
    throw new Error(`Whiskin: cannot derive owner/repo from source "${source}"`)
  }
  if (!parsed.subpath) {
    throw new Error(
      `Whiskin: a published plugin source needs a "#subpath" (e.g. github:owner/repo#plugins/messaging)`,
    )
  }
  const pluginId = parsed.subpath.split('/').filter(Boolean).pop()!
  const baseUrl = parsed.ref
    ? `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/releases/download/${parsed.ref}`
    : `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/releases/latest/download`

  return { resolver: httpIndexResolver(baseUrl, 'github'), pluginId, baseUrl }
}
