/**
 * Multi-db storage core — openNamedDb gives each store (coordination ledger,
 * search outbox, …) its own SQLite file with its own per-module migration
 * ledger, while db.ts stays the repo's sole bun:sqlite importer.
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-multidb-${Date.now()}-${randomUUID()}`)
let coordPath = join(testDir, 'bakin.db')
let namedPath = join(testDir, 'search.db')

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: coordPath,
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
  openNamedDb,
  getDb,
  applyMigrations,
  closeDb,
  closeAllDbs,
  StorageUnavailableError,
  type Db,
} from '../../packages/core/src/storage/db'

afterAll(() => {
  closeAllDbs()
  rmSync(testDir, { recursive: true, force: true })
})

describe('openNamedDb', () => {
  it('opens a distinct database file from the coordination db', () => {
    const named = openNamedDb('search', () => namedPath)
    const namedHandle = named.db()
    const coordHandle = getDb()
    expect(namedHandle).not.toBe(coordHandle)

    // Writes land in separate files: a table created in one is absent in the other.
    namedHandle.exec('CREATE TABLE only_in_named (id INTEGER PRIMARY KEY)')
    const inCoord = coordHandle
      .prepare<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE name = ?")
      .get('only_in_named')
    expect(inCoord).toBeNull()
  })

  it('returns the same handle for the same name while the path is stable', () => {
    const a = openNamedDb('search', () => namedPath)
    const b = openNamedDb('search', () => namedPath)
    expect(a.db()).toBe(b.db())
  })

  it('tracks per-module migrations independently per database file', () => {
    const named = openNamedDb('search', () => namedPath)
    named.applyMigrations('outbox', [
      { version: 1, up: (db: Db) => db.exec('CREATE TABLE outbox_rows (id INTEGER PRIMARY KEY)') },
    ])
    applyMigrations('outbox', [
      { version: 1, up: (db: Db) => db.exec('CREATE TABLE coord_outbox_marker (id INTEGER PRIMARY KEY)') },
    ])

    // Same module name, different files — both ledgers applied v1 with their own table.
    const namedRow = named
      .db()
      .prepare<{ version: number }, [string]>('SELECT version FROM schema_migrations WHERE module = ?')
      .get('outbox')
    const coordRow = getDb()
      .prepare<{ version: number }, [string]>('SELECT version FROM schema_migrations WHERE module = ?')
      .get('outbox')
    expect(namedRow?.version).toBe(1)
    expect(coordRow?.version).toBe(1)

    const namedHasOwn = named
      .db()
      .prepare<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE name = ?")
      .get('outbox_rows')
    const namedHasCoordMarker = named
      .db()
      .prepare<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE name = ?")
      .get('coord_outbox_marker')
    expect(namedHasOwn).not.toBeNull()
    expect(namedHasCoordMarker).toBeNull()
  })

  it('runs withTx against its own database', () => {
    const named = openNamedDb('search', () => namedPath)
    named.db().exec('CREATE TABLE IF NOT EXISTS tx_probe (id INTEGER PRIMARY KEY)')
    expect(() =>
      named.withTx(() => {
        named.db().prepare('INSERT INTO tx_probe (id) VALUES (?)').run(1)
        throw new Error('rollback')
      }),
    ).toThrow('rollback')
    const row = named.db().prepare<{ id: number }, [number]>('SELECT id FROM tx_probe WHERE id = ?').get(1)
    expect(row).toBeNull()
  })

  it('swaps to a fresh handle when the resolved path changes (test remaps)', () => {
    const named = openNamedDb('search', () => namedPath)
    const before = named.db()
    namedPath = join(testDir, 'search-remapped.db')
    const after = named.db()
    expect(after).not.toBe(before)
    // migrations re-apply on the fresh file
    named.applyMigrations('outbox', [
      { version: 1, up: (db: Db) => db.exec('CREATE TABLE outbox_rows (id INTEGER PRIMARY KEY)') },
    ])
    expect(
      named.db().prepare<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE name = ?").get('outbox_rows'),
    ).not.toBeNull()
  })

  it('close() drops the handle and db() reopens lazily', () => {
    const named = openNamedDb('search', () => namedPath)
    const before = named.db()
    named.close()
    const after = named.db()
    expect(after).not.toBe(before)
  })

  it('throws StorageUnavailableError when the path is unopenable', () => {
    const blocker = join(testDir, 'not-a-dir')
    writeFileSync(blocker, 'plain file')
    const bad = openNamedDb('bad', () => join(blocker, 'nested', 'x.db'))
    expect(() => bad.db()).toThrow(StorageUnavailableError)
  })

  it('coordination getDb() is unaffected by named stores', () => {
    const coordBefore = getDb()
    openNamedDb('search', () => namedPath).db()
    expect(getDb()).toBe(coordBefore)
    closeDb()
    expect(getDb()).not.toBe(coordBefore)
  })
})
