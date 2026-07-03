/**
 * Blue/green table registry + migrator (spec D4, plan A4).
 *
 * Logical table names (what plugins and queries use) map to VERSIONED
 * physical tables: `{logical}_v{schemaVersion}_{fp8}` where fp8 hashes the
 * table config + the adapter's mappingFingerprint. Any change — a plugin
 * bumping schemaVersion, or the adapter swapping an embedder model —
 * yields a new desired physical name and triggers a background migration:
 *
 *   creating → (dual-write ON) → backfilling → converging → flip → drop
 *
 * Queries keep hitting the old fully-converged table until the atomic
 * pointer flip; a crash/park mid-migration resumes from persisted state
 * with dual-write still on. There is never a degraded window (D4), and a
 * matching ensure performs ZERO adapter calls (the boot-does-nothing
 * guarantee, D5).
 *
 * State lives in the same `search.db` store as the outbox — one
 * transactional domain for pointer flips + queue ops.
 */
import { join } from 'path'
import { createHash } from 'crypto'
import { openNamedDb, type Db } from '../storage/db'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'
import type { Document, SearchAdapter, TableConfig } from '../adapters/search'

const log = createLogger('search-tables')

export interface TableEnsureDef {
  logical: string
  /** Plugin-declared doc-shape version — replaces every per-plugin scheme. */
  schemaVersion: number
  config: TableConfig
  /** Row enumerator for backfills. MUST be side-effect free and restartable. */
  reindex: () => AsyncGenerator<{ key: string; doc: Document }>
}

export interface EnsureOpts {
  /** Converge poll cap; on expiry the migration PARKS (never flips early). */
  convergeTimeoutMs?: number
  convergePollMs?: number
  /** Force a fresh physical even when version+fingerprint match (rebuild). */
  forceNonce?: string
}

export type EnsureResult = 'created' | 'unchanged' | 'migrated' | 'parked'

export interface TableState {
  logical: string
  physical: string
  schemaVersion: number
  state: 'active' | 'migrating'
  migratingTo: string | null
  phase: string | null
  backfillDone: number | null
}

const MODULE = 'search-tables'
const BACKFILL_CHUNK = 50
const DEFAULT_CONVERGE_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_CONVERGE_POLL_MS = 2_000

const store = openNamedDb('search', () => join(getContentDir(), 'search.db'))

const MIGRATIONS = [
  {
    version: 1,
    up: (db: Db) => {
      db.exec(
        `CREATE TABLE search_tables (
           logical            TEXT PRIMARY KEY,
           physical           TEXT NOT NULL,
           schema_version     INTEGER NOT NULL,
           config_fingerprint TEXT NOT NULL,
           state              TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','migrating')),
           migrating_to       TEXT,
           migration_phase    TEXT,
           backfill_done      INTEGER,
           updated_at         INTEGER NOT NULL
         )`,
      )
      db.exec(
        `CREATE TABLE search_table_tombstones (
           physical TEXT PRIMARY KEY,
           noted_at INTEGER NOT NULL
         )`,
      )
    },
  },
]

