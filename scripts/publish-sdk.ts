/**
 * Build and publish the public SDK package.
 *
 * The source workspace package is intentionally not publishable directly.
 * This script always publishes from a generated package directory and uses
 * npm trusted publishing in CI instead of a long-lived npm token. Provenance
 * is opt-in because npm only supports GitHub Actions provenance for public
 * source repositories.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { PUBLIC_SDK_PACKAGE_NAME, buildSdkPackage } from './build-sdk-package'

const REPO_ROOT = resolve(import.meta.dir, '..')
const SDK_PACKAGE_NAME = PUBLIC_SDK_PACKAGE_NAME
const RELEASE_VERSION_RE = /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/

export { PUBLIC_SDK_PACKAGE_NAME }

export interface PublishSdkOptions {
  version: string
  packageDir: string
  tag: 'latest' | 'next'
  dryRun: boolean
  keepPackageDir: boolean
  provenance: boolean
}

interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
}

export type CommandRunner = (cmd: string, args: string[], cwd: string) => CommandResult
export type SdkPackageBuilder = (opts: { version: string; outDir: string }) => Promise<void>

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

function runCommand(cmd: string, args: string[], cwd: string): CommandResult {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf-8',
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function stripTagPrefix(ref: string): string {
  return ref.replace(/^refs\/tags\//, '').replace(/^v/, '')
}

function versionFromEnv(env: Record<string, string | undefined>): string {
  const refName = env.GITHUB_REF_NAME ?? ''
  if (refName.startsWith('v')) return stripTagPrefix(refName)
  const ref = env.GITHUB_REF ?? ''
  if (ref.startsWith('refs/tags/v')) return stripTagPrefix(ref)
  return ''
}

export function distTagForVersion(version: string): 'latest' | 'next' {
  return version.includes('-rc.') ? 'next' : 'latest'
}

export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): PublishSdkOptions {
  let version = ''
  let packageDir = ''
  let tag = ''
  let dryRun = false
  let keepPackageDir = false
  let provenance = env.NPM_PROVENANCE === '1'

  const takeValue = (index: number, name: string): string => {
    const value = argv[index + 1] ?? ''
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
    return value
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--version') {
      version = takeValue(i, '--version')
      i += 1
    } else if (arg === '--package-dir') {
      packageDir = takeValue(i, '--package-dir')
      i += 1
    } else if (arg === '--tag') {
      tag = takeValue(i, '--tag')
      i += 1
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--keep-package-dir') {
      keepPackageDir = true
    } else if (arg === '--provenance') {
      provenance = true
    } else {
      throw new Error(`Unexpected argument: ${arg}`)
    }
  }

  version ||= versionFromEnv(env)
  if (!RELEASE_VERSION_RE.test(version)) {
    throw new Error('version must be MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-rc.N')
  }

  const resolvedTag = tag || distTagForVersion(version)
  if (resolvedTag !== 'latest' && resolvedTag !== 'next') {
    throw new Error('npm dist-tag must be latest or next')
  }

  return {
    version,
    packageDir: packageDir || join(REPO_ROOT, 'dist/sdk-package'),
    tag: resolvedTag,
    dryRun,
    keepPackageDir,
    provenance,
  }
}

function packageAlreadyExistsResult(result: CommandResult): boolean | null {
  if (result.status === 0) return true
  const output = `${result.stdout}\n${result.stderr}`
  if (/E404|404 Not Found|is not in this registry|No match found/i.test(output)) return false
  return null
}

function echoResult(result: CommandResult): void {
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

function assertGeneratedPackage(packageDir: string, version: string): void {
  const pkgPath = join(packageDir, 'package.json')
  if (!existsSync(pkgPath)) throw new Error(`SDK package was not generated: ${pkgPath}`)
  const pkg = readJson<{ name?: string; version?: string }>(pkgPath)
  if (pkg.name !== SDK_PACKAGE_NAME) throw new Error(`Generated package name is ${pkg.name}, expected ${SDK_PACKAGE_NAME}`)
  if (pkg.version !== version) throw new Error(`Generated package version is ${pkg.version}, expected ${version}`)
}

export async function publishSdkPackage(
  opts: PublishSdkOptions,
  deps: {
    runner?: CommandRunner
    builder?: SdkPackageBuilder
  } = {},
): Promise<'published' | 'exists' | 'dry-run'> {
  const runner = deps.runner ?? runCommand
  const builder = deps.builder ?? buildSdkPackage
  const packageDir = resolve(opts.packageDir)

  await builder({ version: opts.version, outDir: packageDir })
  assertGeneratedPackage(packageDir, opts.version)

  const viewArgs = ['view', `${SDK_PACKAGE_NAME}@${opts.version}`, 'version', '--json']
  const publishArgs = ['publish', ...(opts.provenance ? ['--provenance'] : []), '--access', 'public', '--tag', opts.tag]

  if (opts.dryRun) {
    console.log(`[dry-run] Built ${SDK_PACKAGE_NAME}@${opts.version} at ${packageDir}`)
    console.log(`[dry-run] Would run: npm ${viewArgs.join(' ')}`)
    console.log(`[dry-run] Would run: npm ${publishArgs.join(' ')} (in ${packageDir})`)
    return 'dry-run'
  }

  const view = runner('npm', viewArgs, REPO_ROOT)
  const exists = packageAlreadyExistsResult(view)
  if (exists === true) {
    echoResult(view)
    console.log(`${SDK_PACKAGE_NAME}@${opts.version} already exists on npm; skipping publish`)
    return 'exists'
  }
  if (exists === null) {
    echoResult(view)
    throw new Error(`Could not check npm package version ${SDK_PACKAGE_NAME}@${opts.version}`)
  }

  const publish = runner('npm', publishArgs, packageDir)
  echoResult(publish)
  if (publish.status !== 0) {
    throw new Error(`npm publish failed for ${SDK_PACKAGE_NAME}@${opts.version}`)
  }
  console.log(`Published ${SDK_PACKAGE_NAME}@${opts.version} with dist-tag ${opts.tag}`)
  return 'published'
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const shouldCleanup = !opts.keepPackageDir && !process.argv.includes('--package-dir')
  const packageDir = shouldCleanup ? mkdtempSync(join(tmpdir(), 'bakin-sdk-package-')) : opts.packageDir
  try {
    await publishSdkPackage({ ...opts, packageDir })
  } finally {
    if (shouldCleanup) rmSync(packageDir, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
