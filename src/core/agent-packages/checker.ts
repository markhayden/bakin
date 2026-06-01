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
import { fetchSource, type FetchedSource } from './source-fetcher'

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
  return entry.source.startsWith('github:') && entry.ref
    ? `${entry.source}@${entry.ref}`
    : entry.source
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

export function checkPackageUpdate(
  packageId: string,
  options: CheckPackageUpdateOptions = {},
): PackageUpdateStatus {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString()
  const lock = readLockfile()
  const entry = lock.packages[packageId]
  if (!entry) {
    throw new Error(`Package "${packageId}" is not installed.`)
  }

  let fetched: FetchedSource | null = null
  try {
    fetched = fetchSource(sourceWithRef(entry))
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
  } catch (err) {
    return {
      currentVersion: entry.version,
      latestVersion: null,
      currentCommitSha: entry.commitSha,
      latestCommitSha: null,
      upgradeAvailable: false,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    cleanupFetched(fetched)
  }
}