function db(): Db {
  store.applyMigrations(MODULE, MIGRATIONS)
  return store.db()
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

function fingerprint(def: TableEnsureDef, mappingFingerprint: string, nonce?: string): string {
  return createHash('sha256')
    .update(stableStringify(def.config))
    .update('|')
    .update(mappingFingerprint)
    .update(nonce ? `|${nonce}` : '')
    .digest('hex')
}

function physicalName(def: TableEnsureDef, fp: string): string {
  return `${def.logical}_v${def.schemaVersion}_${fp.slice(0, 8)}`
}

interface Row {
  logical: string
  physical: string
  schema_version: number
  config_fingerprint: string
  state: 'active' | 'migrating'
  migrating_to: string | null
  migration_phase: string | null
  backfill_done: number | null
}

function getRow(logical: string): Row | null {
  return db().prepare<Row, [string]>('SELECT * FROM search_tables WHERE logical = ?').get(logical) ?? null
}

function setPhase(logical: string, phase: string, backfillDone?: number): void {
  db()
    .prepare('UPDATE search_tables SET migration_phase = ?, backfill_done = COALESCE(?, backfill_done), updated_at = ? WHERE logical = ?')
    .run(phase, backfillDone ?? null, Date.now(), logical)
}

/** The physical table queries hit right now (never a half-built green). */
export function queryTarget(logical: string): string | null {
  return getRow(logical)?.physical ?? null
}

/**
 * Outbox drain targets: the active physical, plus the green during a
 * migration (dual-write). Enqueuers never know blue/green exists.
 */
export function resolveDrainTargets(logical: string): string[] {
  const row = getRow(logical)
  if (!row) return [logical]
  return row.migrating_to ? [row.physical, row.migrating_to] : [row.physical]
}

export function tableStatus(logical: string): TableState | null {
  const row = getRow(logical)
  if (!row) return null
  return {
    logical: row.logical,
    physical: row.physical,
    schemaVersion: row.schema_version,
    state: row.state,
    migratingTo: row.migrating_to,
    phase: row.migration_phase,
    backfillDone: row.backfill_done,
  }
}

export function listTableStates(): TableState[] {
  return db()
    .prepare<Row, []>('SELECT * FROM search_tables ORDER BY logical')
    .all()
    .map((row) => ({
      logical: row.logical,
      physical: row.physical,
      schemaVersion: row.schema_version,
      state: row.state,
      migratingTo: row.migrating_to,
      phase: row.migration_phase,
      backfillDone: row.backfill_done,
    }))
}

async function createTableTolerant(adapter: SearchAdapter, physical: string, config: TableConfig): Promise<void> {
  try {
    await adapter.tables.create(physical, config)
  } catch (err) {
    // Resume path: the green may already exist from before a crash/park.
    const stats = await adapter.tables.stats(physical).catch(() => null)
    if (!stats) throw err
  }
}

async function backfill(adapter: SearchAdapter, def: TableEnsureDef, physical: string): Promise<number> {
  let emitted = 0
  let chunk: Array<{ key: string; doc: Document }> = []
  const flush = async () => {
    if (chunk.length === 0) return
    await adapter.documents.batchIndex(physical, chunk)
    emitted += chunk.length
    setPhase(def.logical, 'backfilling', emitted)
    chunk = []
  }
  for await (const item of def.reindex()) {
    chunk.push(item)
    if (chunk.length >= BACKFILL_CHUNK) await flush()
  }
  await flush()
  return emitted
}

async function converged(adapter: SearchAdapter, physical: string, expected: number): Promise<boolean> {
  const stats = await adapter.tables.stats(physical).catch(() => null)
  if ((stats?.documents ?? 0) < expected) return false
  if (adapter.tables.health) {
    const legs = await adapter.tables.health(physical).catch(() => null)
    if (!legs) return false
    if (legs.some((leg) => leg.state !== 'ready')) return false
  }
  return true
}

function noteTombstone(physical: string): void {
  db()
    .prepare('INSERT INTO search_table_tombstones (physical, noted_at) VALUES (?, ?) ON CONFLICT (physical) DO NOTHING')
    .run(physical, Date.now())
}

async function dropTolerant(adapter: SearchAdapter, physical: string): Promise<void> {
  try {
    await adapter.tables.drop(physical)
  } catch (err) {
    log.warn('table drop failed — tombstoned for the doctor sweep', {
      physical,
      err: err instanceof Error ? err.message : String(err),
    })
    noteTombstone(physical)
  }
}

/** Doctor sweep: retry dropping tombstoned physicals. Returns remaining. */
export async function sweepTombstones(adapter: SearchAdapter): Promise<number> {
  const rows = db().prepare<{ physical: string }, []>('SELECT physical FROM search_table_tombstones').all()
  for (const row of rows) {
    try {
      await adapter.tables.drop(row.physical)
      db().prepare('DELETE FROM search_table_tombstones WHERE physical = ?').run(row.physical)
    } catch {
      // still failing — stays tombstoned
    }
  }
  return db().prepare<{ n: number }, []>('SELECT COUNT(*) AS n FROM search_table_tombstones').get()?.n ?? 0
}

/**
 * Run (or resume) the migration of `logical` toward `green`. Dual-write is
 * enabled by persisting migrating_to BEFORE backfill begins, so a doc
 * written during backfill exists in green either way.
 */
async function runMigration(
  adapter: SearchAdapter,
  def: TableEnsureDef,
  green: string,
  fp: string,
  opts?: EnsureOpts,
): Promise<'migrated' | 'parked'> {
  const old = getRow(def.logical)
  if (!old) throw new Error(`runMigration without a registry row for ${def.logical}`)

  db()
    .prepare(
      `UPDATE search_tables SET state = 'migrating', migrating_to = ?, migration_phase = 'creating',
         schema_version = ?, config_fingerprint = ?, updated_at = ? WHERE logical = ?`,
    )
    .run(green, def.schemaVersion, fp, Date.now(), def.logical)

  await createTableTolerant(adapter, green, def.config)

  setPhase(def.logical, 'backfilling', 0)
  const emitted = await backfill(adapter, def, green)

  setPhase(def.logical, 'converging')
  const timeoutMs = opts?.convergeTimeoutMs ?? DEFAULT_CONVERGE_TIMEOUT_MS
  const pollMs = opts?.convergePollMs ?? DEFAULT_CONVERGE_POLL_MS
  const deadline = Date.now() + timeoutMs
  let ok = await converged(adapter, green, emitted)
  while (!ok && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs))
    ok = await converged(adapter, green, emitted)
  }
  if (!ok) {
    // NEVER flip early. Park with dual-write still on; the doctor surfaces
    // it and resumeMigrations() finishes the job when the engine recovers.
    setPhase(def.logical, 'parked')
    log.warn('migration parked — green never converged', { logical: def.logical, green, emitted })
    return 'parked'
  }

  const oldPhysical = old.physical
  store.withTx(() => {
    db()
      .prepare(
        `UPDATE search_tables SET physical = ?, state = 'active', migrating_to = NULL,
           migration_phase = NULL, backfill_done = NULL, updated_at = ? WHERE logical = ?`,
      )
      .run(green, Date.now(), def.logical)
  })
  log.info('table migrated', { logical: def.logical, from: oldPhysical, to: green })

  setPhase(def.logical, 'dropping')
  await dropTolerant(adapter, oldPhysical)
  db().prepare('UPDATE search_tables SET migration_phase = NULL WHERE logical = ?').run(def.logical)
  return 'migrated'
}

