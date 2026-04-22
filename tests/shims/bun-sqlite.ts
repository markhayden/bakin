/**
 * Test-environment shim for `bun:sqlite`.
 *
 * Runtime: Bakin uses Bun's native `bun:sqlite` (in Bun runtime).
 * Tests: Vitest runs under a Vite module loader that can't resolve Bun's
 * built-in `bun:` protocol. Alias `bun:sqlite` → this shim so tests hit
 * `better-sqlite3`, which has the same surface we use (Database,
 * prepare/get/all/run, exec, transaction, close).
 */
import Database from 'better-sqlite3'

export { Database }
