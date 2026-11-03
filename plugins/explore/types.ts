/**
 * Explore plugin — shared types.
 */
import type { CatalogEntry } from '../../src/core/curated-catalog/schema'

/** A catalog entry joined with local install state. */
export interface ExploreCatalogEntry extends CatalogEntry {
  /** Present in a local lockfile (or builtin). */
  installed: boolean
  /**
   * The updates engine's observation for the installed subject (#1007):
   * `true` = an unskipped update is offered, `false` = observed otherwise,
   * `null` = not observed yet (unknown — never "up to date").
   */
  updateAvailable: boolean | null
  /**
   * The observation itself, so a `blocked` subject (a vanished tracked ref,
   * a missing local source) or an `unsupported` one is never summarized as
   * "up to date": `skipped` = an offer the operator hid; `null` = unknown.
   */
  updateOutcome: 'current' | 'update-available' | 'skipped' | 'blocked' | 'unsupported' | null
  /** Why `updateOutcome` is `blocked` or `unsupported`, for people. */
  updateReason?: string
  /** Installed version from the relevant lockfile, when installed. */
  installedVersion: string | null
  /** Plugins only: the lock ledger's containment mark (row 98) — installed, never activated until enabled again. */
  disabled?: boolean
}

export interface ExploreCatalogResponse {
  ok: true
  /** Active runtime adapter name — cards badge/gate runtime-specific entries against it. */
  activeAdapter: string
  /** updatedAt of the embedded catalog. */
  updatedAt: string
  /** updatedAt of the cached remote catalog, when one has been fetched. */
  remoteUpdatedAt: string | null
  entries: ExploreCatalogEntry[]
}

/** Runtime-compat: universal ('*') or tagged with the active adapter. */
export function runtimeCompatible(entry: Pick<ExploreCatalogEntry, 'runtimes'>, activeAdapter: string | undefined): boolean {
  if (!entry.runtimes || entry.runtimes.includes('*')) return true
  return activeAdapter !== undefined && entry.runtimes.includes(activeAdapter)
}
