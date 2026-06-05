/**
 * Staging → install-dir commit for the install core.
 *
 * Moves a fully-prepared staging directory into its final install location with
 * a single rename — atomic on the same filesystem, so a reader never observes a
 * half-populated install dir. A pre-existing target (e.g. left by a prior failed
 * install at the same version) is removed first.
 *
 * Cross-filesystem renames (rare — typically staging on tmpfs, destination on a
 * persistent drive) would need a copy-then-delete fallback; not implemented
 * because both paths live under getContentDir().
 *
 * Lifted from the agent-package installer (the proven reference); Phase 6 wires
 * the plugin install path through the same primitive. Part of the Whiskit
 * shared install core (Phase 5).
 */
import { existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import { dirname } from 'path'

export function commitStaging(staging: string, finalDir: string): void {
  mkdirSync(dirname(finalDir), { recursive: true })
  if (existsSync(finalDir)) {
    rmSync(finalDir, { recursive: true, force: true })
  }
  renameSync(staging, finalDir)
}
