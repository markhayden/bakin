/**
 * Atomic JSON write for the install core.
 *
 * The plugin lockfile and the agent-package lockfile carried identical
 * tmp-file-plus-rename write bodies (down to the temp-name scheme and the
 * best-effort cleanup-on-throw). This owns those mechanics once so they can't
 * drift; callers still validate their own schema before calling.
 *
 * Part of the Whiskin shared install core (Phase 5).
 */
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/**
 * Atomically write `value` as pretty-printed JSON to `path` (temp file +
 * rename), creating parent dirs as needed. On failure the temp file is cleaned
 * up best-effort and the original error is rethrown — a partial or corrupt
 * write never lands at `path`.
 */
export function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmpPath, JSON.stringify(value, null, 2) + '\n', 'utf-8')
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
