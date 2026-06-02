/**
 * `bakin update` — self-replacing binary update (#147 TG4).
 *
 * Flow:
 *   1. GET GitHub's latest stable release, falling back to the releases list
 *      when the repo only has prereleases.
 *   2. Pick the asset whose name ends in `bakin-<platform>-<arch>`.
 *   3. Download it alongside `checksums.txt`.
 *   4. Verify SHA256 against the listed value.
 *   5. Write to `<currentBinaryPath>.new`, then rename over the running
 *      binary atomically.
 *   6. Tell the user to restart.
 *
 * Never auto-restarts. The running process keeps its file-descriptor-based
 * reference to the old inode, so the rename is safe on both macOS and Linux.
 * Any network failure / checksum mismatch leaves the old binary intact.
 *
 * Exit codes: 0 success, 1 on any failure.
 */
import { createWriteStream, existsSync, renameSync, unlinkSync, chmodSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { basename } from 'node:path'

const LATEST_RELEASE_API = 'https://api.github.com/repos/markhayden/bakin/releases/latest'
const RELEASES_API = 'https://api.github.com/repos/markhayden/bakin/releases?per_page=20'
const GITHUB_HEADERS = { 'User-Agent': 'bakin-self-update', Accept: 'application/vnd.github+json' }

export interface GithubAsset {
  name: string
  browser_download_url: string
}

export interface GithubRelease {
  tag_name: string
  draft?: boolean
  prerelease?: boolean
  assets: GithubAsset[]
}

export interface SelfUpdateReporter {
  log: (message: string) => void
  error: (message: string) => void
}

const consoleReporter: SelfUpdateReporter = {
  log: message => console.log(message),
  error: message => console.error(message),
}

class ReleaseFetchError extends Error {
  constructor(public readonly status: number, public readonly url: string) {
    super(`HTTP ${status}`)
  }
}

export interface SelfUpdateStatus {
  supported: boolean
  currentVersion: string
  latestVersion: string | null
  latestTag: string | null
  updateAvailable: boolean
  checkedAt: string
  reason?: string
  error?: string
}

export interface SelfUpdateStatusOptions {
  currentVersion: string
  execPath?: string
  fetchRelease?: () => Promise<GithubRelease>
  now?: () => Date
}

async function fetchGithubJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: GITHUB_HEADERS })
  if (!res.ok) throw new ReleaseFetchError(res.status, url)
  return (await res.json()) as T
}

export async function fetchLatestRelease(reporter: Pick<SelfUpdateReporter, 'log'>): Promise<GithubRelease> {
  reporter.log(`Fetching latest release from ${LATEST_RELEASE_API}`)
  try {
    return await fetchGithubJson<GithubRelease>(LATEST_RELEASE_API)
  } catch (err) {
    if (!(err instanceof ReleaseFetchError) || err.status !== 404) throw err
  }

  reporter.log(`No stable release found; checking releases from ${RELEASES_API}`)
  const releases = await fetchGithubJson<GithubRelease[]>(RELEASES_API)
  const release = releases.find(candidate => !candidate.draft)
  if (!release) throw new Error('HTTP 404; no published releases found')
  return release
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '')
}

function parseVersion(value: string): { major: number; minor: number; patch: number; prerelease: string | null } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] > right[key]) return 1
    if (left[key] < right[key]) return -1
  }
  if (left.prerelease === right.prerelease) return 0
  if (left.prerelease === null) return 1
  if (right.prerelease === null) return -1
  return left.prerelease.localeCompare(right.prerelease)
}

function selfUpdateSupport(currentVersion: string, execPath: string): { supported: true } | { supported: false; reason: string } {
  const executable = basename(execPath)
  if (currentVersion.includes('dev') || executable === 'bun' || executable.startsWith('bun-')) {
    return { supported: false, reason: 'source/dev runtime' }
  }
  if (!executable.startsWith('bakin')) {
    return { supported: false, reason: `unsupported executable: ${executable}` }
  }
  return { supported: true }
}

