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
  resolveDrainTargets,
  queryTarget,
  rebuildTable,
  resumeMigrations,
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
