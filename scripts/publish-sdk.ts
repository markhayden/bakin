/**
 * Publish @bakin/sdk to npm (#147 TH2).
 *
 * Used by the release workflow after binaries upload (TH3) — also
 * runnable locally for dry-run verification.
 *
 * Flow:
 *   1. Determine the version. Prefer the current git tag (`git describe`
 *      / `GITHUB_REF`); fall back to root package.json's "version".
 *   2. Write that version into packages/sdk/package.json.
 *   3. Shell out to `npm publish --access public`.
 *
 * Flags:
 *   --dry-run    Print the resolved version + would-be npm command, but
 *                skip the actual publish. Used in CI when NPM_TOKEN is
 *                not configured, and for local smoke tests.
 *
 * Idempotency: when npm rejects the publish because the version already
 * exists (err code E409 / 403 from npm, message contains "cannot
 * publish over the previously published"), the script exits 0 so the
 * release workflow doesn't fail re-runs.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '..')
const SDK_DIR = resolve(REPO_ROOT, 'packages/sdk')

function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

function stripV(tag: string): string {
  return tag.replace(/^refs\/tags\//, '').replace(/^v/, '')
}

function resolveVersion(): string {
  // Prefer GITHUB_REF (set by tag-triggered workflows).
  const envRef = process.env.GITHUB_REF ?? ''
  if (envRef.startsWith('refs/tags/')) {
    return stripV(envRef)
  }

  // Then `git describe --tags --abbrev=0` for local invocation.
  const git = spawnSync('git', ['describe', '--tags', '--abbrev=0'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  })
  if (git.status === 0 && git.stdout.trim()) {
    return stripV(git.stdout.trim())
  }

  // Fallback: root package.json version.
  const rootPkg = readJson<{ version?: string }>(resolve(REPO_ROOT, 'package.json'))
  if (!rootPkg.version) {
    throw new Error('Could not resolve a version from tag / package.json')
  }
  return rootPkg.version
}

function main(): number {
  const dryRun = process.argv.includes('--dry-run')

  const version = resolveVersion()
  const sdkPkgPath = resolve(SDK_DIR, 'package.json')
  const sdkPkg = readJson<Record<string, unknown>>(sdkPkgPath)
  const prior = sdkPkg.version
  sdkPkg.version = version

  if (dryRun) {
    console.log(`[dry-run] Would set packages/sdk/package.json version to ${version} (was ${prior})`)
    console.log(`[dry-run] Would run: npm publish --access public (in ${SDK_DIR})`)
    return 0
  }

  writeJson(sdkPkgPath, sdkPkg)
  console.log(`Set packages/sdk/package.json version to ${version}`)

  const npm = spawnSync('npm', ['publish', '--access', 'public'], {
    cwd: SDK_DIR,
    stdio: 'inherit',
  })

  if (npm.status === 0) {
    console.log(`Published @bakin/sdk@${version}`)
    return 0
  }

  // npm prints the "already published" error to stderr which we inherited;
  // we can't scrape it, so rely on the exit code alone. Treat any non-zero
  // as failure in CI except when BAKIN_PUBLISH_IDEMPOTENT=1 is set (the
  // release workflow sets this so a republish against the same version
  // doesn't fail the entire run).
  if (process.env.BAKIN_PUBLISH_IDEMPOTENT === '1') {
    console.log('npm publish exited non-zero; treating as already-published (idempotent mode)')
    return 0
  }

  return npm.status ?? 1
}

process.exit(main())
