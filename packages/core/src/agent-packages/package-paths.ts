/**
 * Path-resolution conventions for installed agent-packages.
 *
 * Single source of truth for where a package's source tree lives once
 * installed. Used by:
 *   - the installer (Phase E) when staging + projecting
 *   - load-sources at boot (Phase C-3) when populating the workflow
 *     source registries
 *   - doctor drift checks (Phase I) when verifying file integrity
 *   - the uninstaller (Phase E-6) when cleaning up
 *
 * Pure path math — never reads or writes the filesystem.
 *
 * Layout under `<contentDir>/packages/`:
 *   agents/<id>@<version>/             kind: 'agent'
 *   skill-packs/<id>@<version>/        kind: 'skill-pack'
 *   workflow-packs/<id>@<version>/     kind: 'workflow-pack'
 *   lesson-packs/<id>@<version>/    kind: 'lesson-pack'
 *
 * The `<id>@<version>` suffix lets two versions of the same pack coexist
 * during an in-progress update (the new version installs alongside the old
 * one and the lockfile entry switches at the atomic-rename moment).
 */
import { join } from 'path'
import type { PackageKind } from './manifest'

export const PACKAGES_DIR_NAME = 'packages'

const SUBDIR_BY_KIND: Record<PackageKind, string> = {
  'agent': 'agents',
  'skill-pack': 'skill-packs',
  'workflow-pack': 'workflow-packs',
  'lesson-pack': 'lesson-packs',
}

/** Root of the per-installation package tree under a content dir. */
export function getPackagesRoot(contentDir: string): string {
  return join(contentDir, PACKAGES_DIR_NAME)
}

/** Resolve the install dir for a given kind + id + version. */
export function getPackageSourceDir(
  contentDir: string,
  kind: PackageKind,
  id: string,
  version: string,
): string {
  return join(getPackagesRoot(contentDir), SUBDIR_BY_KIND[kind], `${id}@${version}`)
}

/** Resolve the staging dir used during install (atomic rename target). */
export function getStagingDir(contentDir: string, label: string): string {
  return join(getPackagesRoot(contentDir), `.staging-${label}`)
}

/** Resolve the advisory install lockfile (per-process install lock, not lockfile.json). */
export function getInstallLockFile(contentDir: string): string {
  return join(getPackagesRoot(contentDir), '.lock')
}
