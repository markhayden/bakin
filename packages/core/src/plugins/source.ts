/**
 * Plugin install source parsing.
 *
 * Single source of truth for both the install endpoint
 * (`packages/host/src/api/plugins/install.ts`) and the upgrade flow
 * (`src/core/plugins/upgrade.ts`). Both call sites used to carry their
 * own copy of the same logic with a comment promising they stayed in
 * lockstep — Phase 1 collapses them to a single helper so monorepo
 * subpath support lands in one place.
 *
 * Returned `cloneUrl` is the positional URL fed to `git clone`/`git
 * ls-remote`; `subpath` is the optional monorepo path inside the clone
 * (empty string when no `#subpath` was given).
 *
 * Refusal cases throw `InvalidGithubSourceError` so callers can surface
 * a 400 (HTTP) or `UpgradeRefusedError` (CLI) without sniffing message
 * strings. The schema in `lockfile.ts` performs an earlier identical
 * subpath check, so anything that round-trips through the lockfile is
 * already valid here — but this function is also called on raw user
 * input (CLI/REST) and re-validates defensively.
 */

import { checkSubpath } from '../install-core/source-guards'

export interface ParsedGithubSource {
  /** Positional URL for `git clone` / `git ls-remote`. */
  cloneUrl: string
  /** Monorepo subpath inside the clone; empty string when no `#subpath`. */
  subpath: string
  /**
   * Optional git ref parsed from shorthand `@ref` syntax. Full URLs do not
   * parse `@ref` here because forms like `git@github.com:owner/repo.git`
   * already use `@` for transport identity; pass refs separately via
   * `bakin plugins install --ref <ref>` for those sources.
   */
  ref?: string
}

export class InvalidGithubSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidGithubSourceError'
  }
}

/** Hard ceiling on the resolved clone URL — a hostile input shouldn't blow past this. */
const MAX_CLONE_URL_BYTES = 2048

/**
 * Validate the optional subpath portion (everything after `#`).
 * Mirrors the rules in `SourceStringSchema` but throws a typed error so
 * the caller can map it to a useful HTTP/CLI message.
 */
function assertSubpathValid(subpath: string): void {
  // Rules live in the shared install-core guard; this function owns only the
  // plugin-side error type + message wording (preserved exactly).
  switch (checkSubpath(subpath)) {
    case 'empty':
      throw new InvalidGithubSourceError('subpath after `#` must not be empty')
    case 'invalid-chars':
      throw new InvalidGithubSourceError(
        `subpath must match /^[A-Za-z0-9._/-]+$/ — got "${subpath}"`,
      )
    case 'leading-or-trailing-slash':
      throw new InvalidGithubSourceError('subpath must not start or end with "/"')
    case 'dot-segment':
      throw new InvalidGithubSourceError('subpath must not contain `..` or `.` segments')
  }
}

/** Git refs accepted from user input before they reach git positionally. */
export function isGitRefString(ref: string): boolean {
  return (
    ref.length > 0 &&
    !ref.startsWith('-') &&
    /^[A-Za-z0-9._/-]+$/.test(ref) &&
    !ref.startsWith('/') &&
    !ref.endsWith('/') &&
    !ref.endsWith('.') &&
    !ref.includes('..') &&
    !ref.includes('//')
  )
}

export function assertGitRefValid(ref: string): void {
  if (!isGitRefString(ref)) {
    throw new InvalidGithubSourceError(
      `ref must match /^[A-Za-z0-9._/-]+$/ and must not be empty, option-like, or path-like — got "${ref}"`,
    )
  }
}

/**
 * Parse a plugin install source string into `{ cloneUrl, subpath }`.
 *
 * Accepts:
 *   github:user/repo
 *   github:user/repo#subpath
 *   user/repo
 *   user/repo#subpath
 *   https://github.com/user/repo.git
 *   https://github.com/user/repo.git#subpath
 *   git@github.com:user/repo.git
 *   git@github.com:user/repo.git#subpath
 *   ssh://git@github.com/user/repo.git
 *   file:///abs/path/to/clone
 *
 * Also accepts `@ref` on shorthand forms:
 *   github:user/repo@v1.2.3
 *   github:user/repo@v1.2.3#subpath
 *   user/repo@feature/foo
 */
export function parseGithubSource(source: string): ParsedGithubSource {
  if (source.length === 0) {
    throw new InvalidGithubSourceError('empty github source')
  }
  if (source.startsWith('-')) {
    throw new InvalidGithubSourceError('github source must not start with "-"')
  }
  if (/[\x00-\x1f]/.test(source)) {
    throw new InvalidGithubSourceError('github source contains control characters')
  }
  if (/\s/.test(source)) {
    throw new InvalidGithubSourceError('github source must not contain whitespace')
  }

  const hashCount = (source.match(/#/g) || []).length
  if (hashCount > 1) {
    throw new InvalidGithubSourceError('github source must contain at most one `#`')
  }
  const hashIdx = source.indexOf('#')
  const before = hashIdx === -1 ? source : source.slice(0, hashIdx)
  const subpath = hashIdx === -1 ? '' : source.slice(hashIdx + 1)
  if (hashIdx !== -1) assertSubpathValid(subpath)

  const stripped = before.startsWith('github:') ? before.slice('github:'.length) : before
  if (stripped.length === 0) {
    throw new InvalidGithubSourceError('empty github source after stripping prefix')
  }

  let cloneUrl: string
  let ref: string | undefined
  if (
    stripped.startsWith('http://') ||
    stripped.startsWith('https://') ||
    stripped.startsWith('ssh://') ||
    stripped.startsWith('file://') ||
    stripped.startsWith('git@')
  ) {
    cloneUrl = stripped
  } else {
    let repoSpec = stripped
    const atIdx = stripped.lastIndexOf('@')
    if (atIdx !== -1) {
      repoSpec = stripped.slice(0, atIdx)
      ref = stripped.slice(atIdx + 1)
      assertGitRefValid(ref)
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*(\.git)?$/.test(repoSpec)) {
      throw new InvalidGithubSourceError(
        `invalid github user/repo shorthand: "${repoSpec}"`,
      )
    }
    // Strip any trailing `.git` from the shorthand before re-appending it,
    // so `github:owner/repo` and `github:owner/repo.git` both resolve to
    // `https://github.com/owner/repo.git` (the existing install endpoint
    // double-suffixed the latter form, producing `.git.git` URLs that
    // GitHub silently tolerates but no other host does).
    const repoPart = repoSpec.endsWith('.git') ? repoSpec.slice(0, -'.git'.length) : repoSpec
    cloneUrl = `https://github.com/${repoPart}.git`
  }

  if (cloneUrl.length > MAX_CLONE_URL_BYTES) {
    throw new InvalidGithubSourceError('github clone URL is suspiciously long')
  }

  return ref ? { cloneUrl, subpath, ref } : { cloneUrl, subpath }
}
