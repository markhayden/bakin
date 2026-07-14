/**
 * Provenance + user-edit markers for projected files.
 *
 * Every file that an agent-package projects onto disk (skills, assets,
 * workspace files) gets two sidecar artifacts:
 *
 *   1. `<target>.installedBy` — JSON marker recording who owns the file,
 *      what version was installed, and the sha256 of the source content.
 *      Mirrors the existing pattern in `src/core/onboarding/plugin-assets.ts`,
 *      extended with package + version + ref + commitSha.
 *
 *   2. `<target>.userEdited` (sentinel; empty file) — when present, the
 *      installer NEVER overwrites the target on update or doctor --fix.
 *      User opts into local ownership; Bakin steps back.
 *
 * Pure where possible: `computeFileSha` / `computeDirSha` are deterministic
 * functions of file contents, not affected by mtime/inode/permissions.
 */
import { createHash } from 'crypto'
import { closeSync, existsSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const InstalledByMarkerSchema = z.object({
  /** Package id from the manifest (e.g. "pixel"). Not the lockfile key. */
  package: z.string().min(1),
  version: z.string().min(1),
  // ref + commitSha are empty strings for local-source installs. The
  // marker still records the absence honestly rather than fabricating a
  // synthetic value; the doctor's drift checks treat empty ref+sha as a
  // signal that the package has no git provenance to verify against.
  ref: z.string(),
  commitSha: z.string(),
  /**
   * Archive-sourced bins: sha256 of the EXTRACTED binary bytes. The main
   * sha256 field pins the archive, so self-heal (detecting a corrupted
   * on-disk binary) needs this second hash.
   */
  extractedSha256: z.string().optional(),
  /** sha256 of the source file (or directory Merkle root for skill dirs). */
  sha256: z.string().min(1),
  installedAt: z.string().min(1),
})

export type InstalledByMarker = z.infer<typeof InstalledByMarkerSchema>

// ─── Sidecar paths ───────────────────────────────────────────────────────────

const INSTALLED_BY_SUFFIX = '.installedBy'
const USER_EDITED_SUFFIX = '.userEdited'

/**
 * Resolve the `.installedBy` sidecar path for a target.
 *
 * For files: `<target>.installedBy`
 * For directories: `<target>/.installedBy` (so the marker lives inside the
 * skill's own directory, matching the plugin-assets convention).
 */
function sidecarPathFor(target: string, suffix: string): string {
  let isDir = false
  try {
    isDir = statSync(target).isDirectory()
  } catch {
    // Target may not exist yet (we're about to project it). Heuristic: paths
    // ending in a `/` or no extension are treated as directories. The caller
    // controls the path shape, so this only matters at first write.
    if (target.endsWith('/') || (!target.includes('.') && target.split('/').pop()?.length)) {
      isDir = true
    }
  }
  return isDir ? join(target, suffix) : `${target}${suffix}`
}

// ─── installedBy operations ──────────────────────────────────────────────────

export function installedByPath(target: string): string {
  return sidecarPathFor(target, INSTALLED_BY_SUFFIX)
}

export function writeInstalledBy(target: string, marker: InstalledByMarker): void {
  const validated = InstalledByMarkerSchema.parse(marker)
  writeFileSync(installedByPath(target), JSON.stringify(validated, null, 2) + '\n', 'utf-8')
}

/**
 * Read the `.installedBy` sidecar. Returns `null` if missing OR malformed —
 * malformed sidecars are safe to overwrite, so we don't surface them as errors
 * here. The doctor sweep is the place to flag them as drift.
 */
export function readInstalledBy(target: string): InstalledByMarker | null {
  const path = installedByPath(target)
  if (!existsSync(path)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
  const result = InstalledByMarkerSchema.safeParse(parsed)
  return result.success ? result.data : null
}

export function removeInstalledBy(target: string): void {
  const path = installedByPath(target)
  if (existsSync(path)) unlinkSync(path)
}

// ─── userEdited sentinel ─────────────────────────────────────────────────────

export function userEditedPath(target: string): string {
  return sidecarPathFor(target, USER_EDITED_SUFFIX)
}

export function isUserEdited(target: string): boolean {
  return existsSync(userEditedPath(target))
}

/** Create the empty sentinel. Idempotent — already-marked files no-op. */
export function markUserEdited(target: string): void {
  const path = userEditedPath(target)
  if (existsSync(path)) return
  // Use openSync/closeSync for an atomic empty-file create that respects
  // umask, mirroring `touch` behavior.
  closeSync(openSync(path, 'w'))
}

export function unmarkUserEdited(target: string): void {
  const path = userEditedPath(target)
  if (existsSync(path)) unlinkSync(path)
}

// ─── sha256 helpers ──────────────────────────────────────────────────────────

/** sha256 of a single file's contents. */
export function computeFileSha(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Recursive sha256 (Merkle-style) of a directory tree. Walks entries in
 * sorted order so the output is deterministic across runs/filesystems.
 *
 * Entries are hashed as `<relative-path>\n<sha256-of-contents>\n`, then the
 * concatenation is sha256'd. Skips dot-files starting with `.installedBy` /
 * `.userEdited` / etc. so sidecars don't pollute the hash.
 */
export function computeDirSha(dir: string): string {
  const lines: string[] = []
  walkSorted(dir, dir, lines)
  return createHash('sha256').update(lines.join('')).digest('hex')
}

function walkSorted(root: string, dir: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.installedBy') && !e.name.startsWith('.userEdited'))
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      walkSorted(root, full, out)
    } else if (e.isFile()) {
      const rel = full.slice(root.length + 1)
      const fileSha = computeFileSha(full)
      out.push(`${rel}\n${fileSha}\n`)
    }
  }
}
