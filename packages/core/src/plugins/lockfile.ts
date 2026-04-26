/**
 * Plugin lockfile schema + atomic IO.
 *
 * Lockfile lives at `~/.bakin/plugins/lock.json` and is the canonical install
 * ledger for user plugins — every plugins install/upgrade/remove operation
 * reads, mutates, and writes this file atomically (tmp + rename) so a partial
 * write never corrupts the source-of-truth.
 *
 * Pure functions (`addPlugin`, `removePlugin`, `updatePlugin`) operate on
 * `PluginLockfile` values and never touch the filesystem. `readPluginLockfile`
 * and `writePluginLockfile` are the only IO entry points.
 *
 * Mirrors `packages/core/src/agent-packages/lockfile.ts` style by design —
 * one mental model, one IO pattern across both ledgers.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import { getContentDir } from '../content-dir'

// ─── Schemas ─────────────────────────────────────────────────────────────────

const PluginTypeSchema = z.enum(['github', 'local'])

const PluginLockEntrySchema = z.object({
  /** Original install source — git URL for github, absolute path for local. */
  source: z.string().min(1),
  type: PluginTypeSchema,
  /**
   * Default branch name for github sources; empty string for local sources
   * (no git provenance exists). The lockfile records this honestly rather
   * than fabricating a synthetic value.
   */
  ref: z.string(),
  /** Resolved git sha at install/upgrade time; empty string for local. */
  commitSha: z.string(),
  installedAt: z.string().min(1),
  /** ISO 8601, set on first upgrade. */
  upgradedAt: z.string().optional(),
  /** From `bakin-plugin.json.version`. */
  version: z.string().min(1),
  /**
   * Loose `string[]` at this commit (C1). The C8 commit will tighten this to
   * the `Permission` Zod enum once `packages/core/src/plugins/permissions.ts`
   * lands. Until then, we record whatever the manifest declares.
   */
  permissions: z.array(z.string()),
  /** sha256 of `bakin-plugin.json` — drives the "permissions changed?" check on upgrade. */
  manifestSha: z.string().min(1),
  /** ISO 8601, set by `bakin plugins list --check`. */
  lastChecked: z.string().optional(),
  /** Last seen remote HEAD sha (github sources only). */
  remoteHeadSha: z.string().optional(),
  /** Last seen local source-tree sha (local sources only). */
  sourceTreeSha: z.string().optional(),
})

export const PluginLockfileSchema = z.object({
  version: z.literal(1),
  plugins: z.record(z.string(), PluginLockEntrySchema),
})

export type PluginType = z.infer<typeof PluginTypeSchema>
export type PluginLockEntry = z.infer<typeof PluginLockEntrySchema>
export type PluginLockfile = z.infer<typeof PluginLockfileSchema>

// ─── Path resolution ─────────────────────────────────────────────────────────

const LOCKFILE_RELATIVE = ['plugins', 'lock.json'] as const

/** Resolve the absolute lockfile path under the current Bakin content dir. */
export function getPluginLockfilePath(): string {
  return join(getContentDir(), ...LOCKFILE_RELATIVE)
}

// ─── IO ──────────────────────────────────────────────────────────────────────

const EMPTY_LOCKFILE: PluginLockfile = { version: 1, plugins: {} }

/**
 * Read the lockfile. Returns an empty lockfile if the file doesn't exist.
 * Throws if the file exists but is malformed — callers must decide whether
 * to recover or surface the error to the user.
 */
export function readPluginLockfile(path: string = getPluginLockfilePath()): PluginLockfile {
  if (!existsSync(path)) return { ...EMPTY_LOCKFILE, plugins: {} }
  const raw = readFileSync(path, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Plugin lockfile at ${path} is not valid JSON: ${message}`)
  }
  return PluginLockfileSchema.parse(parsed)
}

/**
 * Write the lockfile atomically (tmp file + rename). Creates parent dirs as
 * needed. Validates the input shape before any IO — callers can pass the
 * output of pure mutators directly without separate validation.
 */
export function writePluginLockfile(
  lock: PluginLockfile,
  path: string = getPluginLockfilePath(),
): void {
  // Validate up-front so a malformed in-memory value never lands on disk.
  const validated = PluginLockfileSchema.parse(lock)
  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmpPath, JSON.stringify(validated, null, 2) + '\n', 'utf-8')
    renameSync(tmpPath, path)
  } catch (err) {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath)
      } catch {
        // best-effort cleanup; surface the original error
      }
    }
    throw err
  }
}

// ─── Pure mutators (no fs) ───────────────────────────────────────────────────

/**
 * Add or replace a plugin entry. Returns a new lockfile value (input is
 * never mutated) so callers can chain mutations and write once.
 */
export function addPlugin(
  lock: PluginLockfile,
  id: string,
  entry: PluginLockEntry,
): PluginLockfile {
  // TODO(C2): wire isCorePlugin defense-in-depth — refuse to mutate entries
  // for ids that match a core plugin. Predicate doesn't exist yet at C1.
  return {
    ...lock,
    plugins: { ...lock.plugins, [id]: entry },
  }
}

/**
 * Remove a plugin entry. Returns the lockfile unchanged when the id is absent
 * — idempotent so remove flows can call this without first checking existence.
 */
export function removePlugin(lock: PluginLockfile, id: string): PluginLockfile {
  // TODO(C2): wire isCorePlugin defense-in-depth — refuse for core ids.
  if (!(id in lock.plugins)) return lock
  const { [id]: _removed, ...rest } = lock.plugins
  return { ...lock, plugins: rest }
}

/**
 * Patch an existing plugin entry. Throws if the id is absent — updating a
 * non-existent entry is a programming error worth surfacing rather than
 * silently no-op'ing (contrast with `removePlugin` which is idempotent).
 */
export function updatePlugin(
  lock: PluginLockfile,
  id: string,
  patch: Partial<PluginLockEntry>,
): PluginLockfile {
  // TODO(C2): wire isCorePlugin defense-in-depth — refuse for core ids.
  const existing = lock.plugins[id]
  if (!existing) {
    throw new Error(`Cannot update plugin lockfile entry: id "${id}" not present`)
  }
  return {
    ...lock,
    plugins: { ...lock.plugins, [id]: { ...existing, ...patch } },
  }
}
