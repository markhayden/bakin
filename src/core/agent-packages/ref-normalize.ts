/**
 * Paste-a-link normalization (#687, D2).
 *
 * The user's input is whatever they copied — a clawhub.ai skill page URL, a
 * github.com tree/blob URL, a scheme ref, or a local path. Every install
 * surface (CLI, REST, Explore) funnels through this ONE pure normalizer to a
 * canonical internal ref:
 *
 *   clawhub:@{owner}/{slug}[@version]   (owner optional — hub disambiguates)
 *   github:owner/repo[@ref][#subpath]
 *   local paths (./ ../ / ~/) verbatim
 *
 * No network, no filesystem — parsing only.
 */

export type NormalizeResult = { ok: true; ref: string } | { ok: false; error: string }

export interface ClawhubRef {
  owner?: string
  slug: string
  version?: string
}

const SLUG_RE = /^[a-z0-9][a-z0-9-_.]*$/i

const HELP =
  'Expected a clawhub.ai or github.com URL, a clawhub:/github: ref, or a local path. ' +
  'Examples: https://clawhub.ai/steipete/skills/weather · clawhub:@steipete/weather · ' +
  'github:badlogic/pi-skills#brave-search · ./my-skill'

function fail(input: string): NormalizeResult {
  return { ok: false, error: `"${input}" is not an installable skill reference. ${HELP}` }
}

function isLocalPath(input: string): boolean {
  return input.startsWith('./') || input.startsWith('../') || input.startsWith('/') || input.startsWith('~/')
}

/** Parse a clawhub: ref into its parts. Throws on malformed input. */
export function parseClawhubRef(ref: string): ClawhubRef {
  if (!ref.startsWith('clawhub:')) throw new Error(`not a clawhub ref: "${ref}"`)
  let rest = ref.slice('clawhub:'.length)
  let owner: string | undefined
  if (rest.startsWith('@')) {
    const slash = rest.indexOf('/')
    if (slash <= 1) throw new Error(`malformed clawhub ref: "${ref}"`)
    owner = rest.slice(1, slash)
    rest = rest.slice(slash + 1)
    if (!SLUG_RE.test(owner)) throw new Error(`malformed clawhub owner in "${ref}"`)
  }
  let version: string | undefined
  const at = rest.indexOf('@')
  if (at >= 0) {
    version = rest.slice(at + 1)
    rest = rest.slice(0, at)
    if (!version) throw new Error(`malformed clawhub version in "${ref}"`)
  }
  if (!rest || !SLUG_RE.test(rest)) throw new Error(`malformed clawhub slug in "${ref}"`)
  return { slug: rest, ...(owner ? { owner } : {}), ...(version ? { version } : {}) }
}

function normalizeClawhubUrl(url: URL): NormalizeResult | null {
  // Skill page shape (verified live 2026-07-27): /{owner}/skills/{slug}
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length === 3 && parts[1] === 'skills' && SLUG_RE.test(parts[0]!) && SLUG_RE.test(parts[2]!)) {
    return { ok: true, ref: `clawhub:@${parts[0]}/${parts[2]}` }
  }
  return null
}

function normalizeGithubUrl(url: URL): NormalizeResult | null {
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const [owner, repo, kind, gitRef, ...pathParts] = parts
  if (!SLUG_RE.test(owner!) || !SLUG_RE.test(repo!.replace(/\.git$/, ''))) return null
  const repoName = repo!.replace(/\.git$/, '')
  if (parts.length === 2) return { ok: true, ref: `github:${owner}/${repoName}` }
  if ((kind === 'tree' || kind === 'blob') && gitRef) {
    let subpath = pathParts.join('/')
    // A blob link to the SKILL.md itself means "this skill's directory".
    if (kind === 'blob') {
      if (!/^skill\.md$/i.test(pathParts[pathParts.length - 1] ?? '')) return null
      subpath = pathParts.slice(0, -1).join('/')
    }
    const refPart = `github:${owner}/${repoName}@${gitRef}`
    return { ok: true, ref: subpath ? `${refPart}#${subpath}` : refPart }
  }
  return null
}

/** Normalize any accepted input to a canonical ref, or a typed error. */
export function normalizeSkillRef(input: string): NormalizeResult {
  const trimmed = input.trim()
  if (!trimmed) return fail(input)

  if (isLocalPath(trimmed)) return { ok: true, ref: trimmed }

  if (trimmed.startsWith('clawhub:')) {
    try {
      parseClawhubRef(trimmed)
      return { ok: true, ref: trimmed }
    } catch {
      return fail(trimmed)
    }
  }

  if (trimmed.startsWith('github:')) {
    // Delegate detailed validation to the fetcher's parseGithubSpec; here we
    // only require the owner/repo backbone so garbage fails fast.
    const body = trimmed.slice('github:'.length)
    const backbone = body.split('#')[0]!.split('@')[0]!
    const segs = backbone.split('/')
    if (segs.length === 2 && segs.every((s) => s && SLUG_RE.test(s))) return { ok: true, ref: trimmed }
    return fail(trimmed)
  }

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      return fail(trimmed)
    }
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'clawhub.ai') return normalizeClawhubUrl(url) ?? fail(trimmed)
    if (host === 'github.com') return normalizeGithubUrl(url) ?? fail(trimmed)
    return fail(trimmed)
  }

  return fail(trimmed)
}
