/**
 * Deterministic source-tree hashing for the plugin lockfile.
 *
 * `sourceTreeSha` values recorded in `~/.bakin/plugins/lock.json` let the
 * install/upgrade flows detect whether a local plugin source changed since
 * it was last installed/rebuilt, without trusting mtimes.
 *
 * CANONICAL HASHER: the Whiskit `hashSourceTree` (sorted rel+filehash
 * lines, skipping NON_RUNTIME_DIRS + dotfiles). It was chosen over the
 * legacy lockfile formula because published Whiskit artifacts already
 * carry `hashSourceTree` values in their checksummed `.whiskit/build.json`
 * provenance — those are immutable once published and cannot be migrated,
 * while lockfile rows are local and rewritable. The repo previously had
 * two hashers with different skip-sets and formulas (audit finding); the
 * legacy one survives here ONLY to migrate stored values.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { createHash } from 'crypto'
import type { PluginLockEntry } from '@bakin/core/plugins/lockfile'
import { hashSourceTree } from '@/core/whiskit/source-hash'

/**
 * `PluginLockEntry.sourceTreeShaAlgo` value written for hashes produced by
 * the canonical hasher. Entries without the field hold legacy (algo 1)
 * hashes and are migrated on the first check/upgrade that observes the
 * source unchanged.
 */
export const SOURCE_TREE_SHA_ALGO = 2

/**
 * Hash a directory's source tree. Path-and-content only — mtimes
 * intentionally excluded so the hash is stable across copies of the same
 * source (deliberate design decision; see
 * .claude/knowledge/plugin-lifecycle.md).
 */
export function computeSourceTreeSha(rootDir: string): string {
  return hashSourceTree(rootDir)
}

/**
 * The pre-consolidation lockfile hasher (algo 1): concatenated rel+bytes,
 * skipping only node_modules/dist/.git. Retained SOLELY so stored legacy
 * shas can be verified once during migration — never write new values
 * with it.
 */
export function legacySourceTreeSha(rootDir: string): string {
  const SKIP = new Set(['node_modules', 'dist', '.git'])
  const files: Array<{ rel: string; data: Buffer }> = []
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        const data = readFileSync(full)
        files.push({ rel: relative(rootDir, full), data })
      }
    }
  }
  if (statSync(rootDir).isDirectory()) walk(rootDir)
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const hash = createHash('sha256')
  for (const f of files) {
    hash.update(f.rel)
    hash.update('\0')
    hash.update(f.data)
    hash.update('\0')
  }
  return hash.digest('hex')
}

export interface SourceTreeComparison {
  /** Canonical (algo 2) hash of the live source tree. */
  liveSha: string
  /** True when the live source differs from what the lockfile recorded. */
  changed: boolean
  /**
   * True when the stored sha was produced by the legacy algorithm and the
   * source is UNCHANGED — the caller should rewrite the row once with
   * `liveSha` + `sourceTreeShaAlgo: SOURCE_TREE_SHA_ALGO` so future
   * comparisons take the canonical fast path. Never true for changed
   * sources: a genuine change must keep reporting as changed, and the
   * eventual upgrade commit writes the canonical sha anyway.
   */
  needsAlgoMigration: boolean
}

/**
 * Compare a lockfile entry's stored source-tree sha against the live
 * source directory, transparently handling legacy (algo 1) rows: a stored
 * legacy sha is verified with the legacy hasher so consolidation does not
 * spuriously report "source changed" for untouched installs.
 */
export function compareStoredSourceTreeSha(
  entry: Pick<PluginLockEntry, 'sourceTreeSha' | 'sourceTreeShaAlgo'>,
  sourcePath: string,
): SourceTreeComparison {
  const liveSha = computeSourceTreeSha(sourcePath)
  if (!entry.sourceTreeSha) {
    return { liveSha, changed: true, needsAlgoMigration: false }
  }
  if (entry.sourceTreeShaAlgo === SOURCE_TREE_SHA_ALGO) {
    return { liveSha, changed: liveSha !== entry.sourceTreeSha, needsAlgoMigration: false }
  }
  // Legacy row. A canonical match can only mean the stored value already
  // came from the canonical hasher (e.g. fixtures written pre-migration
  // without the algo field) — unchanged, stamp the algo.
  if (liveSha === entry.sourceTreeSha) {
    return { liveSha, changed: false, needsAlgoMigration: true }
  }
  const legacyLiveSha = legacySourceTreeSha(sourcePath)
  const changed = legacyLiveSha !== entry.sourceTreeSha
  return { liveSha, changed, needsAlgoMigration: !changed }
}
