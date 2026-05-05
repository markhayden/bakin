/**
 * Stamp the build-time Bakin version from git tags.
 *
 * Git release tags are the source of truth. Untagged local builds use a
 * dev-ish version string so they are visibly non-publishable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '..')
const GENERATED_VERSION_PATH = resolve(REPO_ROOT, 'packages/core/src/generated-version.ts')
const FALLBACK_VERSION = '0.0.0-dev'

export const RELEASE_TAG_RE = /^v\d+\.\d+\.\d+(-rc\.\d+)?$/
const DESCRIBE_VERSION_RE = /^(v\d+\.\d+\.\d+(?:-rc\.\d+)?)(?:-\d+-g[0-9a-f]+(?:-dirty)?)?$/

export interface GitResult {
  status: number | null
  stdout: string
}

export type GitRunner = (args: string[]) => GitResult

export function stripReleaseTag(tagOrRef: string): string {
  return tagOrRef.replace(/^refs\/tags\//, '').replace(/^v/, '')
}

function envValue(env: Record<string, string | undefined>, key: string): string {
  return env[key] ?? ''
}

function runGit(args: string[]): GitResult {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
  }
}

function cleanStdout(result: GitResult): string | null {
  if (result.status !== 0) return null
  const stdout = result.stdout.trim()
  return stdout.length > 0 ? stdout : null
}

function releaseVersionFromExactTag(tag: string): string | null {
  return RELEASE_TAG_RE.test(tag) ? stripReleaseTag(tag) : null
}

function releaseVersionFromDescribe(describe: string): string | null {
  const match = DESCRIBE_VERSION_RE.exec(describe)
  if (!match) return null
  return describe.replace(/^v/, '')
}

export function resolveVersion(opts: {
  env?: Record<string, string | undefined>
  git?: GitRunner
} = {}): string {
  const env = opts.env ?? process.env
  const git = opts.git ?? runGit

  const githubRef = envValue(env, 'GITHUB_REF')
  if (githubRef.startsWith('refs/tags/v')) {
    const tag = githubRef.replace(/^refs\/tags\//, '')
    const version = releaseVersionFromExactTag(tag)
    if (!version) throw new Error(`Malformed release tag: ${tag}`)
    return version
  }

  const exact = cleanStdout(git(['describe', '--tags', '--exact-match', '--match', 'v[0-9]*']))
  if (exact) {
    const version = releaseVersionFromExactTag(exact)
    if (version) return version
  }

  const nearest = cleanStdout(git(['describe', '--tags', '--match', 'v[0-9]*', '--abbrev=7', '--dirty']))
  if (nearest) {
    const version = releaseVersionFromDescribe(nearest)
    if (version) return version
  }

  return FALLBACK_VERSION
}

export function writeGeneratedVersion(path: string, version: string): boolean {
  const content = `export const APP_VERSION = '${version}'\n`
  if (existsSync(path) && readFileSync(path, 'utf-8') === content) {
    return false
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf-8')
  return true
}

export function stampVersion(): { version: string; wrote: boolean; path: string } {
  const version = resolveVersion()
  const wrote = writeGeneratedVersion(GENERATED_VERSION_PATH, version)
  return { version, wrote, path: GENERATED_VERSION_PATH }
}

async function main(): Promise<void> {
  const result = stampVersion()
  const action = result.wrote ? 'Stamped' : 'Version already stamped'
  console.log(`${action}: ${result.version} (${result.path})`)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
