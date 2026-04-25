/**
 * Agent-package lockfile schema + atomic IO.
 *
 * Lockfile lives at `~/.bakin/packages/lock.json` and is the canonical install
 * ledger — every agent-package install/update/remove operation reads, mutates,
 * and writes this file atomically (tmp + rename) so a partial write never
 * corrupts the source-of-truth.
 *
 * Pure functions (`addPackage`, `removePackage`, `incrementRefCount`,
 * `decrementRefCount`, `getOrphanedPacks`) operate on `Lockfile` values and
 * never touch the filesystem. `readLockfile` and `writeLockfile` are the only
 * IO entry points.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import { getContentDir } from '../content-dir'

// ─── Schemas ─────────────────────────────────────────────────────────────────

const ProjectionKindSchema = z.enum([
  'skill',
  'asset',
  'workspace-file',
  'knowledge-marker',
])

const ProjectionEntrySchema = z.object({
  kind: ProjectionKindSchema,
  /** Absolute filesystem path to the projected target. */
  target: z.string().min(1),
  /** sha256 of file contents (or directory Merkle root for skills). Absent for marker entries. */
  sha256: z.string().optional(),
  /**
   * Workspace-file entries set this true on fresh install — signals that the
   * package owns this file as a one-shot template (agent owns it after) and
   * doctor should NOT auto-overwrite on update unless --refresh-template.
   */
  templateOnly: z.boolean().optional(),
  /** For knowledge-marker entries — the block id ("knowledge:pixel:product-photography"). */
  blockId: z.string().optional(),
})

const PackageStateSchema = z.enum(['managed', 'adopted'])
const PackageKindSchema = z.enum(['agent', 'skill-pack', 'workflow-pack', 'knowledge-pack'])

const PackageEntrySchema = z.object({
  kind: PackageKindSchema,
  version: z.string().min(1),
  source: z.string().min(1),
  // ref and commitSha are empty strings for local sources (no git provenance
  // exists). The lockfile records this honestly rather than fabricating a
  // synthetic value. Github sources always populate both.
  ref: z.string(),
  commitSha: z.string(),
  installedAt: z.string().min(1),

  // Agent-only fields (present iff kind === 'agent')
  state: PackageStateSchema.optional(),
  agentId: z.string().optional(),
  knowledgeEnabled: z.array(z.string()).optional(),

  // Projections (present on every kind that puts files anywhere)
  projections: z.array(ProjectionEntrySchema).optional(),

  // Composition tracking
  /** ids of packages this entry depends on (full lockfile keys, e.g. "owner.name@1.2.3"). */
  dependencies: z.array(z.string()).optional(),
  /** Inverse of dependencies — populated for non-agent kinds so we can refuse removal w/ active dependents. */
  dependents: z.array(z.string()).optional(),
  /** Number of dependents pointing at this package. Always equals dependents.length when present. */
  refCount: z.number().int().min(0).optional(),
})

export const LockfileSchema = z.object({
  version: z.literal(1),
  packages: z.record(z.string(), PackageEntrySchema),
})

export type ProjectionKind = z.infer<typeof ProjectionKindSchema>
export type ProjectionEntry = z.infer<typeof ProjectionEntrySchema>
export type PackageEntry = z.infer<typeof PackageEntrySchema>
export type PackageState = z.infer<typeof PackageStateSchema>
export type Lockfile = z.infer<typeof LockfileSchema>

// ─── Path resolution ─────────────────────────────────────────────────────────

const LOCKFILE_RELATIVE = ['packages', 'lock.json'] as const

/** Resolve the absolute lockfile path under the current Bakin content dir. */
export function getLockfilePath(): string {
  return join(getContentDir(), ...LOCKFILE_RELATIVE)
}

// ─── IO ──────────────────────────────────────────────────────────────────────

const EMPTY_LOCKFILE: Lockfile = { version: 1, packages: {} }

/**
 * Read the lockfile. Returns an empty lockfile if the file doesn't exist.
 * Throws if the file exists but is malformed — callers must decide whether
 * to recover or surface the error to the user.
 */
