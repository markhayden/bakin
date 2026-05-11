/**
 * Local release driver.
 *
 * This script owns version bumping, CHANGELOG movement, release commit/tag,
 * and the atomic push that starts `.github/workflows/release.yml`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const REPO_ROOT = resolve(import.meta.dir, '..')
const CHANGELOG_PATH = resolve(REPO_ROOT, 'CHANGELOG.md')
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

interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
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
    return { major: 0, minor: 1, patch: 0 }
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

export function assertHasUnreleasedBullets(changelog: string): void {
  const range = unreleasedRange(changelog)
  if (!hasBullets(range.body)) {
    throw new Error('CHANGELOG.md [Unreleased] has no release-note bullets')
  }
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

function run(cmd: string, args: string[], opts: { inherit?: boolean } = {}): CommandResult {
  const result = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    stdio: opts.inherit ? 'inherit' : 'pipe',
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function requireOk(label: string, result: CommandResult): string {
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

function git(args: string[]): string {
  return requireOk(`git ${args.join(' ')}`, run('git', args))
}

function gh(args: string[]): string {
  return requireOk(`gh ${args.join(' ')}`, run('gh', args))
}

export function releaseWorkflowUrlFromRuns(json: string, targetTag: string): string | null {
  const runs = JSON.parse(json) as ReleaseWorkflowRun[]
  const runInfo = runs.find((item) => item.headBranch === targetTag && item.url)
  return runInfo?.url ?? null
}

function releaseWorkflowFallbackUrl(targetTag: string): string {
  const query = encodeURIComponent(`branch:${targetTag}`)
  return `https://github.com/markhayden/bakin/actions/workflows/release.yml?query=${query}`
}

function releaseWorkflowUrl(targetTag: string): string | null {
  const output = gh([
    'run', 'list',
    '--workflow', 'Release',
    '--branch', targetTag,
    '--json', 'conclusion,databaseId,headBranch,status,url',
    '--limit', '10',
  ])
  return releaseWorkflowUrlFromRuns(output, targetTag)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function waitForReleaseWorkflowUrl(
  targetTag: string,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<string | null> {
  const attempts = opts.attempts ?? 12
  const delayMs = opts.delayMs ?? 5_000
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const url = releaseWorkflowUrl(targetTag)
      if (url) return url
    } catch {
      // The release tag is already pushed; workflow discovery is best-effort UX.
    }
    if (attempt < attempts) await sleep(delayMs)
  }
  return null
}

function listReleaseTags(): string[] {
  const output = git(['tag', '--list', 'v[0-9]*'])
  return output.split('\n').map((tag) => tag.trim()).filter(Boolean)
}

function assertWorktreeClean(): void {
  const status = git(['status', '--porcelain'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.endsWith('packages/core/src/generated-version.ts'))
  if (status.length > 0) {
    throw new Error(`Worktree is not clean:\n${status.join('\n')}`)
  }
}

function assertTagDoesNotExist(tag: string): void {
  const local = run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`])
  if (local.status === 0) throw new Error(`Tag already exists locally: ${tag}`)
  const remote = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])
  if (remote.trim()) throw new Error(`Tag already exists on origin: ${tag}`)
}

function assertMainCiGreen(head: string): string {
  const output = gh([
    'run', 'list',
    '--workflow', 'Main CI',
    '--branch', 'main',
    '--commit', head,
    '--json', 'conclusion,databaseId,url',
    '--limit', '1',
  ])
  const runs = JSON.parse(output) as Array<{ conclusion?: string; databaseId?: number; url?: string }>
  const runInfo = runs[0]
  if (!runInfo || runInfo.conclusion !== 'success') {
    throw new Error(`Main CI is not green for ${head}`)
  }
  return runInfo.url ?? `run #${runInfo.databaseId}`
}

function preflight(targetTag: string, opts: CliOptions, tags: string[]): { head: string; ciUrl: string; bulletCount: number } {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== 'main') throw new Error(`Release must be cut from main, currently on ${branch}`)

  assertWorktreeClean()
  git(['fetch', 'origin', 'main'])
  const head = git(['rev-parse', 'HEAD'])
  const originMain = git(['rev-parse', 'origin/main'])
  if (head !== originMain) throw new Error('Local main does not match origin/main')

  const ciUrl = assertMainCiGreen(head)
  assertTagDoesNotExist(targetTag)
  const target = parseReleaseTag(targetTag)
  if (!target) throw new Error(`Malformed release tag: ${targetTag}`)
  const changelog = readFileSync(CHANGELOG_PATH, 'utf-8')
  const notes = releaseNotesForTarget(changelog, target, opts, tags)
  return { head, ciUrl, bulletCount: notes.bulletCount }
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

async function confirmProceed(targetTag: string, yes: boolean): Promise<void> {
  if (yes) return
  const rl = createInterface({ input, output })
  try {
    const answer = await rl.question(`Proceed with ${targetTag}? [y/N] `)
    if (answer.trim().toLowerCase() !== 'y') {
      throw new Error('Release cancelled')
    }
  } finally {
    rl.close()
  }
}

function printPlan(targetTag: string, opts: CliOptions, preflightResult: { head: string; ciUrl: string; bulletCount: number }): void {
  const parsed = parseReleaseTag(targetTag)
  if (!parsed) throw new Error(`Malformed release tag: ${targetTag}`)
  const channel = parsed.rc === null ? 'stable (npm dist-tag: latest)' : 'rc (npm dist-tag: next)'
  console.log('Release plan')
  console.log('------------')
  console.log(`Target version:  ${targetTag}`)
  console.log(`Channel:         ${channel}`)
  console.log(`Action:          ${opts.verb}${opts.prerelease ? ' --rc' : ''}`)
  console.log(`Head:            ${preflightResult.head.slice(0, 12)}`)
  console.log(`Main CI:         ${preflightResult.ciUrl}`)
  console.log(`CHANGELOG notes: ${preflightResult.bulletCount} bullets`)
  console.log(`Mode:            ${opts.dryRun ? 'dry-run' : 'write'}`)
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
