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
  /** Live progress for UI (phase + backfilled-row count). Display-only. */
  onProgress?: (phase: string, backfillDone?: number) => void
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
  /** Epoch ms of the last registry transition (create/rebuild/flip). */
  updatedAt: number
}

const MODULE = 'search-tables'
const BACKFILL_CHUNK = 50
const DEFAULT_CONVERGE_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_CONVERGE_POLL_MS = 2_000
/**
 * An orphan candidate must stay unreferenced this long before it is
 * dropped. A cross-process ensure (CLI onboarding against the same engine)
 * creates + backfills a NEW logical's table long before its registry row
 * lands, and a single observation cannot distinguish that window from a
 * true orphan. Six hours comfortably outlasts any backfill.
 */
const ORPHAN_DROP_DWELL_MS = 6 * 60 * 60 * 1000
/** Every physical this module has ever created: `{logical}_v{N}_{fp8}`. */
const VERSIONED_PHYSICAL = /^.+_v\d+_[0-9a-f]{8}$/

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
  {
    version: 2,
    up: (db: Db) => {
      // First-seen ledger for the orphan engine-table sweep: a candidate
      // must survive a dwell window across sweeps before it is dropped.
      db.exec(
        `CREATE TABLE search_orphan_candidates (
           physical   TEXT PRIMARY KEY,
           first_seen INTEGER NOT NULL
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
  updated_at: number
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
    updatedAt: row.updated_at,
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
      updatedAt: row.updated_at,
    }))
}

async function createTableTolerant(adapter: SearchAdapter, physical: string, config: TableConfig): Promise<void> {
  // Exists-check FIRST: re-POSTing a create onto an existing table is not
  // benign on the live engine (duplicate creates with embeddings indexes
  // hang/500 and poison the retry cycle — observed at the rc.17 cutover).
  // One cheap GET; the matching-row fast path above this never gets here.
  const existing = await adapter.tables.stats(physical).catch(() => null)
  if (existing) return
  try {
    await adapter.tables.create(physical, config)
  } catch (err) {
    // Racing creator (another ensure/resume) — tolerate if it now exists.
    const stats = await adapter.tables.stats(physical).catch(() => null)
    if (!stats) throw err
  }
}

async function backfill(adapter: SearchAdapter, def: TableEnsureDef, physical: string, onProgress?: EnsureOpts['onProgress']): Promise<number> {
  let emitted = 0
  let chunk: Array<{ key: string; doc: Document }> = []
  const flush = async () => {
    if (chunk.length === 0) return
    await adapter.documents.batchIndex(physical, chunk, { sync: false })
    emitted += chunk.length
    setPhase(def.logical, 'backfilling', emitted)
    onProgress?.('backfilling', emitted)
    chunk = []
  }
  for await (const item of def.reindex()) {
    chunk.push(item)
    if (chunk.length >= BACKFILL_CHUNK) await flush()
  }
  await flush()
  return emitted
}

async function legsReady(adapter: SearchAdapter, physical: string): Promise<boolean> {
  if (!adapter.tables.health) return true
  const legs = await adapter.tables.health(physical).catch(() => null)
  if (!legs) return false
  return legs.every((leg) => leg.state === 'ready')
}

/**
 * Converge check for one poll. `expected` (the backfill's emitted count)
 * is a point-in-time snapshot: a LIVE source can shrink after enumeration
 * (deletes/orphan sweeps dual-write into the green), so a green can be
 * complete yet never reach `expected` — that parked bakin_memory forever
 * (2026-07-11). Accept either: the count reached the snapshot, OR the
 * count is STABLE across two consecutive polls with every leg ready —
 * nothing in flight, nothing pending, the green simply IS the source now.
 */
async function converged(
  adapter: SearchAdapter,
  physical: string,
  expected: number,
  prevCount: number | null,
): Promise<{ ok: boolean; count: number }> {
  const stats = await adapter.tables.stats(physical).catch(() => null)
  const count = stats?.documents ?? 0
  const reached = count >= expected
  const stable = prevCount !== null && count === prevCount
  if (!reached && !stable) return { ok: false, count }
  return { ok: await legsReady(adapter, physical), count }
}

/**
 * Delete a logical table's registry row. Returns every physical the row
 * referenced (active + mid-migration green) so the caller can drop them
 * engine-side. Used by content-type purge and the orphan-row sweep.
 */
export function removeTableRegistration(logical: string): string[] {
  const row = getRow(logical)
  if (!row) return []
  const physicals = [row.physical, ...(row.migrating_to ? [row.migrating_to] : [])]
  db().prepare('DELETE FROM search_tables WHERE logical = ?').run(logical)
  return physicals
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

export interface OrphanTableSweepResult {
  /** Physicals dropped this sweep (drop failures tombstone instead). */
  dropped: string[]
  /** Candidates still inside the dwell window — a later sweep drops them. */
  pending: number
}

/**
 * Doctor sweep: drop engine-side tables this module created but no longer
 * references. Orphan generations appear when search.db is recreated while
 * the engine keeps its tables, or when a crash lands between the engine
 * create and the registry insert. They are not just disk waste: a wedged
 * orphan generation can pin the engine's startup catch-up loop at full CPU
 * and starve every live query (2026-07-12 incident).
 *
 * Safety: only names matching the versioned physical pattern are
 * considered; the sweep runs on the migration chain so it can never
 * observe an in-process create/backfill mid-flight; and a candidate must
 * stay unreferenced for a full dwell window (persisted first-seen ledger)
 * before it is dropped — see ORPHAN_DROP_DWELL_MS.
 */
export async function sweepOrphanEngineTables(
  adapter: SearchAdapter,
  opts?: { dwellMs?: number },
): Promise<OrphanTableSweepResult> {
  const dwellMs = opts?.dwellMs ?? ORPHAN_DROP_DWELL_MS
  return serialized(async () => {
    const engine = await adapter.tables.list()
    const referenced = new Set<string>()
    for (const row of db().prepare<Row, []>('SELECT * FROM search_tables').all()) {
      referenced.add(row.physical)
      if (row.migrating_to) referenced.add(row.migrating_to)
    }
    // Tombstoned physicals are already queued for drop — not ours to track.
    for (const row of db().prepare<{ physical: string }, []>('SELECT physical FROM search_table_tombstones').all()) {
      referenced.add(row.physical)
    }

    const candidates = new Set(
      engine
        .map((table) => table.name)
        .filter((name) => VERSIONED_PHYSICAL.test(name) && !referenced.has(name)),
    )

    // Reconcile the first-seen ledger: rows for tables that are gone or
    // referenced again must not linger and later justify a drop.
    for (const row of db().prepare<{ physical: string }, []>('SELECT physical FROM search_orphan_candidates').all()) {
      if (!candidates.has(row.physical)) {
        db().prepare('DELETE FROM search_orphan_candidates WHERE physical = ?').run(row.physical)
      }
    }

    const now = Date.now()
    const dropped: string[] = []
    for (const name of candidates) {
      const seen = db()
        .prepare<{ first_seen: number }, [string]>('SELECT first_seen FROM search_orphan_candidates WHERE physical = ?')
        .get(name)
      if (!seen) {
        db().prepare('INSERT INTO search_orphan_candidates (physical, first_seen) VALUES (?, ?)').run(name, now)
        continue
      }
      if (now - seen.first_seen < dwellMs) continue
      try {
        await adapter.tables.drop(name)
        dropped.push(name)
        log.info('orphan engine table dropped', { physical: name, orphanedForMs: now - seen.first_seen })
      } catch (err) {
        log.warn('orphan engine table drop failed — tombstoned for the doctor sweep', {
          physical: name,
          err: err instanceof Error ? err.message : String(err),
        })
        noteTombstone(name)
      }
      db().prepare('DELETE FROM search_orphan_candidates WHERE physical = ?').run(name)
    }

    const pending = db().prepare<{ n: number }, []>('SELECT COUNT(*) AS n FROM search_orphan_candidates').get()?.n ?? 0
    return { dropped, pending }
  })
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

  // Park→resume fast path: when a previous attempt's backfill fully landed
  // (green already holds the emitted corpus — the registry remembers the
  // count), re-running it would re-embed everything just to wait out
  // another converge window. Skip straight to converge; dual-write has
  // kept the green current in the meantime.
  const priorEmitted = old.migrating_to === green ? old.backfill_done ?? 0 : 0
  let emitted: number
  if (priorEmitted > 0) {
    const greenStats = await adapter.tables.stats(green).catch(() => null)
    if ((greenStats?.documents ?? 0) >= priorEmitted) {
      emitted = priorEmitted
      log.info('resume: green already backfilled — skipping re-backfill', { logical: def.logical, green, emitted })
    } else {
      setPhase(def.logical, 'backfilling', 0)
      opts?.onProgress?.('backfilling', 0)
      emitted = await backfill(adapter, def, green, opts?.onProgress)
    }
  } else {
    setPhase(def.logical, 'backfilling', 0)
    opts?.onProgress?.('backfilling', 0)
    emitted = await backfill(adapter, def, green, opts?.onProgress)
  }

  setPhase(def.logical, 'converging')
  opts?.onProgress?.('converging', emitted)
  const timeoutMs = opts?.convergeTimeoutMs ?? DEFAULT_CONVERGE_TIMEOUT_MS
  const pollMs = opts?.convergePollMs ?? DEFAULT_CONVERGE_POLL_MS
  const deadline = Date.now() + timeoutMs
  let check = await converged(adapter, green, emitted, null)
  while (!check.ok && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs))
    check = await converged(adapter, green, emitted, check.count)
  }
  const ok = check.ok
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
      const emitted = await backfill(adapter, def, desired, opts?.onProgress)
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
  db().exec('DELETE FROM search_tables; DELETE FROM search_table_tombstones; DELETE FROM search_orphan_candidates;')
}
