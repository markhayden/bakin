import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { clearSearchAdapter, createSearchAdapterHarness, installSearchAdapter } from '../helpers/search-adapter'

const testDir = path.join(process.cwd(), 'test-content-search-migration')
const stateFile = path.join(testDir, '.search-state.json')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

let searchHarness: ReturnType<typeof createSearchAdapterHarness>

import {
  SCHEMA_VERSION,
  readStoredVersion,
  writeStoredVersion,
  migrateIfNeeded,
} from '../../src/core/search-migration'
import { resetContentDir } from '../../src/core/content-dir'

describe('search-migration', () => {
  beforeEach(() => {
    process.env.BAKIN_HOME = testDir
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true })
    fs.mkdirSync(testDir, { recursive: true })
    searchHarness = createSearchAdapterHarness()
    installSearchAdapter(searchHarness.adapter)
    // Reset the content-dir module cache so each test picks up the
    // per-test BAKIN_HOME env var.
    resetContentDir()
  })

  afterEach(() => {
    delete process.env.BAKIN_HOME
    clearSearchAdapter()
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
      expect(searchHarness.calls.tablesDrop).not.toHaveBeenCalled()
    })

    it('is a no-op when stored version is greater than code version', async () => {
      fs.writeFileSync(stateFile, JSON.stringify({ version: SCHEMA_VERSION + 5 }))
      const result = await migrateIfNeeded()
      expect(result.migrated).toBe(false)
      expect(searchHarness.calls.tablesDrop).not.toHaveBeenCalled()
    })

    it('is a no-op when Antfly is disabled', async () => {
      searchHarness.setAvailable(false)
      fs.writeFileSync(stateFile, JSON.stringify({ version: 0 }))
      const result = await migrateIfNeeded()
      expect(result.migrated).toBe(false)
      expect(searchHarness.calls.tablesDrop).not.toHaveBeenCalled()
    })

    it('drops all bakin_* tables and writes the new version on mismatch', async () => {
      searchHarness.setTables([
        'bakin_tasks',
        'bakin_assets',
        'bakin_projects',
        'external_legacy', // non-bakin, should be left alone
        'other_thing',
      ])
      // state file absent → stored version 0
      const result = await migrateIfNeeded()
      expect(result.migrated).toBe(true)
      expect(result.from).toBe(0)
      expect(result.to).toBe(SCHEMA_VERSION)
      expect(searchHarness.calls.tablesDrop.mock.calls.map(call => call[0]).sort()).toEqual([
        'bakin_assets',
        'bakin_projects',
        'bakin_tasks',
      ])
      // State file should now reflect the new version
      expect(readStoredVersion()).toBe(SCHEMA_VERSION)
    })

    it('continues migration even when one drop fails', async () => {
      searchHarness.setTables(['bakin_tasks', 'bakin_assets'])
      // Fail only on the first drop
      let calls = 0
      searchHarness.calls.tablesDrop.mockImplementation(async (name: string) => {
        calls++
        if (calls === 1) throw new Error('simulated drop failure')
      })

      const result = await migrateIfNeeded()
      expect(result.migrated).toBe(true)
      // Second drop still ran despite the first failing
      expect(searchHarness.calls.tablesDrop.mock.calls.map(call => call[0])).toContain('bakin_assets')
      // Version file still advances — the migration is best-effort
      expect(readStoredVersion()).toBe(SCHEMA_VERSION)
    })

    it('leaves state file unchanged when listTables throws', async () => {
      searchHarness.calls.tablesList.mockRejectedValueOnce(new Error('connection refused'))
      const result = await migrateIfNeeded()
      expect(result.migrated).toBe(false)
      expect(result.from).toBe(0)
      expect(readStoredVersion()).toBe(0)
    })
  })
})
