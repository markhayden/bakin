/**
 * Opaque structural identities for the Updates engine (#1007, D7.9): a
 * short hash over the facts a check already inspects — stat metadata,
 * manifests, variant markers, cached load verdicts — never file contents.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stable(v)]),
    )
  }
  return value
}

export function identityOf(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(parts))).digest('hex').slice(0, 24)
}

export interface FileFact {
  path: string
  size: number
  mtimeMs: number
}

/** Stat facts of a file, or null when absent. */
export function fileFact(path: string): FileFact | null {
  try {
    const stat = statSync(path)
    return stat.isFile() ? { path, size: stat.size, mtimeMs: stat.mtimeMs } : null
  } catch {
    return null
  }
}

/** Stat facts of every regular file under `dir` up to `depth` levels (names, sizes, mtimes — never contents). */
export function directoryFacts(dir: string, depth = 2): FileFact[] {
  if (!existsSync(dir)) return []
  const out: FileFact[] = []
  const walk = (current: string, remaining: number): void => {
    let entries: string[]
    try {
      entries = readdirSync(current).sort()
    } catch {
      return
    }
    for (const name of entries) {
      const path = join(current, name)
      const fact = fileFact(path)
      if (fact) out.push({ ...fact, path: path.slice(dir.length + 1) })
      else if (remaining > 0) {
        try {
          if (statSync(path).isDirectory()) walk(path, remaining - 1)
        } catch {
          // vanished mid-walk — not a fact
        }
      }
    }
  }
  walk(dir, depth)
  return out
}
