/**
 * Read-only storage mode (onboarding hardening, spec §6): a process that
 * only checks must not be able to create, migrate or write a store. An
 * absent store reads as "nothing recorded"; an existing one is read without
 * changing a byte of the database or its write-ahead log.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createHash, randomUUID } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const root = join(tmpdir(), `bakin-test-storage-read-only-${Date.now()}-${randomUUID()}`)
let testDir = join(root, 'initial')
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import {
  closeAllDbs,
  getDb,
  openNamedDb,
  isStorageReadOnly,
  setStorageReadOnly,
  StorageAbsentError,
  StorageUnavailableError,
} from '../../packages/core/src/storage/db'
import {
  listModelProbeSuccessesSince,
  listModelRejections,
  recordModelProbeSuccess,
  recordModelRejection,
} from '../../packages/core/src/execution/ledger'
import {
  readUsageByAgentModelDaySince,
  replaceSessionUsage,
  type SessionDayUsage,
} from '../../packages/core/src/usage-history/store'

const DAY = '2026-07-01'
const T = Date.parse('2026-07-01T10:00:00Z')

function usageRow(): SessionDayUsage {
  return {
    day: DAY, model: 'gpt-5.4', inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5,
    totalTokens: 165, costUsdMicros: 1_500, costedMessages: 2, messageCount: 2, userMessages: 0, firstTs: T, lastTs: T + 60_000,
  }
}

/** Every file in the home → sha256. SQLite's `-shm` index is reported separately. */
function fingerprint(dir: string): Record<string, string> {
  return Object.fromEntries(readdirSync(dir).sort().map((name) => [name, createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')]))
}

function withoutShm(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([name]) => !name.endsWith('-shm')))
}

function seedStores(): void {
  recordModelRejection({ model: 'openai-codex/gpt-5.4-mini', provider: 'openai-codex', detail: 'not supported', at: T })
  recordModelProbeSuccess({ model: 'anthropic/claude-sonnet', at: T })
  expect(replaceSessionUsage('s1', 'basil', [usageRow()], { mtimeMs: 1, size: 2 })).toBe(true)
}

/**
 * Seed, then leave the stores the way a finished process leaves them: the
 * write-ahead log folded into the database and every handle really closed
 * (bun finalizes a closed handle lazily, so force it before fingerprinting).
 */
function seedAndSettle(): void {
  seedStores()
  getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)')
  openNamedDb('usage', () => join(testDir, 'usage.db')).db().exec('PRAGMA wal_checkpoint(TRUNCATE)')
  closeAllDbs()
  ;(Bun as unknown as { gc(force: boolean): void }).gc(true)
}

beforeEach(() => {
  closeAllDbs()
  setStorageReadOnly(false)
  testDir = join(root, randomUUID())
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  setStorageReadOnly(false)
  closeAllDbs()
})

afterAll(() => {
  closeAllDbs()
  rmSync(root, { recursive: true, force: true })
})

describe('read-only storage mode', () => {
  test('is off by default and switches per process', () => {
    expect(isStorageReadOnly()).toBe(false)
    setStorageReadOnly(true)
    expect(isStorageReadOnly()).toBe(true)
    setStorageReadOnly(false)
    expect(isStorageReadOnly()).toBe(false)
  })

  test('absent stores read as no evidence and no file is created', () => {
    setStorageReadOnly(true)
    expect(listModelRejections({ openOnly: true })).toEqual([])
    expect(listModelProbeSuccessesSince(0)).toEqual([])
    expect(readUsageByAgentModelDaySince(DAY)).toEqual([])
    expect(readdirSync(testDir)).toEqual([])
  })

  test('opening an absent store is a typed absence, never a silent create', () => {
    setStorageReadOnly(true)
    expect(() => getDb()).toThrow(StorageAbsentError)
    expect(existsSync(join(testDir, 'bakin.db'))).toBe(false)
  })

  test('existing stores, cleanly closed: evidence is read and nothing in the home changes', () => {
    seedAndSettle()
    const before = fingerprint(testDir)

    setStorageReadOnly(true)
    expect(listModelRejections({ openOnly: true }).map((row) => row.model)).toEqual(['openai-codex/gpt-5.4-mini'])
    expect(listModelProbeSuccessesSince(0)).toEqual(['anthropic/claude-sonnet'])
    const usage = readUsageByAgentModelDaySince(DAY)
    expect(usage.map((cell) => [cell.agent, cell.model, cell.tokens.total])).toEqual([['basil', 'gpt-5.4', 165]])
    closeAllDbs()

    expect(fingerprint(testDir)).toEqual(before)
  })

  test('existing stores with a pending write-ahead log: rows still in the log are read; the database and the log are untouched', () => {
    seedStores()
    // Another process is mid-flight: copy the stores as they are on disk,
    // log included, without closing the writer.
    const live = testDir
    const copy = join(root, randomUUID())
    mkdirSync(copy, { recursive: true })
    for (const name of readdirSync(live)) copyFileSync(join(live, name), join(copy, name))
    closeAllDbs()
    testDir = copy
    const before = fingerprint(copy)
    expect(Object.keys(before).some((name) => name.endsWith('-wal') && readFileSync(join(copy, name)).length > 0)).toBe(true)

    setStorageReadOnly(true)
    expect(listModelRejections({ openOnly: true })).toHaveLength(1)
    expect(listModelProbeSuccessesSince(0)).toEqual(['anthropic/claude-sonnet'])
    expect(readUsageByAgentModelDaySince(DAY)).toHaveLength(1)
    closeAllDbs()

    // Only SQLite's shared-memory index may differ: it is rebuilt from the
    // log by any reader and holds no data of its own.
    expect(withoutShm(fingerprint(copy))).toEqual(withoutShm(before))
  })

  test('a write through a read-only handle fails in the database instead of landing', () => {
    seedAndSettle()
    const before = fingerprint(testDir)
    setStorageReadOnly(true)
    expect(() => recordModelProbeSuccess({ model: 'x/y', at: T })).toThrow(StorageUnavailableError)
    closeAllDbs()
    expect(fingerprint(testDir)).toEqual(before)
  })

  test('a store that predates the schema this code reads is not migrated; it reads as no evidence', async () => {
    // A ledger file with the migration table but none of this module's tables.
    const { Database } = await import('bun:sqlite')
    const raw = new Database(join(testDir, 'bakin.db'), { create: true })
    raw.exec('CREATE TABLE schema_migrations (module TEXT NOT NULL, version INTEGER NOT NULL, applied_at INTEGER NOT NULL, PRIMARY KEY (module, version))')
    raw.close()
    const before = fingerprint(testDir)

    setStorageReadOnly(true)
    expect(listModelRejections({ openOnly: true })).toEqual([])
    expect(listModelProbeSuccessesSince(0)).toEqual([])
    closeAllDbs()
    expect(fingerprint(testDir)).toEqual(before)
  })

  test('leaving read-only mode restores normal create-on-first-use behaviour', () => {
    setStorageReadOnly(true)
    expect(listModelRejections()).toEqual([])
    setStorageReadOnly(false)
    recordModelProbeSuccess({ model: 'x/y', at: T })
    expect(listModelProbeSuccessesSince(0)).toEqual(['x/y'])
    expect(existsSync(join(testDir, 'bakin.db'))).toBe(true)
  })
})
