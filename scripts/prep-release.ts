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
  hasUnreleasedBullets,
  moveReleaseNotesToVersion,
  parseReleaseTag,
  resolveReleaseTarget,
  scaffoldVersionSection,
  versionSectionBody,
} from './release'

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

function countBullets(body: string): number {
  return (body.match(/^\s*-\s+\S/gm) ?? []).length
}

export function prepareChangelog(changelog: string, tag: string, date: string): { changelog: string; changed: boolean; bulletCount: number } {
  const target = parseReleaseTag(tag)
  if (!target) throw new Error(`Malformed release tag: ${tag}`)

  // Idempotent: the target section already exists, leave it untouched.
  const existing = versionSectionBody(changelog, target.version)
  if (existing !== null) {
    return { changelog, changed: false, bulletCount: countBullets(existing) }
  }

  // Notes were written under [Unreleased] — promote them into the version section.
  if (hasUnreleasedBullets(changelog)) {
    const next = moveReleaseNotesToVersion(changelog, target, date, {
      verb: target.rc === null ? 'patch' : 'minor',
      tags: [],
    })
    return { changelog: next, changed: next !== changelog, bulletCount: countBullets(versionSectionBody(next, target.version) ?? '') }
  }

  // No notes yet: scaffold an empty section to fill in on the release branch.
  // CI's note extraction is the gate that refuses to publish an empty section.
  const next = scaffoldVersionSection(changelog, target.version, date)
  return { changelog: next, changed: true, bulletCount: 0 }
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

  if (prepared.bulletCount === 0) {
    console.log('')
    console.log(`⚠  No release notes yet — scaffolded an empty ## [${parseReleaseTag(tag)?.version}] section.`)
    console.log('   Fill in the bullets on the release branch before you push the tag.')
    console.log('   CI extracts notes from the committed CHANGELOG and will reject an empty section.')
  }

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
