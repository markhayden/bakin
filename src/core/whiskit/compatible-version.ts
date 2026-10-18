/**
 * Which published artifact version THIS host can run — the ONE answer behind
 * the upgrade lane, `bakin plugins list --check`, the plugin-artifacts Health
 * repair and the release guard. An index's `latest` is only the newest
 * publish; after a host upgrade (or before one) it may target a contract or
 * Bakin range this host does not satisfy, while an older or newer entry does.
 */
import { semver } from 'bun'
import { APP_VERSION } from '@bakin/core/constants'
import { checkBakinRangeCompatibility } from '@bakin/core/plugins/compat'
import { NEUTRAL_PLATFORM, type ArtifactEntry, type ArtifactsIndex } from './artifacts-index'
import { EXTERNALS_CONTRACT, supportsExternalsContract } from './externals'

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export interface CompatibleVersion {
  version: string
  entry: ArtifactEntry
}

export interface CompatibilityTarget {
  /** e.g. `darwin-arm64`; the neutral artifact serves every platform. */
  platform: string
  hostContract?: string
  hostVersion?: string
}

/** The artifact a host would install for one version, or null when none is published for its platform. */
function entryFor(index: ArtifactsIndex, pluginId: string, version: string, platform: string): ArtifactEntry | null {
  const platforms = index.plugins[pluginId]?.versions[version]?.platforms
  return platforms?.[platform] ?? platforms?.[NEUTRAL_PLATFORM] ?? null
}

/** Whether `entry` runs on the target host: its externals contract AND its Bakin range. */
export function artifactRunsOn(entry: Pick<ArtifactEntry, 'externalsContract' | 'bakinRange'>, target: Omit<CompatibilityTarget, 'platform'> = {}): boolean {
  return supportsExternalsContract(entry.externalsContract, target.hostContract ?? EXTERNALS_CONTRACT)
    && checkBakinRangeCompatibility(entry.bakinRange, target.hostVersion ?? APP_VERSION).ok
}

/** The newest published version of `pluginId` the target host can run, or null. */
export function newestCompatibleVersion(index: ArtifactsIndex, pluginId: string, target: CompatibilityTarget): CompatibleVersion | null {
  const versions = Object.keys(index.plugins[pluginId]?.versions ?? {})
    .filter((version) => SEMVER.test(version))
    .sort((a, b) => semver.order(b, a))
  for (const version of versions) {
    const entry = entryFor(index, pluginId, version, target.platform)
    if (entry && artifactRunsOn(entry, target)) return { version, entry }
  }
  return null
}

/**
 * THE upgrade decision, shared by the upgrade lane and availability checks:
 * a stranded install takes ANY compatible release (even a rebuild published
 * under its own version number); a working install only moves forward.
 */
export function artifactUpgradeTarget(installedVersion: string, installedRuns: boolean, compatible: string | null): string | null {
  if (!compatible) return null
  if (!installedRuns) return compatible
  return semver.order(compatible, installedVersion) > 0 ? compatible : null
}

/** The platform key this process installs for. */
export function hostPlatform(): string {
  return `${process.platform}-${process.arch}`
}
