import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

const testDir = path.join(process.cwd(), 'test-content-search-migration')
const stateFile = path.join(testDir, '.search-state.json')

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// Antfly mock — controlled per-test via state vars below
const antflyState = {
  enabled: true,
  tables: [] as Array<{ name: string }>,
  dropped: [] as string[],
  listError: false as boolean | Error,
  dropError: null as null | Error,
}

vi.mock('../../src/core/antfly', () => ({
  enabled: () => antflyState.enabled,
  listTables: vi.fn(async () => {
    if (antflyState.listError) throw antflyState.listError
    return antflyState.tables
  }),
  dropTable: vi.fn(async (name: string) => {
    if (antflyState.dropError) throw antflyState.dropError
    antflyState.dropped.push(name)
  }),
}))

import {
  SCHEMA_VERSION,
  readStoredVersion,
  writeStoredVersion,
  migrateIfNeeded,
} from '../../src/core/search-migration'
import { resetContentDir } from '../../src/core/content-dir'

describe('search-migration', () => {
  beforeEach(() => {
    process.env.CONTENT_DIR = testDir
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true })
    fs.mkdirSync(testDir, { recursive: true })
    // Reset antfly mock state
    antflyState.enabled = true
    antflyState.tables = []
    antflyState.dropped = []
    antflyState.listError = false
    antflyState.dropError = null
    // Reset the content-dir module cache so each test picks up the
    // per-test CONTENT_DIR env var.
    resetContentDir()
  })

  afterEach(() => {
    delete process.env.CONTENT_DIR
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true })
  })

  describe('readStoredVersion', () => {
    it('returns 0 when the state file does not exist', () => {
      expect(readStoredVersion()).toBe(0)
    })

    it('returns the stored version when the file exists', () => {
      fs.writeFileSync(stateFile, JSON.stringify({ version: 5 }))
      expect(readStoredVersion()).toBe(5)
    })

    it('returns 0 on a malformed state file', () => {
      fs.writeFileSync(stateFile, '{not json')
      expect(readStoredVersion()).toBe(0)
    })

    it('returns 0 when the version field is missing', () => {
      fs.writeFileSync(stateFile, JSON.stringify({ foo: 'bar' }))
      expect(readStoredVersion()).toBe(0)
    })
  })

  describe('writeStoredVersion', () => {
    it('writes the version to disk', () => {
      writeStoredVersion(7)
      expect(fs.existsSync(stateFile)).toBe(true)
      expect(JSON.parse(fs.readFileSync(stateFile, 'utf-8'))).toEqual({ version: 7 })
    })

    it('creates the content directory if missing', () => {
      fs.rmSync(testDir, { recursive: true })
      writeStoredVersion(3)
      expect(fs.existsSync(stateFile)).toBe(true)
    })
  })

  describe('migrateIfNeeded', () => {
    it('is a no-op when stored version equals code version', async () => {
      fs.writeFileSync(stateFile, JSON.stringify({ version: SCHEMA_VERSION }))
      const result = await migrateIfNeeded()
      expect(result.migrated).toBe(false)
      expect(result.from).toBe(SCHEMA_VERSION)
      expect(result.to).toBe(SCHEMA_VERSION)
      expect(antflyState.dropped).toEqual([])
    })

    it('is a no-op when stored version is greater than code version', async () => {
      fs.writeFileSync(stateFile, JSON.stringify({ version: SCHEMA_VERSION + 5 }))
      const result = await migrateIfNeeded()
      expect(result.migrated).toBe(false)
      expect(antflyState.dropped).toEqual([])
    })

    it('is a no-op when Antfly is disabled', async () => {
      antflyState.enabled = false
      fs.writeFileSync(stateFile, JSON.stringify({ version: 0 }))
      const result = await migrateIfNeeded()
      expect(result.migrated).toBe(false)
      expect(antflyState.dropped).toEqual([])
    })

    it('drops all bakin_* tables and writes the new version on mismatch', async () => {
      antflyState.tables = [
        { name: 'bakin_tasks' },
        { name: 'bakin_assets' },
        { name: 'bakin_projects' },
        { name: 'beacon_legacy' }, // non-bakin, should be left alone
        { name: 'other_thing' },
      ]
      // state file absent → stored version 0
      const result = await migrateIfNeeded()
      expect(result.migrated).toBe(true)
      expect(result.from).toBe(0)
      expect(result.to).toBe(SCHEMA_VERSION)
      expect(antflyState.dropped.sort()).toEqual([
        'bakin_assets',
        'bakin_projects',
        'bakin_tasks',
      ])
      // State file should now reflect the new version
      expect(readStoredVersion()).toBe(SCHEMA_VERSION)
    })

    it('continues migration even when one drop fails', async () => {
      antflyState.tables = [{ name: 'bakin_tasks' }, { name: 'bakin_assets' }]
      // Fail only on the first drop
      const { dropTable } = await import('../../src/core/antfly')
      let calls = 0
      vi.mocked(dropTable).mockImplementation(async (name: string) => {
        calls++
        if (calls === 1) throw new Error('simulated drop failure')
        antflyState.dropped.push(name)
      })

      const result = await migrateIfNeeded()
      expect(result.migrated).toBe(true)
      // Second drop still ran despite the first failing
      expect(antflyState.dropped).toContain('bakin_assets')
      // Version file still advances — the migration is best-effort
      expect(readStoredVersion()).toBe(SCHEMA_VERSION)
    })

    it('leaves state file unchanged when listTables throws', async () => {
      antflyState.listError = new Error('connection refused')
      const result = await migrateIfNeeded()
      expect(result.migrated).toBe(false)
      expect(result.from).toBe(0)
      expect(readStoredVersion()).toBe(0)
    })
  })
})
