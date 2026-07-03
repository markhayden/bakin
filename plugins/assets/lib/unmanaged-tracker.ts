/**
 * Live unmanaged-file tracker — the "you have unimported stuff" signal.
 *
 * In-memory only, starts EMPTY (zero boot cost, D7): while the server runs
 * the watcher notes unmanaged paths as they appear/vanish; every on-demand
 * scan (Import view, doctor sweep) reseeds it so drift self-corrects.
 * Changes emit a debounced `asset.unmanaged` { count } SSE event that
 * drives the sidebar badge and the Import tab counter.
 */
import { isUnmanagedAssetPath } from './import-unmanaged'

const EMIT_DEBOUNCE_MS = 300

type CountEmitter = (count: number) => void

const paths = new Set<string>()
let emitter: CountEmitter | null = null
let pending: ReturnType<typeof setTimeout> | null = null
let lastEmitted = -1

function scheduleEmit(): void {
  if (!emitter) return
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    if (paths.size !== lastEmitted) {
      lastEmitted = paths.size
      emitter?.(paths.size)
    }
  }, EMIT_DEBOUNCE_MS)
  pending.unref?.()
}

/** Wire the SSE emitter at plugin activation (re-wired on hot reload). */
export function setUnmanagedEmitter(fn: CountEmitter | null): void {
  emitter = fn
}

export function noteUnmanagedSync(relPath: string): void {
  if (!isUnmanagedAssetPath(relPath)) return
  if (!paths.has(relPath)) {
    paths.add(relPath)
    scheduleEmit()
  }
}

export function noteUnmanagedUnlink(relPath: string): void {
  if (paths.delete(relPath)) scheduleEmit()
}

/** Replace tracker contents with scan truth (every on-demand scan calls this). */
export function reseedUnmanaged(relPaths: string[]): void {
  paths.clear()
  for (const rel of relPaths) paths.add(rel)
  scheduleEmit()
}

export function unmanagedCount(): number {
  return paths.size
}

/** Test-only. */
export function resetUnmanagedTrackerForTests(): void {
  paths.clear()
  lastEmitted = -1
  if (pending) clearTimeout(pending)
  pending = null
}
