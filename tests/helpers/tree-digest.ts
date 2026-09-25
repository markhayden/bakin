/**
 * Byte-level fingerprint of a directory: every regular file's relative path
 * → sha256 of its bytes, sorted. Two trees with equal digests hold the same
 * files with the same contents — the "restored byte for byte" assertion.
 */
import { createHash } from 'crypto'
import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

export function treeDigest(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) out[relative(root, full)] = createHash('sha256').update(readFileSync(full)).digest('hex')
    }
  }
  walk(root)
  return out
}