export async function getSelfUpdateStatus(options: SelfUpdateStatusOptions): Promise<SelfUpdateStatus> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString()
  const execPath = options.execPath ?? process.execPath
  const support = selfUpdateSupport(options.currentVersion, execPath)
  if (!support.supported) {
    return {
      supported: false,
      currentVersion: options.currentVersion,
      latestVersion: null,
      latestTag: null,
      updateAvailable: false,
      checkedAt,
      reason: support.reason,
    }
  }

  try {
    const release = await (options.fetchRelease ?? (() => fetchLatestRelease({ log: () => {} })))()
    const latestVersion = normalizeVersion(release.tag_name)
    return {
      supported: true,
      currentVersion: options.currentVersion,
      latestVersion,
      latestTag: release.tag_name,
      updateAvailable: compareVersions(latestVersion, options.currentVersion) > 0,
      checkedAt,
    }
  } catch (err) {
    return {
      supported: true,
      currentVersion: options.currentVersion,
      latestVersion: null,
      latestTag: null,
      updateAvailable: false,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function currentTriple(): string | null {
  const plat = process.platform
  const arch = process.arch
  if (plat === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (plat === 'linux' && arch === 'x64') return 'linux-x64'
  if (plat === 'linux' && arch === 'arm64') return 'linux-arm64'
  return null
}

async function sha256File(path: string): Promise<string> {
  const buf = readFileSync(path)
  const hash = createHash('sha256')
  hash.update(buf)
  return hash.digest('hex')
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`download failed for ${url} (HTTP ${res.status})`)
  }
  const nodeStream = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>)
  const out = createWriteStream(dest)
  nodeStream.pipe(out)
  await finished(out)
}

function parseChecksums(text: string): Map<string, string> {
  // Format: "<sha256>  <filename>\n"
  const map = new Map<string, string>()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length < 2) continue
    const [sum, ...rest] = parts
    map.set(rest.join(' ').replace(/^\*/, ''), sum)
  }
  return map
}

export async function selfUpdate(reporter: SelfUpdateReporter = consoleReporter): Promise<number> {
  const triple = currentTriple()
  if (!triple) {
    reporter.error(`No prebuilt binary for ${process.platform}/${process.arch}`)
    return 1
  }

  let release: GithubRelease
  try {
    release = await fetchLatestRelease(reporter)
  } catch (err) {
    reporter.error(`Could not fetch release info: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const binName = `bakin-${triple}`
  const binAsset = release.assets.find(a => a.name === binName)
  const sumAsset = release.assets.find(a => a.name === 'checksums.txt')
  if (!binAsset) {
    reporter.error(`Release ${release.tag_name} is missing asset ${binName}`)
    return 1
  }
  if (!sumAsset) {
    reporter.error(`Release ${release.tag_name} is missing checksums.txt`)
    return 1
  }

  const currentPath = process.execPath
  const newPath = `${currentPath}.new`
  const sumsPath = `${currentPath}.checksums.txt`

  try {
    reporter.log(`Downloading ${binAsset.name} (${release.tag_name})...`)
    await downloadTo(binAsset.browser_download_url, newPath)
    await downloadTo(sumAsset.browser_download_url, sumsPath)
  } catch (err) {
    for (const p of [newPath, sumsPath]) if (existsSync(p)) unlinkSync(p)
    reporter.error(`Download failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  let sums: Map<string, string>
  try {
    sums = parseChecksums(readFileSync(sumsPath, 'utf-8'))
  } catch (err) {
    for (const p of [newPath, sumsPath]) if (existsSync(p)) unlinkSync(p)
    reporter.error(`Could not parse checksums.txt: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const expected = sums.get(binName)
  if (!expected) {
    for (const p of [newPath, sumsPath]) if (existsSync(p)) unlinkSync(p)
    reporter.error(`checksums.txt has no entry for ${binName}`)
    return 1
  }

  let actual: string
  try {
    actual = await sha256File(newPath)
  } catch (err) {
    for (const p of [newPath, sumsPath]) if (existsSync(p)) unlinkSync(p)
    reporter.error(`Could not hash downloaded file: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  if (actual.toLowerCase() !== expected.toLowerCase()) {
    for (const p of [newPath, sumsPath]) if (existsSync(p)) unlinkSync(p)
    reporter.error(`Checksum mismatch for ${binName}`)
    reporter.error(`  expected: ${expected}`)
    reporter.error(`  actual:   ${actual}`)
    return 1
  }

  try {
    chmodSync(newPath, 0o755)
    renameSync(newPath, currentPath)
    if (existsSync(sumsPath)) unlinkSync(sumsPath)
  } catch (err) {
    if (existsSync(newPath)) unlinkSync(newPath)
    if (existsSync(sumsPath)) unlinkSync(sumsPath)
    reporter.error(`Could not replace binary: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  reporter.log(`Updated to ${release.tag_name}. Restart to run the new version.`)
  return 0
}
