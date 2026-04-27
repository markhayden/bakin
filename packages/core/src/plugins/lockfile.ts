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
import { PermissionSchema } from './permissions'

// ─── Schemas ─────────────────────────────────────────────────────────────────

const PluginTypeSchema = z.enum(['github', 'local'])

/**
 * Git refs we'll accept into the lockfile. Strict against shell + git
 * option smuggling — the value gets passed positionally to `git fetch`,
 * `git ls-remote`, etc. A leading `-` would be re-interpreted as an
 * option (CVE-2017-1000117 family). Allow letters/digits/dot/dash/
 * underscore/slash; nothing else. Empty allowed for local sources where
 * no ref exists.
 */
const RefStringSchema = z.string().refine(
  s => s.length === 0 || /^[A-Za-z0-9._/-]+$/.test(s),
  { message: 'ref must be empty or match /^[A-Za-z0-9._/-]+$/' },
)

/**
 * Install source — same hardening as ref, plus rejection of leading
 * `-` and control chars. The github URL gets passed positionally to
 * `git ls-remote` and `git clone`.
 *
 * Optional monorepo subpath via `#subpath` syntax (Phase 1). The subpath:
 *   - must be non-empty after `#`
 *   - matches `/^[A-Za-z0-9._/-]+$/`
 *   - cannot start or end with `/`
 *   - cannot contain `..` segments (path-traversal guard)
 *
 * Examples accepted:
 *   github:user/repo
 *   github:user/repo@v1.2.3
 *   github:user/repo#plugins/foo
 *   github:user/repo@v1.2.3#plugins/foo
 *   /Users/me/dev/repo
 *
 * Examples rejected:
 *   github:user/repo#                      (empty subpath)
 *   github:user/repo#/plugins/foo          (leading slash)
 *   github:user/repo#plugins/foo/          (trailing slash)
 *   github:user/repo#plugins/../etc        (path traversal)
 *   github:user/repo#plugins#foo           (multiple `#`)
 */
const SourceStringSchema = z.string().min(1).refine(
  (s) => {
    if (s.startsWith('-') || /[\x00-\x1f]/.test(s)) return false
    const hashCount = (s.match(/#/g) || []).length
    if (hashCount === 0) return true
    if (hashCount > 1) return false
    const subpath = s.slice(s.indexOf('#') + 1)
    if (subpath.length === 0) return false
    if (!/^[A-Za-z0-9._/-]+$/.test(subpath)) return false
    if (subpath.startsWith('/') || subpath.endsWith('/')) return false
    if (subpath.split('/').some(seg => seg === '..' || seg === '.')) return false
    return true
  },
  {
    message:
      'source must not start with "-" or contain control characters; ' +
      'optional `#subpath` must be a single-segment-or-deeper relative path ' +
      '(no leading/trailing slash, no `..`, no control chars)',
  },
)

/**
 * Resolved git sha — exactly 40 lowercase hex (full sha) or empty string
 * for local sources. Tighter than `z.string()` so a tampered lockfile
 * can't smuggle option-like values into `git rev-parse` etc.
 */
const CommitShaSchema = z.string().refine(
  s => s.length === 0 || /^[a-f0-9]{40}$/.test(s),
  { message: 'commitSha must be empty or a 40-char lowercase hex sha' },
)

const PluginLockEntrySchema = z.object({
  /** Original install source — git URL for github, absolute path for local. */
  source: SourceStringSchema,
  type: PluginTypeSchema,
  /**
   * Default branch name for github sources; empty string for local sources
   * (no git provenance exists). The lockfile records this honestly rather
   * than fabricating a synthetic value.
   */
  ref: RefStringSchema,
  /** Resolved git sha at install/upgrade time; empty string for local. */
  commitSha: CommitShaSchema,
  installedAt: z.string().min(1),
  /** ISO 8601, set on first upgrade. */
  upgradedAt: z.string().optional(),
  /** From `bakin-plugin.json.version`. */
  version: z.string().min(1),
  /** Permissions the manifest declared — strict against the Zod enum (C8). */
  permissions: z.array(PermissionSchema),
  /** sha256 of `bakin-plugin.json` — drives the "permissions changed?" check on upgrade. */
  manifestSha: z.string().min(1),
  /** ISO 8601, set by `bakin plugins list --check`. */
  lastChecked: z.string().optional(),
  /** Last seen remote HEAD sha — written by `bakin plugins list --check` (github only). */
  remoteHeadSha: z.string().refine(
    s => /^[a-f0-9]{40}$/.test(s),
    { message: 'remoteHeadSha must be a 40-char lowercase hex sha' },
  ).optional(),
  /**
   * Local source-tree sha at install/upgrade time (local only). Symmetric
   * with `commitSha` for github sources — captures what was on disk when
   * the plugin was last installed/rebuilt.
   */
  sourceTreeSha: z.string().optional(),
  /**
   * Live source-tree sha last observed by `bakin plugins list --check`
   * (local only). Symmetric with `remoteHeadSha`. Compared against
   * `sourceTreeSha` to determine whether an upgrade is available.
   */
  lastSourceTreeSha: z.string().optional(),
  /**
   * OpenClaw skill names (one segment, no slashes) this plugin installed
   * via `defaults/openclaw-skills/<name>/SKILL.md` at install/upgrade
   * time. The remove flow uses this as the authoritative allowlist when
   * deciding which `~/.openclaw/skills/*` dirs to delete — defeats the
   * fake-`.installedBy` scorched-earth attack (security HIGH #2).
   *
   * Optional; consumers should default to [] for entries written before
   * this field existed.
   */
  installedSkills: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).optional(),
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

// ─── Defense-in-depth: core-plugin guard ─────────────────────────────────────

/**
 * Predicate registered at boot by `src/lib/plugin-registry.ts` via
 * `setCorePluginCheck` — returns `true` for plugin ids that ship with the
 * Bakin binary. Wired through a setter (rather than imported directly) to
 * avoid a circular dependency: `plugin-registry` imports this module's
 * types, so this module cannot import `plugin-registry` in turn.
 *
 * Unset in test environments → mutators allow any id. Tests that want to
 * exercise the guard call `setCorePluginCheck(id => id === 'tasks')` etc.
 */
let corePluginCheck: ((id: string) => boolean) | null = null

/** Wire the predicate. Called once during boot from plugin-registry. */
export function setCorePluginCheck(check: ((id: string) => boolean) | null): void {
  corePluginCheck = check
}

function assertNotCore(id: string): void {
  if (corePluginCheck && corePluginCheck(id)) {
    throw new Error(`refusing to mutate lockfile entry for core plugin: ${id}`)
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
  assertNotCore(id)
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
  assertNotCore(id)
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
  assertNotCore(id)
  const existing = lock.plugins[id]
  if (!existing) {
    throw new Error(`Cannot update plugin lockfile entry: id "${id}" not present`)
  }
  return {
    ...lock,
    plugins: { ...lock.plugins, [id]: { ...existing, ...patch } },
  }
}
