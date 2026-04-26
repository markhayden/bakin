/**
 * Verifies the core-plugin guard fires across all enforcement points
 * (commit C10):
 *   - Lockfile mutators throw via setCorePluginCheck-registered predicate
 *   - The setter clears cleanly when handed null (test-isolation safety)
 *
 * The API endpoints (/api/plugins/{remove,upgrade}) call isCorePlugin
 * before any work — covered indirectly by the upgrade integration tests
 * (which mock isCorePlugin to false to exercise the happy path) and
 * directly by the manual smoke checklist before merge.
 */
import { describe, it, expect, afterAll, mock, afterEach } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-core-guard-${Date.now()}-${randomUUID()}`)
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
mock.module('@bakin/core/openclaw-home', () => ({
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
  addPlugin,
  removePlugin,
  setCorePluginCheck,
  updatePlugin,
} from '../../../packages/core/src/plugins/lockfile'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

afterEach(() => {
  // Reset the guard so cross-test interference doesn't leak.
  setCorePluginCheck(null)
})

const NOW = '2026-04-25T12:00:00Z'

function entry(): PluginLockEntry {
  return {
    source: 'github:owner/repo',
    type: 'github',
    ref: 'main',
    commitSha: '0123456789abcdef0123456789abcdef01234567',
    installedAt: NOW,
    version: '1.0.0',
    permissions: [],
    manifestSha: 'def',
  }
}

describe('lockfile mutators with core-plugin guard wired', () => {
  it('throws on addPlugin for a core id', () => {
    setCorePluginCheck(id => id === 'tasks')
    expect(() => addPlugin({ version: 1, plugins: {} }, 'tasks', entry())).toThrow(
      /refusing to mutate lockfile entry for core plugin: tasks/,
    )
  })

  it('throws on removePlugin for a core id', () => {
    // Build state with the guard off, then arm it before the operation
    // we're testing. (In production the guard is always on; this is just
    // how the test sets up the state under test.)
    setCorePluginCheck(null)
    const lock = addPlugin({ version: 1, plugins: {} }, 'schedule', entry())
    setCorePluginCheck(id => id === 'schedule')
    expect(() => removePlugin(lock, 'schedule')).toThrow(/refusing to mutate.*schedule/)
  })

  it('throws on updatePlugin for a core id', () => {
    setCorePluginCheck(null)
    const lock = addPlugin({ version: 1, plugins: {} }, 'workflows', entry())
    setCorePluginCheck(id => id === 'workflows')
    expect(() => updatePlugin(lock, 'workflows', { version: '2.0.0' })).toThrow(/refusing to mutate.*workflows/)
  })

  it('allows mutations on non-core ids when guard is set', () => {
    setCorePluginCheck(id => id === 'tasks')
    const lock = addPlugin({ version: 1, plugins: {} }, 'my-plugin', entry())
    expect(lock.plugins['my-plugin']).toBeTruthy()
  })

  it('allows mutations on any id when no guard is wired', () => {
    setCorePluginCheck(null)
    expect(() => addPlugin({ version: 1, plugins: {} }, 'tasks', entry())).not.toThrow()
  })
})
