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
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '../install-core/atomic-write'
import { z } from 'zod'
import { getContentDir } from '../content-dir'

// ─── Schemas ─────────────────────────────────────────────────────────────────

const ProjectionKindSchema = z.enum([
  'skill',
  'asset',
  'workspace-file',
  // Team persona seed (seeded-if-missing; never overwritten or reclaimed).
  'persona',
  // Capability-pack binary installed into the Bakin bin dir. Removal is
  // refcount-aware in the uninstaller: a bin whose target is also projected
  // by another installed package survives that uninstall.
  'bin',
  // Capability-pack npm payload dir (<home>/npm/<packId>/<name>): scripts +
  // generated package.json + node_modules. Per-pack path — never shared.
  'npm-payload',
  // Capability-pack model file (<home>/models/<dest>). Refcount-aware like
  // bins: a model another installed pack also projects survives removal.
  'model',
  // Legacy (pre-layered-context). New code never writes lesson-marker
  // projections — lessons are composed into the workspace-file block. Kept in
  // the enum only so pre-migration lockfiles parse; the one-time migration
  // rewrites them away.
  'lesson-marker',
])

/**
 * Per-kind lifecycle policy for plain file projections — the ONE declaration
 * of seed-once / sidecar / uninstall semantics, consulted by the projector
 * (uninstall) and the sync-scanner (drift expectations) instead of each
 * special-casing kinds inline. workspace-file and lesson-marker rows are NOT
 * plain file drops (managed-block surgery) and keep their structural
 * branches; their entries here document the semantics all the same.
 */
export interface ProjectionKindPolicy {
  /** Written only when absent — the file is user territory from then on: no drift checks, no reclaim. */
  seedOnce: boolean
  /** No .installedBy sidecar accompanies the projection; a scan must not demand one. */
  sidecarless: boolean
  /** Package removal leaves the projected file behind. */
  survivesUninstall: boolean
}

export const PROJECTION_KIND_POLICY: Record<ProjectionKind, ProjectionKindPolicy> = {
  skill: { seedOnce: false, sidecarless: false, survivesUninstall: false },
  asset: { seedOnce: false, sidecarless: false, survivesUninstall: false },
  bin: { seedOnce: false, sidecarless: false, survivesUninstall: false },
  'npm-payload': { seedOnce: false, sidecarless: false, survivesUninstall: false },
  model: { seedOnce: false, sidecarless: false, survivesUninstall: false },
  'workspace-file': { seedOnce: false, sidecarless: true, survivesUninstall: true },
  persona: { seedOnce: true, sidecarless: true, survivesUninstall: true },
  'lesson-marker': { seedOnce: false, sidecarless: true, survivesUninstall: true },
}

/**
 * Per-input shas recorded for composed workspace-file projections so drift
 * findings can attribute staleness to the layer that changed
 * (package template / global context / team context / lessons).
 */
const ProjectionInputsSchema = z.object({
  packageSha: z.string().optional(),
  globalSha: z.string().optional(),
  roleSha: z.string().optional(),
  teamSha: z.string().optional(),
  lessonsSha: z.string().optional(),
  // sha of the injected runtime tool-access section (P1.6). Changes when the
  // active runtime's tool-access style changes (e.g. Pi↔OpenClaw switch), so a
  // switch shows up as runtime-attributed drift rather than an in-place edit.
  toolAccessSha: z.string().optional(),
})

const ProjectionEntrySchema = z.object({
  kind: ProjectionKindSchema,
  /** Absolute filesystem path to the projected target. */
  target: z.string().min(1),
  /** sha256 of file contents (or directory Merkle root for skills). Absent for marker entries. */
  sha256: z.string().optional(),
  /**
   * Workspace-file entries: sha256 of the composed managed-block body as last
   * projected. Compared against the freshly derived expected composition to
   * detect staleness.
   */
  composedSha: z.string().optional(),
  /** Workspace-file entries: shas of the composition inputs at projection time. */
  inputs: ProjectionInputsSchema.optional(),
  /**
   * Legacy (pre-layered-context) template-seeding flag. New code never writes
   * it; tolerated on read until the migration rewrites the lockfile.
   */
  templateOnly: z.boolean().optional(),
  /**
   * Legacy lesson-marker block id. Tolerated on read until migration.
   */
  blockId: z.string().optional(),
})

// 'adopted' collapsed into 'managed' (layered-context spec): blocks made the
// workspace-ownership distinction moot. Pre-migration lockfiles still say
// 'adopted' on disk — normalize on read so no downstream code ever sees it;
// the one-time migration persists the collapse.
const PackageStateSchema = z
  .enum(['managed', 'adopted'])
  .transform((): 'managed' => 'managed')
const PackageKindSchema = z.enum(['agent', 'skill-pack', 'workflow-pack', 'lesson-pack'])

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
  lessonsEnabled: z.array(z.string()).optional(),

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
export type ProjectionInputs = z.infer<typeof ProjectionInputsSchema>
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
  // Validate up-front so a malformed in-memory value never lands on disk, then
  // hand off to the shared atomic writer.
  atomicWriteJson(path, LockfileSchema.parse(lock))
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

/** Look up the agent-kind entry that owns the given runtime agent id, if any. */
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