export function readLockfile(path: string = getLockfilePath()): Lockfile {
  if (!existsSync(path)) return { ...EMPTY_LOCKFILE, packages: {} }
  const raw = readFileSync(path, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Lockfile at ${path} is not valid JSON: ${message}`)
  }
  return LockfileSchema.parse(parsed)
}

/**
 * Write the lockfile atomically (tmp file + rename). Creates parent dirs as
 * needed. Validates the input shape before any IO — callers can pass the
 * output of pure mutators directly without separate validation.
 */
export function writeLockfile(lock: Lockfile, path: string = getLockfilePath()): void {
  // Validate up-front so a malformed in-memory value never lands on disk.
  const validated = LockfileSchema.parse(lock)
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
 * Add or replace a package entry. Returns a new lockfile value (input is
 * never mutated) so callers can chain mutations and write once.
 */
export function addPackage(lock: Lockfile, id: string, entry: PackageEntry): Lockfile {
  return {
    ...lock,
    packages: { ...lock.packages, [id]: entry },
  }
}

/**
 * Remove a package entry. Returns the lockfile unchanged when the id is absent
 * — caller's choice whether to treat that as an error.
 */
export function removePackage(lock: Lockfile, id: string): Lockfile {
  if (!(id in lock.packages)) return lock
  const { [id]: _removed, ...rest } = lock.packages
  return { ...lock, packages: rest }
}

/**
 * Increment refCount on the target package and append `dependentId` to its
 * dependents list. No-op if the target id is absent. Idempotent — adding the
 * same dependent twice does NOT bump the count.
 */
export function incrementRefCount(
  lock: Lockfile,
  targetId: string,
  dependentId: string,
): Lockfile {
  const entry = lock.packages[targetId]
  if (!entry) return lock
  const dependents = entry.dependents ?? []
  if (dependents.includes(dependentId)) return lock
  const next: PackageEntry = {
    ...entry,
    dependents: [...dependents, dependentId],
    refCount: (entry.refCount ?? dependents.length) + 1,
  }
  return addPackage(lock, targetId, next)
}

/**
 * Decrement refCount on the target package. Removes `dependentId` from the
 * dependents list. No-op if absent. Refuses to go below 0.
 */
export function decrementRefCount(
  lock: Lockfile,
  targetId: string,
  dependentId: string,
): Lockfile {
  const entry = lock.packages[targetId]
  if (!entry) return lock
  const dependents = entry.dependents ?? []
  const idx = dependents.indexOf(dependentId)
  if (idx === -1) return lock
  const nextDependents = [...dependents.slice(0, idx), ...dependents.slice(idx + 1)]
  const next: PackageEntry = {
    ...entry,
    dependents: nextDependents,
    refCount: Math.max(0, (entry.refCount ?? dependents.length) - 1),
  }
  return addPackage(lock, targetId, next)
}

/**
 * Return all package ids whose refCount has dropped to 0 — these can be
 * removed by the uninstaller's cleanup pass. Agent-kind entries are never
 * orphaned (they're always installed for their own sake, never as a dep).
 */
export function getOrphanedPacks(lock: Lockfile): string[] {
  const orphans: string[] = []
  for (const [id, entry] of Object.entries(lock.packages)) {
    if (entry.kind === 'agent') continue
    if ((entry.refCount ?? 0) === 0) orphans.push(id)
  }
  return orphans
}

/** True iff the package is referenced by at least one dependent. */
export function hasDependents(lock: Lockfile, id: string): boolean {
  const entry = lock.packages[id]
  if (!entry) return false
  return (entry.refCount ?? 0) > 0
}

/** Look up the agent-kind entry that owns the given OpenClaw agent id, if any. */
export function findAgentPackage(
  lock: Lockfile,
  agentId: string,
): { id: string; entry: PackageEntry } | null {
  for (const [id, entry] of Object.entries(lock.packages)) {
    if (entry.kind === 'agent' && entry.agentId === agentId) {
      return { id, entry }
    }
  }
  return null
}
