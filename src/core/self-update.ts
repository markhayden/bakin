/**
 * `bakin update` — self-replacing binary update (#147 TG4).
 *
 * Flow:
 *   1. GET GitHub's latest stable release, falling back to the releases list
 *      when the repo only has prereleases.
 *   2. Pick the asset named `bakin-<platform>-<arch>.tar.gz`.
 *   3. Download it alongside `checksums.txt`.
 *   4. Verify the archive SHA256 against the listed value.
 *   5. Extract the `bakin` executable from the archive.
 *   6. Write to `<currentBinaryPath>.new`, then rename over the running
 *      binary atomically.
 *   7. Tell the user to restart.
 *
 * Never auto-restarts. The running process keeps its file-descriptor-based
 * reference to the old inode, so the rename is safe on both macOS and Linux.
 * Any network failure / checksum mismatch leaves the old binary intact.
 *
 * Exit codes: 0 success, 1 on any failure.
 */
import { existsSync, renameSync, unlinkSync, chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { downloadToFile } from '@bakin/core/net/download'

import { extractBakinFromTarGz, releaseArchiveNameForTriple } from './release-archive'

export const LATEST_RELEASE_API = 'https://api.github.com/repos/markhayden/bakin/releases/latest'
export const RELEASES_API = 'https://api.github.com/repos/markhayden/bakin/releases?per_page=20'
export const GITHUB_HEADERS = { 'User-Agent': 'bakin-self-update', Accept: 'application/vnd.github+json' }
/** A release-metadata request that takes longer than this is a dead endpoint, not a slow one. */
export const RELEASE_FETCH_TIMEOUT_MS = 30_000
/** One whole archive transfer (headers + body); the shared primitive also fails a body that stalls for 30 s. */
export const RELEASE_DOWNLOAD_TIMEOUT_MS = 10 * 60_000

export interface GithubAsset {
  name: string
  browser_download_url: string
}

export interface GithubRelease {
  tag_name: string
  draft?: boolean
  prerelease?: boolean
  assets: GithubAsset[]
  /** The release page — the Updates row's notes link. */
  html_url?: string
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

export type SelfUpdateStage = 'download' | 'verify' | 'extract' | 'replace'

export interface SelfUpdateOptions {
  execPath?: string
  platform?: string
  arch?: string
  fetchRelease?: (reporter: Pick<SelfUpdateReporter, 'log'>, signal?: AbortSignal) => Promise<GithubRelease>
  downloadTo?: (url: string, dest: string, opts: { signal?: AbortSignal }) => Promise<void>
  /**
   * Cancels the update while it is still reversible (review r4 #4): the
   * release fetch and both transfers abort, staging is removed, the running
   * binary is untouched. Checked again before the extract and the swap.
   */
  signal?: AbortSignal
  /**
   * Staging files live at `<exec>.<suffix>.*` (#1007 D7.11): the operation
   * keys this by its id so no two attempts ever share a path. Default `new`.
   */
  stagingSuffix?: string
  /** Progress for an operation wrapper; never affects the outcome. */
  onStage?: (stage: SelfUpdateStage) => void
  /**
   * Runs after the new binary is verified and extracted, BEFORE the swap —
   * the operation proves the restart path here. A throw aborts the update
   * with the staged files cleaned up and the running binary untouched.
   */
  beforeReplace?: (staged: { release: GithubRelease; newPath: string }) => Promise<void>
  /**
   * The release the operator approved (#1007 review): the update refuses to
   * install anything else — a newer release published since the preview is
   * reported, never silently installed.
   */
  expectedVersion?: string
}

/** The caller's signal joined with a request deadline — neither the headers nor the body read can outlive it. */
function boundedSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)
  const forward = () => controller.abort(signal?.reason)
  if (signal?.aborted) forward()
  else signal?.addEventListener('abort', forward, { once: true })
  return { signal: controller.signal, release: () => { clearTimeout(timer); signal?.removeEventListener('abort', forward) } }
}

async function fetchGithubJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const bounded = boundedSignal(signal, RELEASE_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: GITHUB_HEADERS, signal: bounded.signal })
    if (!res.ok) throw new ReleaseFetchError(res.status, url)
    return (await res.json()) as T
  } finally {
    bounded.release()
  }
}

export async function fetchLatestRelease(reporter: Pick<SelfUpdateReporter, 'log'>, signal?: AbortSignal): Promise<GithubRelease> {
  reporter.log(`Fetching latest release from ${LATEST_RELEASE_API}`)
  try {
    return await fetchGithubJson<GithubRelease>(LATEST_RELEASE_API, signal)
  } catch (err) {
    if (!(err instanceof ReleaseFetchError) || err.status !== 404) throw err
  }

  reporter.log(`No stable release found; checking releases from ${RELEASES_API}`)
  const releases = await fetchGithubJson<GithubRelease[]>(RELEASES_API, signal)
  const release = releases.find(candidate => !candidate.draft)
  if (!release) throw new Error('HTTP 404; no published releases found')
  return release
}

