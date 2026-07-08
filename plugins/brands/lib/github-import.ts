/**
 * GitHub source resolution for brand import (#419, spec §7.3/S6).
 *
 * Reuses the plugin installer's shared helpers — parseGithubSource (the
 * single source of truth for `github:` forms) + materializeCachedGithubSource
 * (git clone; private repos ride the operator's ambient git credentials, no
 * token machinery). The spec's `github:user/repo/path` convenience form is
 * normalized to the installer's canonical `github:user/repo#path`.
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseGithubSource } from '@bakin/core/plugins/source'
import { materializeCachedGithubSource } from '../../../src/core/github-source-cache'

export function isGithubSource(source: string): boolean {
  return (
    source.startsWith('github:')
    || source.startsWith('https://github.com/')
    || source.startsWith('git@')
  )
}

/** `github:user/repo/sub/path` → `github:user/repo#sub/path` (spec parity). */
export function normalizeGithubSource(source: string): string {
  const m = source.match(/^github:([^/#@\s]+)\/([^/#@\s]+)\/([^#@\s]+)(@[^#\s]+)?$/)
  if (!m) return source
  return `github:${m[1]}/${m[2]}${m[4] ?? ''}#${m[3]}`
}

export interface MaterializedImportSource {
  dir: string
  provenance: { source: string; ref?: string; commit?: string }
  cleanup: () => void
}

/**
 * Resolve an import source to a local directory. Local paths pass through
 * (no cleanup); github sources clone into a temp staging dir the caller
 * must clean up after the import completes.
 */
export async function materializeImportSource(source: string): Promise<MaterializedImportSource> {
  if (!isGithubSource(source)) {
    return { dir: source, provenance: { source }, cleanup: () => {} }
  }
  const parsed = parseGithubSource(normalizeGithubSource(source))
  const stagingDir = mkdtempSync(join(tmpdir(), 'bakin-brand-import-'))
  try {
    const checkout = await materializeCachedGithubSource({
      cloneUrl: parsed.cloneUrl,
      ref: parsed.ref || undefined,
      subpath: parsed.subpath || undefined,
      stagingDir,
    })
    return {
      dir: stagingDir,
      provenance: { source, ref: parsed.ref || undefined, commit: checkout.commitSha },
      cleanup: () => rmSync(stagingDir, { recursive: true, force: true }),
    }
  } catch (err) {
    rmSync(stagingDir, { recursive: true, force: true })
    throw err
  }
}

/** Latest upstream commit for a previously imported brand's provenance source. */
export async function latestUpstreamCommit(source: string, ref?: string): Promise<string> {
  const parsed = parseGithubSource(normalizeGithubSource(source))
  const stagingDir = mkdtempSync(join(tmpdir(), 'bakin-brand-check-'))
  try {
    const checkout = await materializeCachedGithubSource({
      cloneUrl: parsed.cloneUrl,
      ref: ref || parsed.ref || undefined,
      subpath: parsed.subpath || undefined,
      stagingDir,
    })
    return checkout.commitSha
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}