// One migration at a time process-wide (bounds embed load); ensure() calls
// for other tables queue behind it.
let migrationChain: Promise<unknown> = Promise.resolve()
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = migrationChain.then(fn, fn)
  migrationChain = next.catch(() => {})
  return next
}

/**
 * Ensure `logical` exists on the desired physical layout. Matching state
 * performs ZERO adapter calls. Missing → create + seed (create-time event,
 * not boot inference). Mismatched → blue/green migration.
 */
export async function ensureTable(
  adapter: SearchAdapter,
  def: TableEnsureDef,
  mappingFingerprint: string,
  opts?: EnsureOpts,
): Promise<EnsureResult> {
  const fp = fingerprint(def, mappingFingerprint, opts?.forceNonce)
  const desired = physicalName(def, fp)
  const row = getRow(def.logical)

  if (row && row.state === 'active' && row.physical === desired) return 'unchanged'

  return serialized(async () => {
    const current = getRow(def.logical)

    if (!current) {
      await createTableTolerant(adapter, desired, def.config)
      const emitted = await backfill(adapter, def, desired)
      db()
        .prepare(
          `INSERT INTO search_tables (logical, physical, schema_version, config_fingerprint, state, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?)`,
        )
        .run(def.logical, desired, def.schemaVersion, fp, Date.now())
      log.info('table created + seeded', { logical: def.logical, physical: desired, seeded: emitted })
      return 'created'
    }

    if (current.state === 'active' && current.physical === desired) return 'unchanged'

    if (current.state === 'migrating' && current.migrating_to && current.migrating_to !== desired) {
      // The desired layout changed underneath an in-flight migration —
      // abandon the stale green and migrate to the new target instead.
      await dropTolerant(adapter, current.migrating_to)
    }

    return runMigration(adapter, def, desired, fp, opts)
  })
}

/** Force a fresh physical with identical version+fingerprint (rebuild / black-swan recovery). */
export async function rebuildTable(
  adapter: SearchAdapter,
  def: TableEnsureDef,
  mappingFingerprint: string,
  opts?: EnsureOpts,
): Promise<EnsureResult> {
  return ensureTable(adapter, def, mappingFingerprint, { ...opts, forceNonce: `rebuild-${Date.now()}` })
}

/**
 * Boot-time continuation: finish any migration left in-flight by a crash
 * or park. This is "resume recorded work" (allowed by D5) — it reads only
 * the registry, never the filesystem.
 */
export async function resumeMigrations(
  adapter: SearchAdapter,
  defs: TableEnsureDef[],
  mappingFingerprint: string,
  opts?: EnsureOpts,
): Promise<void> {
  const inFlight = db().prepare<Row, []>("SELECT * FROM search_tables WHERE state = 'migrating'").all()
  for (const row of inFlight) {
    const def = defs.find((d) => d.logical === row.logical)
    if (!def) {
      log.warn('in-flight migration has no registered def — leaving parked', { logical: row.logical })
      continue
    }
    const fp = fingerprint(def, mappingFingerprint)
    const desired = physicalName(def, fp)
    await serialized(async () => {
      const current = getRow(row.logical)
      if (!current || current.state !== 'migrating') return
      if (current.migrating_to && current.migrating_to !== desired) {
        await dropTolerant(adapter, current.migrating_to)
      }
      await runMigration(adapter, def, desired, fp, opts)
    })
  }
}

/** Test-only: wipe registry + tombstones (close-first — see outbox note). */
export function resetTablesForTests(): void {
  store.close()
  db().exec('DELETE FROM search_tables; DELETE FROM search_table_tombstones;')
}
