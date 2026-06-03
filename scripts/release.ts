/**
 * Shared release helpers.
 *
 * Local release publishing has been retired. `bun run release` runs
 * scripts/prep-release.ts, while GitHub Actions owns publishing.
 */

const RELEASE_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/
const EMPTY_UNRELEASED = '## [Unreleased]'

type BumpVerb = 'patch' | 'minor' | 'major'
type ReleaseVerb = BumpVerb | 'promote'

interface ParsedReleaseTag {
  tag: string
  version: string
  major: number
  minor: number
  patch: number
  rc: number | null
}

interface ResolveTargetOpts {
  verb: ReleaseVerb
  prerelease: boolean
}

interface CliOptions extends ResolveTargetOpts {
  dryRun: boolean
  yes: boolean
}

interface ReleaseWorkflowRun {
  conclusion?: string
  databaseId?: number
  headBranch?: string
  status?: string
  url?: string
}

export function parseReleaseTag(tag: string): ParsedReleaseTag | null {
  const match = RELEASE_TAG_RE.exec(tag)
  if (!match) return null
  const [, major, minor, patch, rc] = match
  return {
    tag,
    version: `${major}.${minor}.${patch}${rc ? `-rc.${rc}` : ''}`,
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    rc: rc ? Number(rc) : null,
  }
}

function compareTags(a: ParsedReleaseTag, b: ParsedReleaseTag): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.rc === null && b.rc === null) return 0
  if (a.rc === null) return 1
  if (b.rc === null) return -1
  return a.rc - b.rc
}

function parseReleaseTags(tags: string[]): ParsedReleaseTag[] {
  const parsed: ParsedReleaseTag[] = []
  for (const tag of tags) {
    const releaseTag = parseReleaseTag(tag)
    if (releaseTag) {
      parsed.push(releaseTag)
    } else if (/^v\d/.test(tag)) {
      throw new Error(`Malformed release tag: ${tag}`)
    }
  }
  return parsed.sort(compareTags)
}

function baseVersion(tag: ParsedReleaseTag): string {
  return `${tag.major}.${tag.minor}.${tag.patch}`
}

function tagFor(major: number, minor: number, patch: number, rc: number | null): string {
  return `v${major}.${minor}.${patch}${rc === null ? '' : `-rc.${rc}`}`
}

function bumpedBase(latestStable: ParsedReleaseTag | null, verb: BumpVerb): { major: number; minor: number; patch: number } {
  if (!latestStable) {
    if (verb === 'major') return { major: 1, minor: 0, patch: 0 }
    if (verb === 'minor') return { major: 0, minor: 1, patch: 0 }
    return { major: 0, minor: 0, patch: 1 }
  }
  if (verb === 'patch') return { major: latestStable.major, minor: latestStable.minor, patch: latestStable.patch + 1 }
  if (verb === 'minor') return { major: latestStable.major, minor: latestStable.minor + 1, patch: 0 }
  return { major: latestStable.major + 1, minor: 0, patch: 0 }
}

export function resolveReleaseTarget(tags: string[], opts: ResolveTargetOpts): string {
  const parsed = parseReleaseTags(tags)
  const latestOverall = parsed.at(-1) ?? null
  const stable = parsed.filter((tag) => tag.rc === null)
  const latestStable = stable.at(-1) ?? null
  const inFlightRc = latestOverall?.rc !== null ? latestOverall : null

  if (opts.verb === 'promote') {
    if (!inFlightRc) throw new Error('No release candidate is in flight; nothing to promote')
    const stableTag = `v${baseVersion(inFlightRc)}`
    if (parsed.some((tag) => tag.tag === stableTag)) throw new Error(`${stableTag} already exists`)
    return stableTag
  }

  if (!opts.prerelease && inFlightRc) {
    throw new Error(`A release candidate is in flight (${inFlightRc.tag}); run release promote or resolve it manually first`)
  }

  const base = bumpedBase(latestStable, opts.verb)
  const targetBase = `${base.major}.${base.minor}.${base.patch}`

  if (!opts.prerelease) {
    return tagFor(base.major, base.minor, base.patch, null)
  }

  if (inFlightRc) {
    if (baseVersion(inFlightRc) !== targetBase) {
      throw new Error(`A different release candidate is in flight (${inFlightRc.tag}); resolve it before starting ${targetBase}`)
    }
    return tagFor(base.major, base.minor, base.patch, (inFlightRc.rc ?? 0) + 1)
  }

  return tagFor(base.major, base.minor, base.patch, 1)
}

