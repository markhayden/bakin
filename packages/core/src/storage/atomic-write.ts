/**
 * Atomic JSON/text writes (temp file + rename), the one place that owns the
 * tmp-name scheme + best-effort cleanup-on-throw so a partial or corrupt write
 * never lands at the target path.
 *
 * Hand-rolled copies of this body had accreted across the codebase (lockfiles,
 * caches, manifests, offset files). This is the neutral home; `install-core`
 * re-exports it for its original callers.
 */
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export interface AtomicWriteOptions {
  /** Append a trailing newline. Default true (pretty JSON convention). */
  trailingNewline?: boolean
}

/** Atomically write `text` to `path` (temp file + rename), creating parent dirs. */
export function atomicWriteText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmpPath, text, 'utf-8')
    renameSync(tmpPath, path)
  } catch (err) {
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath) } catch { /* best-effort; surface the original error */ }
    }
    throw err
  }
}

/**
 * Atomically write `value` as pretty-printed JSON. Adds a trailing newline by
 * default; pass `{ trailingNewline: false }` to match callers that wrote none.
 */
export function atomicWriteJson(path: string, value: unknown, opts: AtomicWriteOptions = {}): void {
  const json = JSON.stringify(value, null, 2)
  atomicWriteText(path, opts.trailingNewline === false ? json : json + '\n')
}
