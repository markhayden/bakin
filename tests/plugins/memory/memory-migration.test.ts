/**
 * Tests for the memory-plugin schema migration — specifically the
 * defer-when-search-unavailable behavior introduced in the antfly v0.2
 * migration: bumping the version marker while the index is unreachable would
 * record the migration as done without resetting the table or clearing
 * offsets, permanently hiding rows from the offset-based indexers once
 * search comes back.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-memory-migration-${Date.now()}`)
const versionFile = join(testDir, 'plugin-settings', 'memory', 'schema-version.json')
const offsetsFile = join(testDir, 'plugin-settings', 'memory', 'offsets.json')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { migrateIfNeeded, MEMORY_SCHEMA_VERSION } from '../../../plugins/memory/lib/memory-migration'

function writeVersion(version: number): void {
  mkdirSync(join(testDir, 'plugin-settings', 'memory'), { recursive: true })
  writeFileSync(versionFile, JSON.stringify({ version }))
}

function readVersion(): number | null {
  if (!existsSync(versionFile)) return null
  return (JSON.parse(readFileSync(versionFile, 'utf-8')) as { version: number }).version
}

function makeSearch(args: { available: boolean }) {
  const resetContentType = mock(async () => {})
  const search = {
    maintenance: {
      available: async () => args.available,
      resetContentType,
    },
  }
  return { search: search as unknown as Parameters<typeof migrateIfNeeded>[0], resetContentType }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(join(testDir, 'plugin-settings', 'memory'), { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('migrateIfNeeded', () => {
  it('defers (does NOT bump the marker) when search is unavailable', async () => {
    writeVersion(MEMORY_SCHEMA_VERSION - 1)
    writeFileSync(offsetsFile, JSON.stringify({ 'audit.jsonl': 12345 }))
    const { search, resetContentType } = makeSearch({ available: false })

    const result = await migrateIfNeeded(search)

    expect(result.migrated).toBe(false)
    // The marker MUST stay behind so the migration retries next boot —
    // bumping here would permanently skip the offsets reset.
    expect(readVersion()).toBe(MEMORY_SCHEMA_VERSION - 1)
    expect(existsSync(offsetsFile)).toBe(true)
    expect(resetContentType).not.toHaveBeenCalled()

    // Next boot with search back: migration actually runs.
    const second = makeSearch({ available: true })
    const retried = await migrateIfNeeded(second.search)
    expect(retried.migrated).toBe(true)
    expect(readVersion()).toBe(MEMORY_SCHEMA_VERSION)
    expect(existsSync(offsetsFile)).toBe(false)
    expect(second.resetContentType).toHaveBeenCalled()
  })

  it('resets the table, clears offsets, and bumps the marker when behind', async () => {
    writeVersion(MEMORY_SCHEMA_VERSION - 1)
    writeFileSync(offsetsFile, JSON.stringify({ 'audit.jsonl': 999 }))
    const { search, resetContentType } = makeSearch({ available: true })

    const result = await migrateIfNeeded(search)

    expect(result).toEqual({ migrated: true, from: MEMORY_SCHEMA_VERSION - 1, to: MEMORY_SCHEMA_VERSION })
    expect(readVersion()).toBe(MEMORY_SCHEMA_VERSION)
    expect(existsSync(offsetsFile)).toBe(false)
    expect(resetContentType).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when the stored version is current', async () => {
    writeVersion(MEMORY_SCHEMA_VERSION)
    const { search, resetContentType } = makeSearch({ available: true })

    const result = await migrateIfNeeded(search)

    expect(result.migrated).toBe(false)
    expect(resetContentType).not.toHaveBeenCalled()
  })
})
