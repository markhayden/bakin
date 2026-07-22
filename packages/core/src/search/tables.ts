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
import { noteSearchEngineProgress } from './progress'
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
  /** Hard converge cap for a STILL-PROGRESSING green (parks on expiry). */
  convergeTimeoutMs?: number
  convergePollMs?: number
  /** Park after this long with zero observed progress (default 60s). */
  zeroProgressParkMs?: number
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
/**
 * Hard converge cap — only reachable while the green is still making
 * PROGRESS (counts moving). A stuck green parks on the zero-progress
 * window below instead, so this can afford to be generous for large
 * legitimate embed backfills.
 */
const DEFAULT_CONVERGE_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_CONVERGE_POLL_MS = 2_000
/**
 * Park after this long with ZERO observed progress (doc count, indexed
 * count, and pending count all frozen). The 2026-07-21 rebuild burned a
 * flat 10-minute timeout per stuck table — three of them serialized into
 * a ~30-minute global stall; a frozen green is parkable in a minute.
 */
const DEFAULT_ZERO_PROGRESS_PARK_MS = 60 * 1000
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
  {
    version: 3,
    up: (db: Db) => {
      // Ownership ledger: every physical THIS instance created. The orphan
      // sweep only ever drops tables recorded here — registry absence alone
      // cannot distinguish our stale generation from another Bakin home's
      // LIVE table on a shared engine (review finding: a second instance
      // pointed at the same engine would otherwise drop production tables).
      db.exec(
        `CREATE TABLE search_created_physicals (
           physical   TEXT PRIMARY KEY,
           created_at INTEGER NOT NULL
         )`,
      )
    },
  },
  {
    version: 4,
    up: (db: Db) => {
      // Persisted migration identity (2026-07-21 five-lens review, critical
      // finding): resume used to RECOMPUTE the target fingerprint, losing
      // any rebuild nonce — a resumed nonce'd rebuild aliased the LIVE
      // physical and the post-flip drop deleted it. The green's fingerprint
      // is now recorded when the migration starts and resume replays the
      // recorded intent verbatim.
      db.exec('ALTER TABLE search_tables ADD COLUMN migrating_fp TEXT')
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
  migrating_fp: string | null
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
  noteCreatedPhysical(physical)
}

/** Ownership ledger writes — see migration v3 for why this exists. */
function noteCreatedPhysical(physical: string): void {
  db()
    .prepare('INSERT INTO search_created_physicals (physical, created_at) VALUES (?, ?) ON CONFLICT (physical) DO NOTHING')
    .run(physical, Date.now())
}

function forgetCreatedPhysical(physical: string): void {
  db().prepare('DELETE FROM search_created_physicals WHERE physical = ?').run(physical)
}

async function backfill(adapter: SearchAdapter, def: TableEnsureDef, physical: string, onProgress?: EnsureOpts['onProgress']): Promise<number> {
  let emitted = 0
  let chunk: Array<{ key: string; doc: Document }> = []
  const flush = async () => {
    if (chunk.length === 0) return
    await adapter.documents.batchIndex(physical, chunk, { sync: false })
    noteSearchEngineProgress()
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

/**
 * One convergence observation. `count: null` means the stats read FAILED —
 * a null is never "0 documents" and never satisfies the stability
 * criterion (the old `?? 0` laundered two transient stats failures into
 * flip evidence — 2026-07-21 five-lens review, integrity finding).
 */
interface ConvergeSnapshot {
  count: number | null
  /** Sum of per-leg indexed counts — the progress signal flags can't fake. */
  indexed: number
  /** Sum of per-leg pending counts (0 when legs report none). */
  pending: number
  legsAllReady: boolean
  /** First leg in state 'error', if any — parks immediately. */
  failedLeg: string | null
}

async function observeGreen(adapter: SearchAdapter, physical: string): Promise<ConvergeSnapshot> {
  const stats = await adapter.tables.stats(physical).catch(() => null)
  const count = stats ? stats.documents : null
  if (!adapter.tables.health) {
    return { count, indexed: count ?? 0, pending: 0, legsAllReady: true, failedLeg: null }
  }
  const legs = await adapter.tables.health(physical).catch(() => null)
  if (!legs) return { count, indexed: 0, pending: 0, legsAllReady: false, failedLeg: null }
  return {
    count,
    indexed: legs.reduce((sum, leg) => sum + (leg.indexedCount ?? 0), 0),
    pending: legs.reduce((sum, leg) => sum + (leg.pendingCount ?? 0), 0),
    legsAllReady: legs.every((leg) => leg.state === 'ready'),
    failedLeg: legs.find((leg) => leg.state === 'error')?.leg ?? null,
  }
}

/**
 * Converge verdict for one poll. `expected` (the backfill's emitted count)
 * is a point-in-time snapshot: a LIVE source can shrink after enumeration
 * (deletes/orphan sweeps dual-write into the green), so a green can be
 * complete yet never reach `expected` — that parked bakin_memory forever
 * (2026-07-11). Accept either: the count reached the snapshot, OR the
 * count is STABLE across two consecutive polls with every leg ready —
 * nothing in flight, nothing pending, the green simply IS the source now.
 */
function convergeVerdict(snap: ConvergeSnapshot, prev: ConvergeSnapshot | null, expected: number): boolean {
  if (snap.count === null) return false
  const reached = snap.count >= expected
  const stable = prev !== null && prev.count !== null && snap.count === prev.count
  return (reached || stable) && snap.legsAllReady
}

/** Progress = ANY observed movement between two snapshots. */
function progressed(snap: ConvergeSnapshot, prev: ConvergeSnapshot | null): boolean {
  if (prev === null) return true
  return snap.count !== prev.count || snap.indexed !== prev.indexed || snap.pending !== prev.pending
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
    forgetCreatedPhysical(physical)
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
  /**
   * Unreferenced versioned tables NOT in this instance's ownership ledger —
   * NEVER dropped (another Bakin home sharing the engine may own them, or
   * they predate the ledger). Surfaced so the doctor can name them for a
   * deliberate manual cleanup.
   */
  unclaimed: string[]
}

/**
 * Doctor sweep: drop engine-side tables this instance created but no longer
 * references. Orphan generations appear when search.db is recreated while
 * the engine keeps its tables, or when a crash lands between the engine
 * create and the registry insert. They are not just disk waste: a wedged
 * orphan generation can pin the engine's startup catch-up loop at full CPU
 * and starve every live query (2026-07-12 incident).
 *
 * Safety rails: only names in the OWNERSHIP ledger (created by this
 * instance — see migration v3) are ever dropped; a candidate must stay
 * unreferenced for a full dwell window (persisted first-seen ledger); and
 * a candidate whose registry row (re)appears is forgiven. Together these
 * make the migration chain unnecessary here: an in-flight create is owned
 * but backfills for far less than the dwell, and holding serialized()
 * across engine HTTP would couple the doctor to multi-minute migrations in
 * both directions (review finding) — so this deliberately runs OFF the
 * chain.
 */
export async function sweepOrphanEngineTables(
  adapter: SearchAdapter,
  opts?: { dwellMs?: number },
): Promise<OrphanTableSweepResult> {
  const dwellMs = opts?.dwellMs ?? ORPHAN_DROP_DWELL_MS
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
  const owned = new Set(
    db().prepare<{ physical: string }, []>('SELECT physical FROM search_created_physicals').all().map((row) => row.physical),
  )

  const unreferenced = engine
    .map((table) => table.name)
    .filter((name) => VERSIONED_PHYSICAL.test(name) && !referenced.has(name))
  const candidates = new Set(unreferenced.filter((name) => owned.has(name)))
  const unclaimed = unreferenced.filter((name) => !owned.has(name))

  // Reconcile the first-seen ledger: rows for tables that are gone or
  // referenced again must not linger and later justify a drop.
  const firstSeen = new Map(
    db()
      .prepare<{ physical: string; first_seen: number }, []>('SELECT physical, first_seen FROM search_orphan_candidates')
      .all()
      .map((row) => [row.physical, row.first_seen] as const),
  )
  for (const physical of firstSeen.keys()) {
    if (!candidates.has(physical)) {
      db().prepare('DELETE FROM search_orphan_candidates WHERE physical = ?').run(physical)
    }
  }

  const now = Date.now()
  const dropped: string[] = []
  for (const name of candidates) {
    const seen = firstSeen.get(name)
    if (seen === undefined) {
      db().prepare('INSERT INTO search_orphan_candidates (physical, first_seen) VALUES (?, ?)').run(name, now)
      continue
    }
    if (now - seen < dwellMs) continue
    try {
      await adapter.tables.drop(name)
      forgetCreatedPhysical(name)
      dropped.push(name)
      log.info('orphan engine table dropped', { physical: name, orphanedForMs: now - seen })
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
  return { dropped, pending, unclaimed }
}

/** Doctor sweep: retry dropping tombstoned physicals. Returns remaining. */
export async function sweepTombstones(adapter: SearchAdapter): Promise<number> {
  const rows = db().prepare<{ physical: string }, []>('SELECT physical FROM search_table_tombstones').all()
  for (const row of rows) {
    try {
      await adapter.tables.drop(row.physical)
      db().prepare('DELETE FROM search_table_tombstones WHERE physical = ?').run(row.physical)
      forgetCreatedPhysical(row.physical)
    } catch {
      // still failing — stays tombstoned
    }
  }
  return db().prepare<{ n: number }, []>('SELECT COUNT(*) AS n FROM search_table_tombstones').get()?.n ?? 0
}

/** Repair a row whose migration target is invalid: back to plain active. */
function repairRowActive(logical: string): void {
  db()
    .prepare(
      `UPDATE search_tables SET state = 'active', migrating_to = NULL, migrating_fp = NULL,
         migration_phase = NULL, backfill_done = NULL, updated_at = ? WHERE logical = ?`,
    )
    .run(Date.now(), logical)
}

/**
 * Stage the migration of `logical` toward `green`: persist intent (which
 * turns dual-write ON before backfill begins, so a doc written during
 * backfill exists in green either way), create the green, and backfill it.
 * Runs ON the serialized chain — this is the embed-heavy phase and the
 * only phase that deserves process-wide serialization.
 *
 * INVARIANT (2026-07-21 critical finding): green must never equal the
 * active physical. A recomputed/aliased target would dual-write a table
 * into itself and the post-flip drop would delete the live table.
 */
async function stageMigration(
  adapter: SearchAdapter,
  def: TableEnsureDef,
  green: string,
  fp: string,
  baseFp: string,
  opts?: EnsureOpts,
): Promise<{ emitted: number } | 'unchanged'> {
  const old = getRow(def.logical)
  if (!old) throw new Error(`stageMigration without a registry row for ${def.logical}`)
  if (green === old.physical) {
    log.error('migration target aliases the ACTIVE physical — refusing and repairing the row', undefined, {
      logical: def.logical,
      physical: old.physical,
    })
    repairRowActive(def.logical)
    return 'unchanged'
  }

  db()
    .prepare(
      `UPDATE search_tables SET state = 'migrating', migrating_to = ?, migrating_fp = ?, migration_phase = 'creating',
         schema_version = ?, config_fingerprint = ?, updated_at = ? WHERE logical = ?`,
    )
    // migrating_fp records the TARGET (nonce included) for resume;
    // config_fingerprint records IDENTITY (base, nonce-free) so later
    // plain ensures recognize the flipped generation and no-op.
    .run(green, fp, def.schemaVersion, baseFp, Date.now(), def.logical)

  await createTableTolerant(adapter, green, def.config)

  // Park→resume fast path: when a previous attempt's backfill fully landed
  // (green already holds the emitted corpus — the registry remembers the
  // count), re-running it would re-embed everything just to wait out
  // another converge window. Skip straight to converge; dual-write has
  // kept the green current in the meantime.
  const priorEmitted = old.migrating_to === green ? old.backfill_done ?? 0 : 0
  if (priorEmitted > 0) {
    const greenStats = await adapter.tables.stats(green).catch(() => null)
    if ((greenStats?.documents ?? 0) >= priorEmitted) {
      log.info('resume: green already backfilled — skipping re-backfill', { logical: def.logical, green, emitted: priorEmitted })
      return { emitted: priorEmitted }
    }
  }
  setPhase(def.logical, 'backfilling', 0)
  opts?.onProgress?.('backfilling', 0)
  return { emitted: await backfill(adapter, def, green, opts?.onProgress) }
}

/**
 * Converge-watch the green, then flip. Runs OFF the serialized chain — a
 * pure poll loop plus a registry transaction; holding the chain here is
 * what turned three stuck tables into a 30-minute global stall
 * (2026-07-21). Parking rules:
 *   - a leg in state 'error' parks immediately (waiting cannot fix it),
 *   - ZERO progress (count/indexed/pending all frozen) for
 *     zeroProgressParkMs parks — a frozen green is decided in a minute,
 *   - the hard timeout only bounds a green that is STILL progressing.
 */
async function convergeAndFlip(
  adapter: SearchAdapter,
  def: TableEnsureDef,
  green: string,
  emitted: number,
  opts?: EnsureOpts,
): Promise<'migrated' | 'parked'> {
  setPhase(def.logical, 'converging')
  opts?.onProgress?.('converging', emitted)
  const timeoutMs = opts?.convergeTimeoutMs ?? DEFAULT_CONVERGE_TIMEOUT_MS
  const pollMs = opts?.convergePollMs ?? DEFAULT_CONVERGE_POLL_MS
  const zeroProgressMs = opts?.zeroProgressParkMs ?? DEFAULT_ZERO_PROGRESS_PARK_MS
  const deadline = Date.now() + timeoutMs

  let prev: ConvergeSnapshot | null = null
  let snap = await observeGreen(adapter, green)
  let lastProgressAt = Date.now()
  let parkReason: string | null = null

  while (!convergeVerdict(snap, prev, emitted)) {
    if (snap.failedLeg) {
      parkReason = `leg '${snap.failedLeg}' reports error`
      break
    }
    const now = Date.now()
    if (progressed(snap, prev)) {
      lastProgressAt = now
      noteSearchEngineProgress()
    }
    if (now - lastProgressAt >= zeroProgressMs) {
      parkReason = `zero progress for ${Math.round((now - lastProgressAt) / 1000)}s`
      break
    }
    if (now >= deadline) {
      parkReason = 'hard converge timeout'
      break
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
    prev = snap
    snap = await observeGreen(adapter, green)
  }

  if (parkReason) {
    // NEVER flip early. Park with dual-write still on; the migration pump
    // and the doctor resume the job when the engine recovers.
    setPhase(def.logical, 'parked')
    log.warn('migration parked — green never converged', { logical: def.logical, green, emitted, reason: parkReason })
    return 'parked'
  }

  // Re-read: the row may have changed while we were off-chain converging
  // (a concurrent ensure toward a different target abandons this green).
  const row = getRow(def.logical)
  if (!row || row.state !== 'migrating' || row.migrating_to !== green) {
    log.warn('converge finished for a superseded green — leaving registry untouched', { logical: def.logical, green })
    return 'parked'
  }

  const oldPhysical = row.physical
  store.withTx(() => {
    db()
      .prepare(
        `UPDATE search_tables SET physical = ?, state = 'active', migrating_to = NULL, migrating_fp = NULL,
           migration_phase = NULL, backfill_done = NULL, updated_at = ? WHERE logical = ?`,
      )
      .run(green, Date.now(), def.logical)
  })
  log.info('table migrated', { logical: def.logical, from: oldPhysical, to: green })

  if (oldPhysical !== green) {
    setPhase(def.logical, 'dropping')
    await dropTolerant(adapter, oldPhysical)
    db().prepare('UPDATE search_tables SET migration_phase = NULL WHERE logical = ?').run(def.logical)
  }
  return 'migrated'
}

async function runMigration(
  adapter: SearchAdapter,
  def: TableEnsureDef,
  green: string,
  fp: string,
  baseFp: string,
  opts?: EnsureOpts,
): Promise<'migrated' | 'parked' | 'unchanged'> {
  // Backfill holds the chain (bounds embed load); convergence does not.
  const staged = await serialized(() => stageMigration(adapter, def, green, fp, baseFp, opts))
  if (staged === 'unchanged') return 'unchanged'
  return coalescedConverge(def.logical, () => convergeAndFlip(adapter, def, green, staged.emitted, opts))
}

// Backfill (the embed-heavy phase) runs one at a time process-wide; the
// converge-wait does NOT — see convergeAndFlip. ensure() calls for other
// tables queue behind an active backfill only.
let migrationChain: Promise<unknown> = Promise.resolve()
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = migrationChain.then(fn, fn)
  migrationChain = next.catch(() => {})
  return next
}

// One converge-watcher per logical: a resume racing an in-flight converge
// attaches to it instead of double-polling and double-flipping.
const convergeWatchers = new Map<string, Promise<'migrated' | 'parked'>>()
function coalescedConverge(logical: string, fn: () => Promise<'migrated' | 'parked'>): Promise<'migrated' | 'parked'> {
  const existing = convergeWatchers.get(logical)
  if (existing) return existing
  const watcher = fn().finally(() => {
    convergeWatchers.delete(logical)
  })
  convergeWatchers.set(logical, watcher)
  return watcher
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
  // Identity is the BASE fingerprint, never the physical name: a nonce'd
  // rebuild generation carries the same identity under a different name,
  // and comparing names made every later plain ensure treat it as drift
  // and migrate it BACK to the base name — the "boomerang" that re-ran
  // enumerators and re-embedded healthy tables after every rebuild
  // (2026-07-22 soak cycle-1 finding).
  const baseFp = fingerprint(def, mappingFingerprint)
  const row = getRow(def.logical)

  const identityMatches = (r: Row): boolean =>
    r.schema_version === def.schemaVersion
    && (r.physical === desired || (!opts?.forceNonce && r.config_fingerprint === baseFp))

  if (row && row.state === 'active' && identityMatches(row)) return 'unchanged'

  // Housekeeping + the create path hold the chain (create-seed IS a
  // backfill); the migration path releases it before convergence — the
  // chain must never be held across a converge-wait (2026-07-21), so
  // runMigration re-enters serialized() itself for its staging phase only.
  const prep = await serialized(async (): Promise<'created' | 'unchanged' | 'migrate'> => {
    const current = getRow(def.logical)

    if (!current) {
      await createTableTolerant(adapter, desired, def.config)
      const emitted = await backfill(adapter, def, desired, opts?.onProgress)
      db()
        .prepare(
          `INSERT INTO search_tables (logical, physical, schema_version, config_fingerprint, state, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?)`,
        )
        // Identity (config_fingerprint) is always the BASE fingerprint —
        // the physical name may carry a nonce, identity never does.
        .run(def.logical, desired, def.schemaVersion, baseFp, Date.now())
      log.info('table created + seeded', { logical: def.logical, physical: desired, seeded: emitted })
      return 'created'
    }

    if (current.state === 'active' && identityMatches(current)) return 'unchanged'

    if (
      current.state === 'migrating' && current.migrating_to
      && current.migrating_to !== desired
      // NEVER drop the active physical, whatever the row claims — an
      // aliased migrating_to must be repaired, not deleted (2026-07-21).
      && current.migrating_to !== current.physical
    ) {
      // The desired layout changed underneath an in-flight migration —
      // abandon the stale green and migrate to the new target instead.
      await dropTolerant(adapter, current.migrating_to)
    }

    return 'migrate'
  })
  if (prep !== 'migrate') return prep

  return runMigration(adapter, def, desired, fp, baseFp, opts)
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
 * Continuation: finish any migration left in-flight by a crash or park.
 * "Resume recorded work" (allowed by D5) — it reads only the registry,
 * never the filesystem, and it resumes the RECORDED target verbatim
 * (migrating_to + migrating_fp). It never recomputes the target: the
 * recompute path lost rebuild nonces and aliased the live physical
 * (2026-07-21 critical finding). Rows recorded before migrating_fp
 * existed fall back to the base fingerprint, guarded by the alias check.
 *
 * Callers: boot (all in-flight rows) and the migration pump
 * (`onlyParked` — crash-interrupted rows belong to boot, parked rows
 * belong to the pump).
 */
export async function resumeMigrations(
  adapter: SearchAdapter,
  defs: TableEnsureDef[],
  mappingFingerprint: string,
  opts?: EnsureOpts & { onlyParked?: boolean },
): Promise<Array<{ logical: string; result: 'migrated' | 'parked' | 'unchanged' | 'skipped' }>> {
  const inFlight = db().prepare<Row, []>("SELECT * FROM search_tables WHERE state = 'migrating'").all()
  const outcomes: Array<{ logical: string; result: 'migrated' | 'parked' | 'unchanged' | 'skipped' }> = []
  for (const row of inFlight) {
    if (opts?.onlyParked && row.migration_phase !== 'parked') continue
    const def = defs.find((d) => d.logical === row.logical)
    if (!def) {
      log.warn('in-flight migration has no registered def — leaving parked', { logical: row.logical })
      outcomes.push({ logical: row.logical, result: 'skipped' })
      continue
    }
    const desired = row.migrating_to
    const baseFp = fingerprint(def, mappingFingerprint)
    const fp = row.migrating_fp ?? baseFp
    if (!desired || desired === row.physical) {
      // No recorded target, or a target aliasing the live table (legacy
      // rows from the recompute era) — repair to active; a later ensure
      // or reindex mints a legitimate fresh green if one is needed.
      log.warn('in-flight migration has no safe recorded target — repairing row to active', {
        logical: row.logical,
        migratingTo: desired,
      })
      repairRowActive(row.logical)
      outcomes.push({ logical: row.logical, result: 'unchanged' })
      continue
    }
    const result = await runMigration(adapter, def, desired, fp, baseFp, opts)
    outcomes.push({ logical: row.logical, result })
  }
  return outcomes
}

/** Test-only: wipe registry + tombstones (close-first — see outbox note). */
export function resetTablesForTests(): void {
  store.close()
  db().exec('DELETE FROM search_tables; DELETE FROM search_table_tombstones; DELETE FROM search_orphan_candidates; DELETE FROM search_created_physicals;')
}