function unreleasedRange(changelog: string): { start: number; bodyStart: number; end: number; body: string } {
  const header = '## [Unreleased]'
  const start = changelog.indexOf(header)
  if (start === -1) throw new Error('CHANGELOG.md is missing [Unreleased]')
  const bodyStart = start + header.length
  const nextMatch = /\n(?:## \[[^\]]+\]|\[[^\]]+\]:)/.exec(changelog.slice(bodyStart))
  const end = nextMatch ? bodyStart + nextMatch.index : changelog.length
  return {
    start,
    bodyStart,
    end,
    body: changelog.slice(bodyStart, end),
  }
}

function versionRange(changelog: string, version: string): { start: number; bodyStart: number; end: number; body: string } | null {
  const header = `## [${version}]`
  const start = changelog.indexOf(header)
  if (start === -1) return null
  const lineEnd = changelog.indexOf('\n', start)
  const bodyStart = lineEnd === -1 ? changelog.length : lineEnd + 1
  const nextMatch = /\n(?:## \[[^\]]+\]|\[[^\]]+\]:)/.exec(changelog.slice(bodyStart))
  const end = nextMatch ? bodyStart + nextMatch.index : changelog.length
  return {
    start,
    bodyStart,
    end,
    body: changelog.slice(bodyStart, end),
  }
}

function hasBullets(body: string): boolean {
  return /^\s*-\s+\S/m.test(body)
}

function bulletCount(body: string): number {
  return (body.match(/^\s*-\s+\S/gm) ?? []).length
}

export function stripEmptyChangelogSections(body: string): string {
  const lines = body.trim().split('\n')
  const loose: string[] = []
  const order: string[] = []
  const sections = new Map<string, string[]>()
  let current: string | null = null

  for (const line of lines) {
    if (line.startsWith('### ')) {
      current = line
      if (!sections.has(current)) {
        sections.set(current, [])
        order.push(current)
      }
      continue
    }

    if (!current) {
      if (line.trim()) loose.push(line)
      continue
    }

    sections.get(current)?.push(line)
  }

  const chunks = [...loose]
  for (const heading of order) {
    const sectionBody = (sections.get(heading) ?? []).join('\n').trim()
    if (hasBullets(sectionBody)) chunks.push(`${heading}\n${sectionBody}`)
  }

  return chunks.join('\n\n').trim()
}

export function hasUnreleasedBullets(changelog: string): boolean {
  return hasBullets(unreleasedRange(changelog).body)
}

export function assertHasUnreleasedBullets(changelog: string): void {
  if (!hasUnreleasedBullets(changelog)) {
    throw new Error('CHANGELOG.md [Unreleased] has no release-note bullets')
  }
}

/** Body of an existing `## [version]` section, or null when it is absent. */
export function versionSectionBody(changelog: string, version: string): string | null {
  return versionRange(changelog, version)?.body ?? null
}

function replaceOrAppendLinkRefs(changelog: string, version: string): string {
  const withoutRefs = changelog
    .replace(/^\[Unreleased\]: .*$/m, '')
    .replace(new RegExp(`^\\[${version.replace(/\./g, '\\.')}\\]: .*$`, 'm'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
  return `${withoutRefs}

[Unreleased]: https://github.com/markhayden/bakin/compare/v${version}...HEAD
[${version}]: https://github.com/markhayden/bakin/releases/tag/v${version}
`
}

function removeVersionSection(changelog: string, version: string): string {
  const range = versionRange(changelog, version)
  if (!range) return changelog
  return `${changelog.slice(0, range.start)}${changelog.slice(range.end)}`.replace(/\n{3,}/g, '\n\n')
}

function removeVersionLinkRef(changelog: string, version: string): string {
  return changelog
    .replace(new RegExp(`^\\[${version.replace(/\./g, '\\.')}\\]: .*$`, 'm'), '')
    .replace(/\n{3,}/g, '\n\n')
}

function removeRcSectionsForVersion(changelog: string, version: string, tags: string[]): string {
  let next = changelog
  for (const rc of rcTagsForVersion(tags, version)) {
    next = removeVersionSection(next, rc.version)
    next = removeVersionLinkRef(next, rc.version)
  }
  return next
}

function insertVersionNotes(changelog: string, version: string, date: string, notes: string): string {
  const withoutDuplicateVersion = removeVersionSection(changelog, version)
  const range = unreleasedRange(withoutDuplicateVersion)
  const next = `${withoutDuplicateVersion.slice(0, range.start)}${EMPTY_UNRELEASED}

## [${version}] - ${date}

${notes}
${withoutDuplicateVersion.slice(range.end)}`
  return replaceOrAppendLinkRefs(next, version)
}

export function latestRcForVersion(tags: string[], version: string): ParsedReleaseTag | null {
  return parseReleaseTags(tags)
    .filter((tag) => tag.rc !== null && baseVersion(tag) === version)
    .at(-1) ?? null
}

function rcTagsForVersion(tags: string[], version: string): ParsedReleaseTag[] {
  return parseReleaseTags(tags).filter((tag) => tag.rc !== null && baseVersion(tag) === version)
}

export function releaseNotesForTarget(
  changelog: string,
  target: ParsedReleaseTag,
  opts: { verb: ReleaseVerb },
  tags: string[] = [],
): { body: string; bulletCount: number } {
  const unreleased = unreleasedRange(changelog).body
  if (opts.verb !== 'promote') {
    if (!hasBullets(unreleased)) {
      throw new Error('CHANGELOG.md [Unreleased] has no release-note bullets')
    }
    return { body: stripEmptyChangelogSections(unreleased), bulletCount: bulletCount(unreleased) }
  }

  const rcs = rcTagsForVersion(tags, target.version)
  if (rcs.length === 0) throw new Error(`No release candidate notes found for ${target.version}`)
  const rcNotes = rcs
    .map((rc) => versionRange(changelog, rc.version)?.body.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
  const extraNotes = hasBullets(unreleased) ? unreleased.trim() : ''
  const notes = stripEmptyChangelogSections([rcNotes, extraNotes].filter(Boolean).join('\n\n'))
  if (!hasBullets(notes)) {
    throw new Error(`CHANGELOG.md has no release-note bullets for ${target.version} release candidates or [Unreleased]`)
  }
  return { body: notes, bulletCount: bulletCount(notes) }
}

const PLACEHOLDER_NOTES = '### Added\n\n### Changed\n\n### Fixed'

/**
 * Insert an empty `## [version]` section with the standard subheadings and no
 * bullets. Used when preparing a release branch before notes are written — the
 * skeleton is filled in on the branch, and CI's note extraction is the gate
 * that refuses to publish a section that is still empty.
 *
 * No-ops if the section already exists, so it can never overwrite notes that
 * have already been written for this version.
 */
export function scaffoldVersionSection(changelog: string, version: string, date: string): string {
  const target = parseReleaseTag(`v${version}`)
  if (!target) throw new Error(`Malformed release version: ${version}`)
  if (versionRange(changelog, version)) return changelog
  return insertVersionNotes(changelog, version, date, PLACEHOLDER_NOTES)
}

export function moveUnreleasedToVersion(changelog: string, version: string, date: string): string {
  const target = parseReleaseTag(`v${version}`)
  if (!target) throw new Error(`Malformed release version: ${version}`)
  const notes = releaseNotesForTarget(changelog, target, { verb: 'patch' })
  return insertVersionNotes(changelog, version, date, notes.body)
}

export function moveReleaseNotesToVersion(
  changelog: string,
  target: ParsedReleaseTag,
  date: string,
  opts: { verb: ReleaseVerb; tags?: string[] },
): string {
  const notes = releaseNotesForTarget(changelog, target, opts, opts.tags ?? [])
  const source = opts.verb === 'promote'
    ? removeRcSectionsForVersion(changelog, target.version, opts.tags ?? [])
    : changelog
  return insertVersionNotes(source, target.version, date, notes.body)
}

export function releaseWorkflowUrlFromRuns(json: string, targetTag: string): string | null {
  const runs = JSON.parse(json) as ReleaseWorkflowRun[]
  const runInfo = runs.find((item) => item.headBranch === targetTag && item.url)
  return runInfo?.url ?? null
}

export function parseArgs(argv: string[]): CliOptions {
  const args = [...argv]
  const dryRun = args.includes('--dry-run')
  const prerelease = args.includes('--rc') || process.env.RELEASE_PRERELEASE === '1'
  const yes = args.includes('--yes') || process.env.RELEASE_YES === '1'
  const filtered = args.filter((arg) => arg !== '--dry-run' && arg !== '--rc' && arg !== '--yes')
  const verb = (filtered[0] ?? process.env.RELEASE_BUMP ?? '') as ReleaseVerb
  if (!['patch', 'minor', 'major', 'promote'].includes(verb)) {
    throw new Error('Usage: bun run release {patch|minor|major} [--rc] [--dry-run] OR bun run release promote')
  }
  if (filtered.length > 1) {
    throw new Error(`Unexpected release arguments: ${filtered.slice(1).join(' ')}`)
  }
  if (verb === 'promote' && prerelease) {
    throw new Error('release promote cannot be combined with --rc')
  }
  return { verb, prerelease, dryRun, yes }
}

async function main(): Promise<void> {
  throw new Error('Local release publishing has been retired. Use `bun run release ...` to prepare a release branch, then run the GitHub Actions Release workflow to publish.')
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
