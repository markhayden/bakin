/**
 * Deterministic source-tree hashing for build provenance.
 *
 * sourceTreeSha lets the startup verifier + upgrade checks detect whether a
 * plugin's source changed since it was built (for linked/dev sources) without
 * trusting mtimes. Build/dep/dot dirs are excluded so the hash reflects source,
 * not artifacts. Part of the Whiskit build backend (Phase 2 / used by Phase 4).
 */
import { createHash } from 'crypto'
import { readdirSync, readFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { NON_RUNTIME_DIRS } from './import-scan'

/** SHA256 of a single file's bytes. */
export function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Deterministic SHA256 of a directory's file tree: sorted relative paths each
 * paired with their content hash, skipping non-runtime entries (dist,
 * node_modules, tests, bakin.ui-test.ts, …) and dotfiles/dotdirs (so
 * `.whiskit/` provenance never feeds the source hash).
 */
export function hashSourceTree(dir: string): string {
  const lines: string[] = []
  const walk = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const entry of entries) {
      if (NON_RUNTIME_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        const rel = relative(dir, full).split(sep).join('/')
        lines.push(`${rel}\n${hashFile(full)}`)
      }
    }
  }
  walk(dir)
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}
