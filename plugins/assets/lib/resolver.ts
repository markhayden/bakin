/**
 * Filename → current path resolver.
 *
 * Under filename-as-identity, every primary asset has a globally unique
 * filename and its location is a *view*, not identity. The resolver maps
 * filename → current relative path and is the only allowed route for
 * programmatic file access.
 *
 * State lives on globalThis so Next.js webpack re-evaluation doesn't
 * shard the map (same trick as SSE broadcaster in src/core/sse.ts).
 */
import { createLogger } from '../../../src/core/logger'

const log = createLogger('assets:resolver')

interface ResolverGlobal {
  byFilename: Map<string, string> // filename → relative path
  collisions: Map<string, string[]> // filename → alternate paths (if >1 file shares a filename)
}

const g = globalThis as unknown as { __bakinResolver?: ResolverGlobal }
if (!g.__bakinResolver) {
  g.__bakinResolver = { byFilename: new Map(), collisions: new Map() }
}
const state = g.__bakinResolver

/**
 * Insert or overwrite a filename → path mapping.
 * If the filename already maps to a different path, record a collision.
 */
export function setFilename(filename: string, relativePath: string): void {
  const existing = state.byFilename.get(filename)
  if (existing && existing !== relativePath) {
    const alts = state.collisions.get(filename) || []
    if (!alts.includes(relativePath)) alts.push(relativePath)
    state.collisions.set(filename, alts)
    log.warn('Filename collision detected', { filename, primary: existing, alt: relativePath })
    // Keep the first-registered path as authoritative; surface the collision
    // via listCollisions() for audit.
    return
  }
  state.byFilename.set(filename, relativePath)
}

/**
 * Remove a filename → path mapping, but only if the mapping currently
 * points at the given path. This matters during retype/relink: the
 * new-path upsert may race the old-path unlink event, and we must not
 * wipe the mapping if it already points to the new location.
 *
 * If there are collision entries for this filename, promote one to primary.
 */
export function unsetFilename(filename: string, relativePath: string): void {
  const current = state.byFilename.get(filename)
  if (current !== relativePath) {
    // Not the primary — just drop it from collisions if present.
    const alts = state.collisions.get(filename)
    if (alts) {
      const filtered = alts.filter(p => p !== relativePath)
      if (filtered.length === 0) state.collisions.delete(filename)
      else state.collisions.set(filename, filtered)
    }
    return
  }

  const alts = state.collisions.get(filename)
  if (alts && alts.length > 0) {
    const next = alts.shift()!
    state.byFilename.set(filename, next)
    if (alts.length === 0) state.collisions.delete(filename)
    else state.collisions.set(filename, alts)
  } else {
    state.byFilename.delete(filename)
  }
}

/** Resolve a filename to its current relative path, or null. */
export function resolveFilename(filename: string): string | null {
  return state.byFilename.get(filename) ?? null
}

/** True when any file on disk has this filename (across all type/task dirs). */
export function filenameExists(filename: string): boolean {
  return state.byFilename.has(filename) || state.collisions.has(filename)
}

/** Remove all entries. Used on rebuild. */
export function clearResolver(): void {
  state.byFilename.clear()
  state.collisions.clear()
}

/** For audit / debugging — list every mapping. */
export function listByFilename(): Array<{ filename: string; path: string }> {
  return Array.from(state.byFilename.entries()).map(([filename, path]) => ({ filename, path }))
}

/** Collisions surface for the audit tool. */
export function listCollisions(): Array<{ filename: string; primary: string; alternates: string[] }> {
  const out: Array<{ filename: string; primary: string; alternates: string[] }> = []
  for (const [filename, alternates] of state.collisions.entries()) {
    const primary = state.byFilename.get(filename)
    if (!primary) continue
    out.push({ filename, primary, alternates })
  }
  return out
}

/** Snapshot size — tests and health. */
export function resolverSize(): number {
  return state.byFilename.size
}