export function normalizeVersion(value: string): string {
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

export function compareVersions(a: string, b: string): number {
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

export function selfUpdateSupport(currentVersion: string, execPath: string): { supported: true } | { supported: false; reason: string } {
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

export function currentTriple(platform: string = process.platform, arch: string = process.arch): string | null {
  const plat = platform
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

/** The ONE transfer primitive (stall window, attempt deadline, abort — never a raw fetch piped to disk). */
async function downloadTo(url: string, dest: string, opts: { signal?: AbortSignal }): Promise<void> {
  await downloadToFile(url, dest, { signal: opts.signal, timeoutMs: RELEASE_DOWNLOAD_TIMEOUT_MS, label: `Release asset ${basename(dest)}` })
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

function cleanupFiles(paths: string[]): void {
  for (const path of paths) {
    try {
      if (existsSync(path)) unlinkSync(path)
    } catch {
      // Best-effort cleanup should not hide the original update failure.
    }
  }
}

export async function selfUpdate(
  reporter: SelfUpdateReporter = consoleReporter,
  options: SelfUpdateOptions = {},
): Promise<number> {
  const triple = currentTriple(options.platform, options.arch)
  if (!triple) {
    reporter.error(`No prebuilt binary for ${options.platform ?? process.platform}/${options.arch ?? process.arch}`)
    return 1
  }

  const signal = options.signal
  const cancelled = (): boolean => signal?.aborted === true
  const CANCELLED = 'Update cancelled; the running binary was left untouched.'

  let release: GithubRelease
  try {
    release = await (options.fetchRelease ?? fetchLatestRelease)(reporter, signal)
  } catch (err) {
    reporter.error(cancelled() ? CANCELLED : `Could not fetch release info: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
  if (cancelled()) { reporter.error(CANCELLED); return 1 }

  if (options.expectedVersion !== undefined && normalizeVersion(release.tag_name) !== normalizeVersion(options.expectedVersion)) {
    reporter.error(`Release changed: ${release.tag_name} is now the latest, but this update was approved for v${normalizeVersion(options.expectedVersion)}. Check for updates and apply again.`)
    return 1
  }

  const archiveName = releaseArchiveNameForTriple(triple)
  const archiveAsset = release.assets.find(a => a.name === archiveName)
  const sumAsset = release.assets.find(a => a.name === 'checksums.txt')
  if (!archiveAsset) {
    reporter.error(`Release ${release.tag_name} is missing asset ${archiveName}`)
    return 1
  }
  if (!sumAsset) {
    reporter.error(`Release ${release.tag_name} is missing checksums.txt`)
    return 1
  }

  const currentPath = options.execPath ?? process.execPath
  const suffix = options.stagingSuffix ?? 'new'
  const newPath = `${currentPath}.${suffix}`
  const archivePath = `${currentPath}.${suffix}.${archiveName}`
  const sumsPath = `${currentPath}.${suffix}.checksums.txt`
  const tempPaths = [newPath, archivePath, sumsPath]
  const download = options.downloadTo ?? downloadTo

  try {
    options.onStage?.('download')
    reporter.log(`Downloading ${archiveAsset.name} (${release.tag_name})...`)
    await download(archiveAsset.browser_download_url, archivePath, { signal })
    await download(sumAsset.browser_download_url, sumsPath, { signal })
  } catch (err) {
    cleanupFiles(tempPaths)
    reporter.error(cancelled() ? CANCELLED : `Download failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
  if (cancelled()) { cleanupFiles(tempPaths); reporter.error(CANCELLED); return 1 }

  options.onStage?.('verify')
  let sums: Map<string, string>
  try {
    sums = parseChecksums(readFileSync(sumsPath, 'utf-8'))
  } catch (err) {
    cleanupFiles(tempPaths)
    reporter.error(`Could not parse checksums.txt: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const expected = sums.get(archiveName)
  if (!expected) {
    cleanupFiles(tempPaths)
    reporter.error(`checksums.txt has no entry for ${archiveName}`)
    return 1
  }

  let actual: string
  try {
    actual = await sha256File(archivePath)
  } catch (err) {
    cleanupFiles(tempPaths)
    reporter.error(`Could not hash downloaded file: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  if (actual.toLowerCase() !== expected.toLowerCase()) {
    cleanupFiles(tempPaths)
    reporter.error(`Checksum mismatch for ${archiveName}`)
    reporter.error(`  expected: ${expected}`)
    reporter.error(`  actual:   ${actual}`)
    return 1
  }

  if (cancelled()) { cleanupFiles(tempPaths); reporter.error(CANCELLED); return 1 }
  options.onStage?.('extract')
  try {
    writeFileSync(newPath, extractBakinFromTarGz(readFileSync(archivePath)))
  } catch (err) {
    cleanupFiles(tempPaths)
    reporter.error(`Could not extract ${archiveName}: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  if (options.beforeReplace) {
    try {
      await options.beforeReplace({ release, newPath })
    } catch (err) {
      cleanupFiles(tempPaths)
      reporter.error(`Not replacing the binary: ${err instanceof Error ? err.message : String(err)}`)
      return 1
    }
  }
  // The last reversible moment: after this the swap is the point of no return.
  if (cancelled()) { cleanupFiles(tempPaths); reporter.error(CANCELLED); return 1 }
  options.onStage?.('replace')
  try {
    chmodSync(newPath, 0o755)
    renameSync(newPath, currentPath)
    cleanupFiles([archivePath, sumsPath])
  } catch (err) {
    cleanupFiles(tempPaths)
    reporter.error(`Could not replace binary: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  reporter.log(`Updated to ${release.tag_name}. Restart to run the new version.`)
  return 0
}
