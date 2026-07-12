/**
 * Read-only package update checks for UI/CLI status surfaces.
 *
 * This intentionally reuses the installer/updater source fetcher so local and
 * GitHub package provenance are interpreted exactly the same way as real
 * updates. It never writes the lockfile or projection targets.
 */
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { parseManifest } from '../../../packages/core/src/agent-packages/manifest'
import {
  readLockfile,
  type PackageEntry,
} from '../../../packages/core/src/agent-packages/lockfile'
import { fetchSourceAsync, sourceSpecWithRef, type FetchedSource } from './source-fetcher'

export interface PackageUpdateStatus {
  currentVersion: string
  latestVersion: string | null
  currentCommitSha: string
  latestCommitSha: string | null
  upgradeAvailable: boolean
  checkedAt: string
  error?: string
}

interface CheckPackageUpdateOptions {
  now?: () => Date
}

function sourceWithRef(entry: PackageEntry): string {
  return sourceSpecWithRef(entry.source, entry.ref)
}

function stripVersionFromKey(key: string): string {
  const at = key.lastIndexOf('@')
  return at === -1 ? key : key.slice(0, at)
}

function cleanupFetched(fetched: FetchedSource | null): void {
  if (!fetched || !existsSync(fetched.stagingDir)) return
  try {
    rmSync(fetched.stagingDir, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup. The status error should report source/check issues,
    // not transient temp-dir cleanup failures.
  }
}

function statusFromFetched(
  packageId: string,
  entry: PackageEntry,
  fetched: FetchedSource,
  checkedAt: string,
): PackageUpdateStatus {
  const manifestPath = join(fetched.stagingDir, 'bakin-package.json')
  const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))
  if (manifest.id !== stripVersionFromKey(packageId)) {
    throw new Error(`Source manifest id "${manifest.id}" does not match installed package "${packageId}".`)
  }

  const latestCommitSha = fetched.commitSha || null
  const versionChanged = manifest.version !== entry.version
  const commitChanged = Boolean(entry.commitSha && latestCommitSha && latestCommitSha !== entry.commitSha)

  return {
    currentVersion: entry.version,
    latestVersion: manifest.version,
    currentCommitSha: entry.commitSha,
    latestCommitSha,
    upgradeAvailable: versionChanged || commitChanged,
    checkedAt,
  }
}

function statusFromError(entry: PackageEntry, checkedAt: string, err: unknown): PackageUpdateStatus {
  return {
    currentVersion: entry.version,
    latestVersion: null,
    currentCommitSha: entry.commitSha,
    latestCommitSha: null,
    upgradeAvailable: false,
    checkedAt,
    error: err instanceof Error ? err.message : String(err),
  }
}

/**
 * The git/network fetch runs off the event loop (fetchSourceAsync) so a slow
 * remote can't stall the server. The old execFileSync-backed sync variant is
 * deliberately GONE: `/api/agent-packages?check=1` (the Team page) once froze
 * the whole server for N × git-timeout through it — every request, including
 * the plugin manifest, queued behind blocking clones.
 */
export async function checkPackageUpdateAsync(
  packageId: string,
  options: CheckPackageUpdateOptions = {},
): Promise<PackageUpdateStatus> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString()
  const lock = readLockfile()
  const entry = lock.packages[packageId]
  if (!entry) {
    throw new Error(`Package "${packageId}" is not installed.`)
  }

  let fetched: FetchedSource | null = null
  try {
    fetched = await fetchSourceAsync(sourceWithRef(entry))
    return statusFromFetched(packageId, entry, fetched, checkedAt)
  } catch (err) {
    return statusFromError(entry, checkedAt, err)
  } finally {
    cleanupFetched(fetched)
  }
}
