/**
 * Explore plugin — shared types.
 */
import type { CatalogEntry } from '../../src/core/curated-catalog/schema'

/** A catalog entry joined with local install state. */
export interface ExploreCatalogEntry extends CatalogEntry {
  /** Present in a local lockfile (or builtin). */
  installed: boolean
  /**
   * Update available per persisted lockfile markers. `null` = unknown —
   * agents are probe-only (no persisted markers) until a check runs.
   */
  updateAvailable: boolean | null
  /** Installed version from the relevant lockfile, when installed. */
  installedVersion: string | null
}

export interface ExploreCatalogResponse {
  ok: true
  /** updatedAt of the embedded catalog. */
  updatedAt: string
  /** updatedAt of the cached remote catalog, when one has been fetched. */
  remoteUpdatedAt: string | null
  entries: ExploreCatalogEntry[]
  /**
   * Present on ?check=1 responses: number of update probes that failed
   * (offline, unreachable source). Those items report updateAvailable:null
   * (unknown), never "up to date".
   */
  probeErrors?: number
}
