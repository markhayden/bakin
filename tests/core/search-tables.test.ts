/**
 * Blue/green table registry + migrator (D4). Logical names map to
 * versioned physical tables; schema/fingerprint changes migrate in the
 * background while queries keep hitting the old fully-converged table;
 * the pointer flips atomically only after convergence.
 */
import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-tables-${Date.now()}-${randomUUID()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import {
  ensureTable,
  removeTableRegistration,
  resolveDrainTargets,
  queryTarget,
  rebuildTable,
  resumeMigrations,
  sweepOrphanEngineTables,
  sweepTombstones,
  tableStatus,
  resetTablesForTests,
  type TableEnsureDef,
} from '../../packages/core/src/search/tables'
import { createMockSearchAdapter } from '../../packages/core/src/adapters/search/testing'
import { closeAllDbs } from '../../packages/core/src/storage/db'
import type { SearchAdapter } from '../../packages/core/src/adapters/search'

afterAll(() => {
  closeAllDbs()
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  resetTablesForTests()
})

function makeDef(overrides: Partial<TableEnsureDef> = {}): TableEnsureDef {
  return {
    logical: 'bakin_notes',
    schemaVersion: 1,
    config: {
      fields: { title: { type: 'text' } },
      legs: [{ name: 'full_text', capability: 'full-text', fields: ['title'] }],
    },
    reindex: async function* () {
      yield { key: 'n1', doc: { title: 'first note' } }
      yield { key: 'n2', doc: { title: 'second note' } }
    },
    ...overrides,
  }
}

/** Wrap a mock adapter with call counting for the boot-does-nothing assertion. */
function spyAdapter(base: SearchAdapter = createMockSearchAdapter()): { adapter: SearchAdapter; calls: () => number } {
  let calls = 0
  const count = <T extends object>(obj: T): T => new Proxy(obj, {
    get(t, prop) {
      const v = Reflect.get(t, prop)
      if (typeof v === 'function') return (...args: unknown[]) => { calls++; return (v as (...a: unknown[]) => unknown).apply(t, args) }
      if (v && typeof v === 'object') return count(v as object)
      return v
    },
  })
  return { adapter: count(base), calls: () => calls }
}

describe('ensureTable', () => {
  it('first ensure creates the versioned physical table and seeds it from reindex()', async () => {
    const adapter = createMockSearchAdapter()
    const result = await ensureTable(adapter, makeDef(), 'fp-a')
    expect(result).toBe('created')

    const physical = queryTarget('bakin_notes')
    expect(physical).toMatch(/^bakin_notes_v1_[0-9a-f]{8}$/)
    expect((await adapter.tables.stats(physical!))?.documents).toBe(2)
    expect(tableStatus('bakin_notes')?.state).toBe('active')
  })

  it('matching ensure performs ZERO adapter calls (the boot-does-nothing guarantee)', async () => {
    const first = createMockSearchAdapter()
    await ensureTable(first, makeDef(), 'fp-a')

    const { adapter, calls } = spyAdapter(first)
    const result = await ensureTable(adapter, makeDef(), 'fp-a')
    expect(result).toBe('unchanged')
    expect(calls()).toBe(0)
  })

  it('drain targets are the single active physical when not migrating', async () => {
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const targets = resolveDrainTargets('bakin_notes')
    expect(targets).toEqual([queryTarget('bakin_notes')!])
  })
})

describe('createTableTolerant (exists-first, cutover fix)', () => {
  it('never POSTs a create onto an existing physical; creates only when stats is null', async () => {
    const base = createMockSearchAdapter()
    // Pre-existing physical from a crashed first attempt (row insert lost).
    const def = makeDef()
    const createCalls: string[] = []
    const adapter: SearchAdapter = {
      ...base,
      tables: {
        ...base.tables,
        create: async (name, config) => {
          createCalls.push(name)
          return base.tables.create(name, config)
        },
      },
      capabilities: base.capabilities?.bind(base),
      mappingFingerprint: base.mappingFingerprint?.bind(base),
      query: base.query.bind(base),
      multiQuery: base.multiQuery.bind(base),
      scan: base.scan.bind(base),
      documents: base.documents,
    }

    // First ensure: table absent → create IS called, row inserted, seeded.
    await ensureTable(adapter, def, 'fp-a')
    expect(createCalls).toHaveLength(1)
    const physical = queryTarget(def.logical)!

    // Simulate the crashed-first-attempt shape: physical EXISTS in the
    // engine but the registry row is gone (lost between backfill and insert).
    resetTablesForTests()
    expect((await adapter.tables.stats(physical))?.documents).toBe(2)

    // Re-ensure: exists-first check must SKIP the duplicate create POST
    // (re-creating an existing table hangs/500s on the live engine).
    await ensureTable(adapter, def, 'fp-a')
    expect(createCalls).toHaveLength(1)
    expect(queryTarget(def.logical)).toBe(physical)
    expect(tableStatus(def.logical)?.state).toBe('active')
  })
})

describe('blue/green migration', () => {
  it('schemaVersion bump migrates: dual-write during backfill, flip only after converge, old dropped', async () => {
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const blue = queryTarget('bakin_notes')!

    const observed: Array<{ during: string; targets: string[]; queryTarget: string }> = []
    const migrated = await ensureTable(adapter, makeDef({
      schemaVersion: 2,
      reindex: async function* () {
        // Mid-backfill observation: dual-write on, queries still on blue.
        observed.push({
          during: 'backfill',
          targets: resolveDrainTargets('bakin_notes'),
          queryTarget: queryTarget('bakin_notes')!,
        })
        yield { key: 'n1', doc: { title: 'first note v2' } }
        yield { key: 'n2', doc: { title: 'second note v2' } }
      },
    }), 'fp-a')
    expect(migrated).toBe('migrated')

    // During backfill: both targets received writes, queries stayed on blue.
    expect(observed[0].targets).toHaveLength(2)
    expect(observed[0].targets[0]).toBe(blue)
    expect(observed[0].queryTarget).toBe(blue)

    // After: pointer flipped to green, old table dropped, single target again.
    const green = queryTarget('bakin_notes')!
    expect(green).toMatch(/^bakin_notes_v2_/)
    expect(green).not.toBe(blue)
    expect(resolveDrainTargets('bakin_notes')).toEqual([green])
    expect((await adapter.tables.stats(green))?.documents).toBe(2)
    const tables = await adapter.tables.list()
    expect(tables.map((t) => t.name)).not.toContain(blue)
    expect(tableStatus('bakin_notes')?.state).toBe('active')
  })

  it('an adapter mappingFingerprint change migrates without any def change', async () => {
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const blue = queryTarget('bakin_notes')!

    const result = await ensureTable(adapter, makeDef(), 'fp-b')
    expect(result).toBe('migrated')
    const green = queryTarget('bakin_notes')!
    expect(green).not.toBe(blue)
    expect(green).toMatch(/^bakin_notes_v1_/)
  })

  it('rebuildTable forces a migration to a fresh physical with identical version+fingerprint', async () => {
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const blue = queryTarget('bakin_notes')!

    await rebuildTable(adapter, makeDef(), 'fp-a')
    const green = queryTarget('bakin_notes')!
    expect(green).not.toBe(blue)
    expect((await adapter.tables.stats(green))?.documents).toBe(2)
    expect(tableStatus('bakin_notes')?.state).toBe('active')
  })

  it('converge failure parks the migration (never flips early); resume completes it', async () => {
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const blue = queryTarget('bakin_notes')!

    // Green's legs never report ready → converge cannot pass → parked.
    const stuck = createMockSearchAdapter()
    // seed the stuck adapter with the blue table state so drops/stats resolve
    await stuck.tables.create(blue, makeDef().config)
    const neverReady: SearchAdapter = {
      ...stuck,
      tables: {
        ...stuck.tables,
        health: async (name) => (name === blue
          ? [{ leg: 'full_text', state: 'ready' as const, indexedCount: 2 }]
          : [{ leg: 'full_text', state: 'building' as const, indexedCount: 0 }]),
      },
    }
    const result = await ensureTable(neverReady, makeDef({ schemaVersion: 3 }), 'fp-a', { convergeTimeoutMs: 200, convergePollMs: 20 })
    expect(result).toBe('parked')
    expect(tableStatus('bakin_notes')?.state).toBe('migrating')
    // Queries NEVER moved off blue.
    expect(queryTarget('bakin_notes')).toBe(blue)

    // Engine recovers → resume completes the parked migration.
    await resumeMigrations(stuck, [makeDef({ schemaVersion: 3 })], 'fp-a')
    expect(queryTarget('bakin_notes')).toMatch(/^bakin_notes_v3_/)
    expect(tableStatus('bakin_notes')?.state).toBe('active')
  })

  it('converges when the source SHRANK after backfill (green stable below the emitted count)', async () => {
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')

    // v3 backfill emits 3 docs, but one source doc is deleted right after
    // enumeration — the green will only ever hold 2. The old converge
    // (green >= emitted) parked FOREVER on this (live: bakin_memory,
    // 2026-07-11 — orphan-swept audit rows shrank the source mid-migration).
    const def3 = makeDef({
      schemaVersion: 3,
      reindex: async function* () {
        yield { key: 'n1', doc: { title: 'one' } }
        yield { key: 'n2', doc: { title: 'two' } }
        yield { key: 'gone', doc: { title: 'deleted-after-enumeration' } }
      },
    })
    // Simulate the shrink: the mock adapter indexes all 3, then the doc is
    // removed from the green (dual-written delete) before converge.
    const wrapped: SearchAdapter = {
      ...adapter,
      tables: {
        ...adapter.tables,
        stats: async (name) => {
          const stats = await adapter.tables.stats(name)
          if (stats && name.startsWith('bakin_notes_v3_')) {
            await adapter.documents.remove(name, 'gone').catch(() => {})
            const fresh = await adapter.tables.stats(name)
            return fresh
          }
          return stats
        },
      },
    }
    const result = await ensureTable(wrapped, def3, 'fp-a', { convergeTimeoutMs: 5_000, convergePollMs: 50 })
    expect(result).toBe('migrated')
    expect(queryTarget('bakin_notes')).toMatch(/^bakin_notes_v3_/)
  }, 20_000)

  it('resume skips the re-backfill when the green already holds the emitted corpus', async () => {
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const blue = queryTarget('bakin_notes')!

    // Park a migration whose backfill fully landed (green has the docs)
    // but converge timed out — the live case: an embeddings leg that needs
    // longer than the converge window while the engine keeps working.
    const neverReady: SearchAdapter = {
      ...adapter,
      tables: {
        ...adapter.tables,
        health: async (name) => (name === blue
          ? [{ leg: 'full_text', state: 'ready' as const, indexedCount: 2 }]
          : [{ leg: 'full_text', state: 'building' as const, indexedCount: 0 }]),
      },
    }
    await ensureTable(neverReady, makeDef({ schemaVersion: 3 }), 'fp-a', { convergeTimeoutMs: 100, convergePollMs: 20 })
    expect(tableStatus('bakin_notes')?.state).toBe('migrating')

    // Resume with a poisoned reindex(): if resume re-backfills, this throws.
    const defNoReindex = makeDef({
      schemaVersion: 3,
      reindex: async function* (): AsyncGenerator<{ key: string; doc: Record<string, unknown> }> {
        yield* []
        throw new Error('resume must not re-backfill an already-landed green')
      },
    })
    await resumeMigrations(adapter, [defNoReindex], 'fp-a')
    expect(queryTarget('bakin_notes')).toMatch(/^bakin_notes_v3_/)
    expect(tableStatus('bakin_notes')?.state).toBe('active')
  })

  it('crash mid-migration resumes from persisted state (dual-write already on)', async () => {
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const blue = queryTarget('bakin_notes')!

    // Simulate a crash: start a migration whose backfill throws mid-way.
    const def2 = makeDef({
      schemaVersion: 2,
      reindex: async function* () {
        yield { key: 'n1', doc: { title: 'v2' } }
        throw new Error('process died')
      },
    })
    await expect(ensureTable(adapter, def2, 'fp-a')).rejects.toThrow('process died')
    expect(tableStatus('bakin_notes')?.state).toBe('migrating')
    expect(queryTarget('bakin_notes')).toBe(blue)
    // dual-write stays on across the "crash"
    expect(resolveDrainTargets('bakin_notes')).toHaveLength(2)

    // Next boot: resumeMigrations completes with a healthy generator.
    await resumeMigrations(adapter, [makeDef({ schemaVersion: 2 })], 'fp-a')
    expect(queryTarget('bakin_notes')).toMatch(/^bakin_notes_v2_/)
    expect(tableStatus('bakin_notes')?.state).toBe('active')
  })
})

describe('2026-07-21 redesign: identity, progress-aware converge, chain split', () => {
  it('resume replays the RECORDED nonce target — never a recomputed alias of the live table', async () => {
    // The critical five-lens finding: resume used to recompute the
    // fingerprint WITHOUT the rebuild nonce, alias the live physical, and
    // the post-flip drop deleted it.
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const live = queryTarget('bakin_notes')!

    // Park a nonce'd rebuild (never-ready green, fast zero-progress park).
    const neverReady: SearchAdapter = {
      ...adapter,
      tables: {
        ...adapter.tables,
        health: async (name) => (name === live
          ? [{ leg: 'full_text', state: 'ready' as const, indexedCount: 2 }]
          : [{ leg: 'full_text', state: 'building' as const, indexedCount: 0 }]),
      },
    }
    const parked = await rebuildTable(neverReady, makeDef(), 'fp-a', { zeroProgressParkMs: 60, convergePollMs: 20 })
    expect(parked).toBe('parked')
    const recordedGreen = tableStatus('bakin_notes')!.migratingTo!
    expect(recordedGreen).not.toBe(live)

    // Resume with a healthy engine: it must complete toward the RECORDED
    // green, and the live table must survive until the flip (then drop).
    await resumeMigrations(adapter, [makeDef()], 'fp-a')
    expect(queryTarget('bakin_notes')).toBe(recordedGreen)
    expect(tableStatus('bakin_notes')?.state).toBe('active')
    expect(await adapter.tables.stats(recordedGreen)).not.toBeNull()
  })

  it('plain ensure NO-OPS on a nonce\'d rebuild generation (no boomerang back to the base name)', async () => {
    // Soak cycle-1 finding (2026-07-22): ensure compared physical NAMES, so
    // every rebuilt (nonce'd) table read as drift and migrated BACK to the
    // base name — re-running enumerators and re-embedding forever.
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const rebuilt = await rebuildTable(adapter, makeDef(), 'fp-a')
    expect(rebuilt).toBe('migrated')
    const nonced = queryTarget('bakin_notes')!

    const again = await ensureTable(adapter, makeDef(), 'fp-a')
    expect(again).toBe('unchanged')
    expect(queryTarget('bakin_notes')).toBe(nonced)

    // A REAL identity change (new mapping fingerprint) still migrates.
    const moved = await ensureTable(adapter, makeDef(), 'fp-b')
    expect(moved).toBe('migrated')
    expect(queryTarget('bakin_notes')).not.toBe(nonced)

    // And a schemaVersion bump still migrates even with the same config.
    const bumped = await ensureTable(adapter, makeDef({ schemaVersion: 2 }), 'fp-b')
    expect(bumped).toBe('migrated')
    expect(queryTarget('bakin_notes')).toMatch(/^bakin_notes_v2_/)
  })

  it('repairs (never drops) a legacy row whose migration target aliases the live physical', async () => {
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const live = queryTarget('bakin_notes')!

    // Hand-craft the recompute-era corruption: migrating toward yourself.
    const { openNamedDb } = await import('../../packages/core/src/storage/db')
    const store = openNamedDb('search', () => join(testDir, 'search.db'))
    store.db().prepare(
      "UPDATE search_tables SET state = 'migrating', migrating_to = physical, migrating_fp = NULL, migration_phase = 'parked' WHERE logical = 'bakin_notes'",
    ).run()

    await resumeMigrations(adapter, [makeDef()], 'fp-a')
    expect(tableStatus('bakin_notes')?.state).toBe('active')
    expect(queryTarget('bakin_notes')).toBe(live)
    // The live table was never dropped.
    expect(await adapter.tables.stats(live)).not.toBeNull()
  })

  it('parks a frozen green on the zero-progress window, far before the hard timeout', async () => {
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const live = queryTarget('bakin_notes')!
    const neverReady: SearchAdapter = {
      ...adapter,
      tables: {
        ...adapter.tables,
        health: async (name) => (name === live
          ? [{ leg: 'full_text', state: 'ready' as const, indexedCount: 2 }]
          : [{ leg: 'full_text', state: 'building' as const, indexedCount: 0, pendingCount: 0 }]),
      },
    }
    const started = Date.now()
    const result = await ensureTable(neverReady, makeDef({ schemaVersion: 3 }), 'fp-a', {
      convergeTimeoutMs: 60_000,
      convergePollMs: 20,
      zeroProgressParkMs: 100,
    })
    expect(result).toBe('parked')
    // Parked on frozen progress in well under a second — not the 60s cap.
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('keeps waiting while a green is PROGRESSING, then flips when legs go ready', async () => {
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const live = queryTarget('bakin_notes')!
    let polls = 0
    const progressing: SearchAdapter = {
      ...adapter,
      tables: {
        ...adapter.tables,
        health: async (name) => {
          if (name === live) return [{ leg: 'full_text', state: 'ready' as const, indexedCount: 2 }]
          polls += 1
          // Pending decreases each poll (real progress), ready on the 6th —
          // total wait far exceeds the zero-progress window.
          return polls < 6
            ? [{ leg: 'sem', state: 'building' as const, indexedCount: polls, pendingCount: 6 - polls }]
            : [{ leg: 'sem', state: 'ready' as const, indexedCount: 6, pendingCount: 0 }]
        },
      },
    }
    const result = await ensureTable(progressing, makeDef({ schemaVersion: 3 }), 'fp-a', {
      convergePollMs: 30,
      zeroProgressParkMs: 60,
    })
    expect(result).toBe('migrated')
    expect(queryTarget('bakin_notes')).toMatch(/^bakin_notes_v3_/)
  })

  it('never flips on failed stats reads (evidence failure is not stability)', async () => {
    // Old converged(): stats failure ?? 0, and two 0s in a row counted as
    // "stable" — laundering outage into flip evidence.
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const live = queryTarget('bakin_notes')!
    const statsDark: SearchAdapter = {
      ...adapter,
      tables: {
        ...adapter.tables,
        stats: async (name) => {
          if (name === live) return { table: name, documents: 2 }
          throw new Error('stats unavailable')
        },
      },
    }
    const result = await ensureTable(statsDark, makeDef({ schemaVersion: 3 }), 'fp-a', {
      convergePollMs: 20,
      zeroProgressParkMs: 100,
    })
    expect(result).toBe('parked')
    expect(queryTarget('bakin_notes')).toBe(live)
  })

  it('a leg in error state parks immediately — waiting cannot fix a failed worker', async () => {
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const live = queryTarget('bakin_notes')!
    const failedLeg: SearchAdapter = {
      ...adapter,
      tables: {
        ...adapter.tables,
        health: async (name) => (name === live
          ? [{ leg: 'full_text', state: 'ready' as const, indexedCount: 2 }]
          : [{ leg: 'sem', state: 'error' as const, indexedCount: 0, error: 'worker crashed' }]),
      },
    }
    const started = Date.now()
    const result = await ensureTable(failedLeg, makeDef({ schemaVersion: 3 }), 'fp-a', {
      convergeTimeoutMs: 60_000,
      convergePollMs: 20,
      zeroProgressParkMs: 30_000,
    })
    expect(result).toBe('parked')
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('a converging table does NOT hold the chain — another table completes meanwhile', async () => {
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    const live = queryTarget('bakin_notes')!
    const slowConverge: SearchAdapter = {
      ...adapter,
      tables: {
        ...adapter.tables,
        health: async (name) => (name === live
          ? [{ leg: 'full_text', state: 'ready' as const, indexedCount: 2 }]
          : [{ leg: 'full_text', state: 'building' as const, indexedCount: 0, pendingCount: 0 }]),
      },
    }
    // Kick table A into a (doomed, slow) converge without awaiting it.
    let aSettled = false
    const a = ensureTable(slowConverge, makeDef({ schemaVersion: 3 }), 'fp-a', {
      convergePollMs: 50,
      zeroProgressParkMs: 2_000,
    }).then((r) => {
      aSettled = true
      return r
    })

    // Give A time to clear its backfill (which DOES hold the chain).
    await new Promise((resolve) => setTimeout(resolve, 300))

    // Table B's whole lifecycle completes while A is still converging.
    const b = await ensureTable(adapter, makeDef({ logical: 'bakin_other' }), 'fp-a')
    expect(b).toBe('created')
    expect(aSettled).toBe(false)

    expect(await a).toBe('parked')
  })
})

describe('sweepOrphanEngineTables', () => {
  const TABLE_CONFIG = {
    fields: { title: { type: 'text' } },
    legs: [{ name: 'full_text', capability: 'full-text', fields: ['title'] }],
  } as TableEnsureDef['config']

  /** An orphan THIS instance owns: ensured, then its registry row purged. */
  async function makeOwnedOrphan(adapter: SearchAdapter): Promise<string> {
    await ensureTable(adapter, makeDef(), 'fp-a')
    const physical = queryTarget('bakin_notes')!
    removeTableRegistration('bakin_notes')
    return physical
  }

  it('drops an owned unreferenced table only after it survives the dwell window', async () => {
    const adapter = createMockSearchAdapter()
    const orphan = await makeOwnedOrphan(adapter)

    // First observation only records the candidate — nothing dropped yet.
    const first = await sweepOrphanEngineTables(adapter, { dwellMs: 0 })
    expect(first.dropped).toEqual([])
    expect(first.pending).toBe(1)
    expect(first.unclaimed).toEqual([])

    // Second observation past the dwell drops it.
    const second = await sweepOrphanEngineTables(adapter, { dwellMs: 0 })
    expect(second.dropped).toEqual([orphan])
    expect(second.pending).toBe(0)
    expect(await adapter.tables.stats(orphan)).toBeNull()
  })

  it('NEVER drops an unreferenced table it did not create — reports it unclaimed (shared-engine safety)', async () => {
    const adapter = createMockSearchAdapter()
    // Another Bakin home's live table on a shared engine: versioned name,
    // absent from this instance's registry AND ownership ledger.
    await adapter.tables.create('bakin_tasks_v3_ab12cd34', TABLE_CONFIG)
    await sweepOrphanEngineTables(adapter, { dwellMs: 0 })
    const second = await sweepOrphanEngineTables(adapter, { dwellMs: 0 })
    expect(second.dropped).toEqual([])
    expect(second.pending).toBe(0)
    expect(second.unclaimed).toEqual(['bakin_tasks_v3_ab12cd34'])
    expect(await adapter.tables.stats('bakin_tasks_v3_ab12cd34')).not.toBeNull()
  })

  it('never drops inside the dwell window', async () => {
    const adapter = createMockSearchAdapter()
    const orphan = await makeOwnedOrphan(adapter)
    await sweepOrphanEngineTables(adapter, { dwellMs: 60_000 })
    const second = await sweepOrphanEngineTables(adapter, { dwellMs: 60_000 })
    expect(second.dropped).toEqual([])
    expect(second.pending).toBe(1)
    expect(await adapter.tables.stats(orphan)).not.toBeNull()
  })

  it('ignores names that do not match the versioned physical pattern', async () => {
    const adapter = createMockSearchAdapter()
    await adapter.tables.create('someone_elses_table', TABLE_CONFIG)
    await adapter.tables.create('bakin_notes_backup', TABLE_CONFIG)
    await sweepOrphanEngineTables(adapter, { dwellMs: 0 })
    const second = await sweepOrphanEngineTables(adapter, { dwellMs: 0 })
    expect(second.dropped).toEqual([])
    expect(second.pending).toBe(0)
    expect(second.unclaimed).toEqual([])
    expect(await adapter.tables.stats('someone_elses_table')).not.toBeNull()
  })

  it('a candidate that becomes referenced again is forgiven — first-seen does not linger', async () => {
    const adapter = createMockSearchAdapter()
    const def = makeDef()
    const physical = await makeOwnedOrphan(adapter)
    await sweepOrphanEngineTables(adapter, { dwellMs: 0 }) // records candidate
    await ensureTable(adapter, def, 'fp-a') // registry row returns (same physical)
    expect(queryTarget('bakin_notes')).toBe(physical)
    const sweep = await sweepOrphanEngineTables(adapter, { dwellMs: 0 })
    expect(sweep.dropped).toEqual([])
    expect(sweep.pending).toBe(0)
    expect(await adapter.tables.stats(physical)).not.toBeNull()
  })

  it('a mid-migration green is referenced — never a candidate', async () => {
    const adapter = createMockSearchAdapter()
    await ensureTable(adapter, makeDef(), 'fp-a')
    // Park a migration: a generator that dies leaves state=migrating with
    // migrating_to persisted (dual-write on).
    const def2 = makeDef({
      schemaVersion: 2,
      reindex: async function* () {
        yield { key: 'n1', doc: { title: 'v2' } }
        throw new Error('process died')
      },
    })
    await expect(ensureTable(adapter, def2, 'fp-a')).rejects.toThrow('process died')
    const [, green] = resolveDrainTargets('bakin_notes')
    expect(green).toMatch(/^bakin_notes_v2_/)

    await sweepOrphanEngineTables(adapter, { dwellMs: 0 })
    const sweep = await sweepOrphanEngineTables(adapter, { dwellMs: 0 })
    expect(sweep.dropped).toEqual([])
    expect(await adapter.tables.stats(green)).not.toBeNull()
  })

  it('a failing drop is tombstoned for the tombstone sweep instead of retrying forever', async () => {
    const base = createMockSearchAdapter()
    const orphan = await makeOwnedOrphan(base)
    const failing: SearchAdapter = {
      ...base,
      tables: { ...base.tables, drop: async () => { throw new Error('engine 500') } },
      query: base.query.bind(base),
      multiQuery: base.multiQuery.bind(base),
      scan: base.scan.bind(base),
      documents: base.documents,
    }
    await sweepOrphanEngineTables(failing, { dwellMs: 0 })
    const sweep = await sweepOrphanEngineTables(failing, { dwellMs: 0 })
    expect(sweep.dropped).toEqual([])
    expect(sweep.pending).toBe(0) // no longer a candidate — it is a tombstone now

    // The tombstone sweep finishes the job once the engine recovers.
    const left = await sweepTombstones(base)
    expect(left).toBe(0)
    expect(await base.tables.stats(orphan)).toBeNull()
  })
})
