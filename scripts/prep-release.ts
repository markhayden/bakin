/**
 * Prepare a release branch without publishing.
 *
 * This is intentionally narrower than scripts/release.ts: it computes the
 * release version from remote tags, updates CHANGELOG.md, and can optionally
 * create the release branch. It never creates tags or pushes.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  moveReleaseNotesToVersion,
  parseReleaseTag,
  resolveReleaseTarget,
} from './release'
import { extractReleaseNotes } from './extract-release-notes'

const REPO_ROOT = resolve(import.meta.dir, '..')
const CHANGELOG_PATH = resolve(REPO_ROOT, 'CHANGELOG.md')
const VERSION_RE = /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/

type BumpVerb = 'patch' | 'minor' | 'major'

interface PrepOptions {
  bump: BumpVerb | null
  version: string
  prerelease: boolean
  date: string
  dryRun: boolean
  createBranch: boolean
}

interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
}

function run(cmd: string, args: string[]): CommandResult {
  const result = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
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

function takeValue(argv: string[], index: number, name: string): string {
  const value = argv[index + 1] ?? ''
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

export function parsePrepArgs(argv: string[], today = new Date().toISOString().slice(0, 10)): PrepOptions {
  let bump: BumpVerb | null = null
  let version = ''
  let prerelease = false
  let date = today
  let dryRun = false
  let createBranch = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === 'patch' || arg === 'minor' || arg === 'major') {
      if (bump) throw new Error('Only one bump type is allowed')
      bump = arg
    } else if (arg === '--version') {
      version = takeValue(argv, i, '--version')
      i += 1
    } else if (arg === '--rc') {
      prerelease = true
    } else if (arg === '--date') {
      date = takeValue(argv, i, '--date')
      i += 1
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--create-branch') {
      createBranch = true
    } else {
      throw new Error(`Unexpected argument: ${arg}`)
    }
  }

  if (version && bump) throw new Error('Use either a bump type or --version, not both')
  if (!version && !bump) throw new Error('Usage: bun run release {patch|minor|major} [--rc] [--create-branch] [--dry-run] OR bun run release --version <version>')
  if (version && !VERSION_RE.test(version)) throw new Error('version must be MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-rc.N')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must be YYYY-MM-DD')

  return { bump, version, prerelease, date, dryRun, createBranch }
}

function tagsFromLsRemote(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[1] ?? '')
    .filter((ref) => ref.startsWith('refs/tags/v') && !ref.endsWith('^{}'))
    .map((ref) => ref.replace(/^refs\/tags\//, ''))
}

export function targetTagForPrep(opts: PrepOptions, remoteTags: string[]): string {
  if (opts.version) return `v${opts.version}`
  if (!opts.bump) throw new Error('bump type is required')
  return resolveReleaseTarget(remoteTags, { verb: opts.bump, prerelease: opts.prerelease })
}

export function prepareChangelog(changelog: string, tag: string, date: string): { changelog: string; changed: boolean; bulletCount: number } {
  const target = parseReleaseTag(tag)
  if (!target) throw new Error(`Malformed release tag: ${tag}`)

  if (changelog.includes(`## [${target.version}]`)) {
    const notes = extractReleaseNotes(changelog, target.version)
    const bulletCount = (notes.match(/^\s*-\s+\S/gm) ?? []).length
    return { changelog, changed: false, bulletCount }
  }

  const next = moveReleaseNotesToVersion(changelog, target, date, {
    verb: target.rc === null ? 'patch' : 'minor',
    tags: [],
  })
  const notes = extractReleaseNotes(next, target.version)
  return { changelog: next, changed: next !== changelog, bulletCount: (notes.match(/^\s*-\s+\S/gm) ?? []).length }
}

function remoteReleaseTags(): string[] {
  return tagsFromLsRemote(git(['ls-remote', '--tags', 'origin', 'refs/tags/v*']))
}

function assertWorktreeCleanForPrep(): void {
  const status = git(['status', '--porcelain'])
  if (status.trim()) throw new Error(`Worktree is not clean:\n${status}`)
}

function createReleaseBranch(tag: string): string {
  const branch = `release/${tag}`
  git(['switch', '-c', branch])
  return branch
}

async function main(): Promise<void> {
  const opts = parsePrepArgs(process.argv.slice(2))
  assertWorktreeCleanForPrep()

  const tag = targetTagForPrep(opts, remoteReleaseTags())
  const current = readFileSync(CHANGELOG_PATH, 'utf-8')
  const prepared = prepareChangelog(current, tag, opts.date)
  const branch = opts.createBranch ? `release/${tag}` : ''

  console.log('Release prep')
  console.log('------------')
  console.log(`Target tag:      ${tag}`)
  console.log(`Date:            ${opts.date}`)
  console.log(`CHANGELOG notes: ${prepared.bulletCount} bullets`)
  console.log(`Branch:          ${branch || '(not creating; pass --create-branch)'}`)
  console.log(`Mode:            ${opts.dryRun ? 'dry-run' : 'write'}`)

  if (opts.dryRun) return
  if (opts.createBranch) createReleaseBranch(tag)
  if (prepared.changed) writeFileSync(CHANGELOG_PATH, prepared.changelog, 'utf-8')
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
