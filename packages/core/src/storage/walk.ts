/**
 * Shared synchronous directory walker — the neutral home for the ad-hoc
 * recursive `readdirSync` walkers that had accreted across storage adapters,
 * build scripts, and docs tooling.
 *
 * Semantics (deliberately plain, matching the migrated call sites):
 * - Depth-first, entries in `readdirSync` order — NO sorting. Callers that
 *   need deterministic ordering sort themselves.
 * - Dirent-based (`withFileTypes`): symlinks are neither files nor
 *   directories, so they are not yielded and not followed.
 * - A missing root yields nothing (no throw).
 * - No error swallowing below the root: an unreadable subdirectory throws.
 *
 * NOT for hash-feeding walkers: `source-tree-sha.ts` and
 * `agent-packages/markers.ts` walk with their own skip-sets/ordering and
 * their outputs live in persisted checksums — changing their walk semantics
 * silently invalidates recorded hashes. They stay self-contained on purpose.
 */
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

export interface WalkOptions {
  /** Directory names to skip entirely (not recursed into). */
  skipDirs?: readonly string[]
  /** Skip every entry — file or directory — whose name starts with a dot. */
  skipDotEntries?: boolean
  /** Only yield files whose name ends with one of these suffixes (e.g. '.md'). */
  ext?: readonly string[]
}

export interface WalkedFile {
  /** Full path (root + relative segments). */
  path: string
  /** Path relative to the walk root, '/'-joined. */
  relPath: string
  /** Basename of the file. */
  name: string
}

/** Recursively yield the files under `root`. See module doc for semantics. */
export function* walkFiles(root: string, opts: WalkOptions = {}): Generator<WalkedFile> {
  if (!existsSync(root)) return
  const skipDirs = opts.skipDirs ? new Set(opts.skipDirs) : null
  yield* walkDir(root, '', skipDirs, opts)
}

function* walkDir(
  dir: string,
  prefix: string,
  skipDirs: ReadonlySet<string> | null,
  opts: WalkOptions,
): Generator<WalkedFile> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = String(entry.name)
    if (opts.skipDotEntries && name.startsWith('.')) continue
    const relPath = prefix ? `${prefix}/${name}` : name
    const path = join(dir, name)
    if (entry.isDirectory()) {
      if (skipDirs?.has(name)) continue
      yield* walkDir(path, relPath, skipDirs, opts)
    } else if (entry.isFile()) {
      if (opts.ext && !opts.ext.some((suffix) => name.endsWith(suffix))) continue
      yield { path, relPath, name }
    }
  }
}
