/**
 * Shared SQLite core for Bakin's local stores.
 *
 * This is the ONLY file in the repo allowed to import `bun:sqlite`
 * (architecture-test enforced — tests/architecture/adapter-boundary.test.ts).
 * Domain modules (e.g. execution/ledger.ts, search outbox) own their tables
 * and expose domain verbs; no SQL or sqlite types cross their module boundary
 * except the opaque `Db` handle exported here.
 *
 * Stores are NAMED databases, each in its own file with its own per-module
 * `schema_migrations` ledger:
 *   - `coordination` at getBakinPaths().db — execution-ledger facts only
 *     (never content, never searchable text; content stays in markdown/JSON,
 *     search rows stay in the search engine).
 *   - other stores via `openNamedDb(name, resolvePath)` — e.g. the search
 *     outbox, which is deliberately NOT in the coordination db so the
 *     ledger's coordination-facts-only contract holds.
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
 * Thrown when a store cannot be opened or written.
 * Callers must FAIL CLOSED: no dispatch, no cron fire, no completion side
 * effects without the ledger — never fall back to an unguarded path. The
 * search outbox likewise refuses writes rather than skipping the journal.
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

/** A named store: lazily opened, HMR-safe, path-remap-aware. */
export interface NamedDb {
  /** Resolve the live handle (opens/reopens as needed). */
  db(): Db
  /** Apply a module's pending migrations on THIS store (idempotent). */
  applyMigrations(module: string, migrations: Migration[]): void
  /** Run `fn` inside a transaction on this store (nested → savepoints). */
  withTx<T>(fn: () => T): T
  /** Close this store's handle (tests / shutdown). Reopens lazily. */
  close(): void
}

interface StoreState {
  db: Database | null
  path: string | null
  /** Modules whose migrations have been applied on the CURRENT handle —
   *  spares every domain verb a per-call schema_migrations SELECT on the
   *  dispatch/heartbeat hot path. Cleared with the handle. */
  migratedModules: Set<string>
}

// Shared state lives on globalThis so Bun HMR / module re-evaluation reuses
// the same connections instead of leaking handles (same reason as
// __bakinBroadcast in src/core/sse.ts). Keyed by store name; each store
// re-resolves its path per access so tests that remap getBakinPaths() (or a
// named store's resolver target) get a fresh db transparently.
const g = globalThis as { __bakinDbStores?: Map<string, StoreState> }
if (!g.__bakinDbStores) g.__bakinDbStores = new Map()
const stores: Map<string, StoreState> = g.__bakinDbStores

function storeState(name: string): StoreState {
  let s = stores.get(name)
  if (!s) {
    s = { db: null, path: null, migratedModules: new Set() }
    stores.set(name, s)
  }
  return s
}

function resolveHandle(name: string, path: string): Db {
  const state = storeState(name)
  if (state.db && state.path === path) return state.db

  if (state.db) {
    // Path changed (tests remapping content dir) — drop the old handle.
    try {
      state.db.close()
    } catch (err) {
      log.warn('closing previous db handle failed', { store: name, err: err instanceof Error ? err.message : String(err) })
    }
    state.db = null
    state.path = null
    state.migratedModules.clear()
  }

  try {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const db = new Database(path, { create: true })
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
    // No FOREIGN KEYs by design: store tables deliberately have no
    // cross-table references (ownership rule), and cleanup cascades
    // (purgeTaskRows) are explicit app code — don't imply DB-enforced
    // cascades that don't exist.
    // Per-module migration ledger, per FILE. A table (not PRAGMA
    // user_version) so domain modules each get their own version track
    // without colliding on a single global int.
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
    throw new StorageUnavailableError(`cannot open ${name} db at ${path}`, err)
  }
}

/**
 * Apply a module's pending migrations in order, each inside a transaction.
 * Idempotent — applied versions are skipped, and a module that has fully
 * migrated on the current handle short-circuits without touching the db
 * (domain verbs call this on every operation). A failed migration is NOT
 * cached, so the next call retries.
 */
function applyStoreMigrations(name: string, resolvePath: () => string, module: string, migrations: Migration[]): void {
  const state = storeState(name)
  if (state.migratedModules.has(module) && state.db && state.path === resolvePath()) return
  const db = resolveHandle(name, resolvePath())
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
      log.info('applied migration', { store: name, module, version: migration.version })
    } catch (err) {
      throw new StorageUnavailableError(`migration ${module} v${migration.version} failed`, err)
    }
  }
  state.migratedModules.add(module)
}

function closeStore(name: string): void {
  const state = storeState(name)
  state.migratedModules.clear()
  if (!state.db) return
  try {
    state.db.close()
  } catch (err) {
    log.warn('closeDb failed', { store: name, err: err instanceof Error ? err.message : String(err) })
  }
  state.db = null
  state.path = null
}

/**
 * Open (or get) a named store. The resolver runs on every access so a
 * remapped BAKIN_HOME (tests) transparently swaps the underlying file.
 * Repeated calls with the same name share one connection.
 */
export function openNamedDb(name: string, resolvePath: () => string): NamedDb {
  return {
    db: () => resolveHandle(name, resolvePath()),
    applyMigrations: (module, migrations) => applyStoreMigrations(name, resolvePath, module, migrations),
    withTx: <T>(fn: () => T): T => {
      const db = resolveHandle(name, resolvePath())
      const tx = db.transaction(fn as (...args: unknown[]) => unknown)
      return tx() as T
    },
    close: () => closeStore(name),
  }
}

/** Close every open store (tests / clean shutdown). All reopen lazily. */
export function closeAllDbs(): void {
  for (const name of stores.keys()) closeStore(name)
}

// ---------------------------------------------------------------------------
// Coordination store — the execution ledger's home. These module-level
// exports predate named stores and remain the canonical surface for ledger
// code; they are the `coordination` store under the hood.
// ---------------------------------------------------------------------------

const COORDINATION = 'coordination'
const coordinationPath = () => getBakinPaths().db

export function getDb(): Db {
  return resolveHandle(COORDINATION, coordinationPath())
}

export function applyMigrations(module: string, migrations: Migration[]): void {
  applyStoreMigrations(COORDINATION, coordinationPath, module, migrations)
}

/** Run `fn` inside a transaction (nested calls become savepoints). */
export function withTx<T>(fn: () => T): T {
  const db = getDb()
  const tx = db.transaction(fn as (...args: unknown[]) => unknown)
  return tx() as T
}

/** Close the coordination handle (tests / clean shutdown). Reopens lazily. */
export function closeDb(): void {
  closeStore(COORDINATION)
}
