/**
 * Smoke tests for the plugin lockfile (commit C1).
 *
 * Coverage at this commit is intentionally narrow — round-trip + one mutator
 * chain. Full coverage (Zod accept/reject, atomic IO failure paths, all
 * mutator edge cases) lands with C10's `lockfile.test.ts`.
 *
 * Per CLAUDE.md: BAKIN_HOME / OPENCLAW_HOME set BEFORE imports; both
 * content-dir paths and openclaw-home are mocked; testDir cleaned in afterAll.
 */
import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-plugin-lockfile-smoke-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

import {
  type PluginLockEntry,
  type PluginLockfile,
  addPlugin,
  getPluginLockfilePath,
  readPluginLockfile,
  removePlugin,
  updatePlugin,
  writePluginLockfile,
} from '../../../packages/core/src/plugins/lockfile'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  // Each test gets a fresh ~/.bakin/plugins/ — clears any prior lockfile.
  const lockfileDir = join(testDir, 'plugins')
  if (existsSync(lockfileDir)) rmSync(lockfileDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

const NOW = '2026-04-25T12:00:00Z'

function sampleEntry(overrides: Partial<PluginLockEntry> = {}): PluginLockEntry {
  return {
    source: 'github:madeinwyo/sample-plugin',
    type: 'github',
    ref: 'main',
    commitSha: '0123456789abcdef0123456789abcdef01234567',
    installedAt: NOW,
    version: '1.0.0',
    permissions: ['storage.read'],
    manifestSha: 'deadbeefcafe',
    ...overrides,
  }
}

describe('getPluginLockfilePath', () => {
  it('resolves under the content-dir at plugins/lock.json', () => {
    expect(getPluginLockfilePath()).toBe(join(testDir, 'plugins', 'lock.json'))
  })
})

describe('round-trip', () => {
  it('writes and reads back a single-entry lockfile', () => {
    const entry = sampleEntry()
    const initial: PluginLockfile = { version: 1, plugins: {} }
    const updated = addPlugin(initial, 'foo', entry)

    writePluginLockfile(updated)
    const round = readPluginLockfile()

    expect(round).toEqual({ version: 1, plugins: { foo: entry } })
  })

  it('returns an empty lockfile when the file does not exist', () => {
    expect(readPluginLockfile()).toEqual({ version: 1, plugins: {} })
  })
})

describe('mutator chain', () => {
  it('add → add → update → remove → write → read leaves the expected one entry', () => {
    let lock: PluginLockfile = { version: 1, plugins: {} }
    lock = addPlugin(lock, 'first', sampleEntry({ source: 'github:owner/first' }))
    lock = addPlugin(lock, 'second', sampleEntry({ source: 'github:owner/second' }))
    lock = updatePlugin(lock, 'second', { version: '1.1.0', upgradedAt: NOW })
    lock = removePlugin(lock, 'first')

    writePluginLockfile(lock)
    const round = readPluginLockfile()

    expect(Object.keys(round.plugins)).toEqual(['second'])
    expect(round.plugins.second?.version).toBe('1.1.0')
    expect(round.plugins.second?.upgradedAt).toBe(NOW)
    expect(round.plugins.second?.source).toBe('github:owner/second')
  })

  it('removePlugin is idempotent — removing a missing id is a no-op', () => {
    const lock: PluginLockfile = { version: 1, plugins: {} }
    expect(removePlugin(lock, 'missing')).toEqual(lock)
  })

  it('updatePlugin throws when id is absent', () => {
    const lock: PluginLockfile = { version: 1, plugins: {} }
    expect(() => updatePlugin(lock, 'missing', { version: '2.0.0' })).toThrow(
      /not present/,
    )
  })
})
