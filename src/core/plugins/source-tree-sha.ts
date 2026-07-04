/**
 * Deterministic source-tree hashing for the plugin lockfile.
 *
 * `sourceTreeSha` values recorded in `~/.bakin/plugins/lock.json` let the
 * install/upgrade flows detect whether a local plugin source changed since
 * it was last installed/rebuilt, without trusting mtimes.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { createHash } from 'crypto'

/**
 * Hash a directory's path+content tree (skipping node_modules / dist / .git).
 * Path-and-content only — mtimes intentionally excluded so the hash is
 * stable across copies of the same source (deliberate design decision;
 * see .claude/knowledge/plugin-lifecycle.md).
 */
export function computeSourceTreeSha(rootDir: string): string {
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
