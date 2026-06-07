/**
 * Shared SQLite core for Bakin coordination state.
 *
 * This is the ONLY file in the repo allowed to import `bun:sqlite`
 * (architecture-test enforced — tests/architecture/adapter-boundary.test.ts).
 * Domain modules (e.g. execution/ledger.ts) own their tables and expose
 * domain verbs; no SQL or sqlite types cross their module boundary except
 * the opaque `Db` handle exported here.
 *
 * One database at getBakinPaths().db (WAL mode). Coordination facts only —
 * never content, never searchable text. Content stays in markdown/JSON;
 * search stays in Antfly.
 */
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { createLogger } from '../logger'
import { getBakinPaths } from '../content-dir'

const log = createLogger('storage-db')

/** Opaque handle domain modules use; keeps bun:sqlite out of their imports. */
export type Db = Database

/**
 * Thrown when the coordination database cannot be opened or written.
 * Callers must FAIL CLOSED: no dispatch, no cron fire, no completion side
 * effects without the ledger — never fall back to an unguarded path.
 */
export class StorageUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'StorageUnavailableError'
    this.cause = cause
  }
}

export interface Migration {
  version: number
  up: (db: Db) => void
}

// Shared state lives on globalThis so Bun HMR / module re-evaluation reuses
// the same connection instead of leaking handles (same reason as
// __bakinBroadcast in src/core/sse.ts). Keyed by path so tests that remap
// getBakinPaths() to temp dirs get a fresh db transparently.
interface DbGlobalState {
  db: Database | null
  path: string | null
}
const g = globalThis as { __bakinDbState?: DbGlobalState }
if (!g.__bakinDbState) g.__bakinDbState = { db: null, path: null }
const state: DbGlobalState = g.__bakinDbState

export function getDb(): Db {
  const path = getBakinPaths().db
  if (state.db && state.path === path) return state.db

  if (state.db) {
    // Path changed (tests remapping content dir) — drop the old handle.
    try {
      state.db.close()
    } catch (err) {
      log.warn('closing previous db handle failed', { err: err instanceof Error ? err.message : String(err) })
    }
    state.db = null
    state.path = null
  }

  try {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const db = new Database(path, { create: true })
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('PRAGMA foreign_keys = ON')
    // Per-module migration ledger. A table (not PRAGMA user_version) so
    // future domain modules each get their own version track without
    // colliding on a single global int.
    db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         module     TEXT NOT NULL,
         version    INTEGER NOT NULL,
         applied_at INTEGER NOT NULL,
         PRIMARY KEY (module, version)
       )`,
    )
    state.db = db
    state.path = path
    return db
  } catch (err) {
    throw new StorageUnavailableError(`cannot open coordination db at ${path}`, err)
  }
}

/**
 * Apply a module's pending migrations in order, each inside a transaction.
 * Idempotent — applied versions are skipped.
 */
export function applyMigrations(module: string, migrations: Migration[]): void {
  const db = getDb()
  const applied = new Set(
    db
      .prepare<{ version: number }, [string]>('SELECT version FROM schema_migrations WHERE module = ?')
      .all(module)
      .map((row) => row.version),
  )

  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue
    try {
      const tx = db.transaction(() => {
        migration.up(db)
        db.prepare('INSERT INTO schema_migrations (module, version, applied_at) VALUES (?, ?, ?)').run(
          module,
          migration.version,
          Date.now(),
        )
      })
      tx()
      log.info('applied migration', { module, version: migration.version })
    } catch (err) {
      throw new StorageUnavailableError(`migration ${module} v${migration.version} failed`, err)
    }
  }
}

/** Run `fn` inside a transaction (nested calls become savepoints). */
export function withTx<T>(fn: () => T): T {
  const db = getDb()
  const tx = db.transaction(fn as (...args: unknown[]) => unknown)
  return tx() as T
}

/** Close the shared handle (tests / clean shutdown). Reopens lazily. */
export function closeDb(): void {
  if (!state.db) return
  try {
    state.db.close()
  } catch (err) {
    log.warn('closeDb failed', { err: err instanceof Error ? err.message : String(err) })
  }
  state.db = null
  state.path = null
}
