/**
 * Smoke tests for upgradePlugin (commit C4).
 *
 * Coverage at this commit is intentionally narrow — local-path no-op
 * detection + happy path + missing-source error. Full integration
 * (hermetic git, force-push detection, widened-permissions prompt) lands
 * with C10's `upgrade-flow.integration.test.ts`.
 */
import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-upgrade-smoke-${Date.now()}-${randomUUID()}`)
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
// Skip the actual build step in smoke tests — the upgrade flow's contract
// isn't "did bun.build succeed", it's "did the lockfile + filesystem land in
// the expected state". Build is exercised end-to-end in C10.
mock.module(
  '../../../packages/host/src/plugin-host/user-plugin-builder',
  () => ({ buildUserPlugin: async () => {} }),
)
// Core-plugin guard isn't relevant to these smokes; explicitly nope.
mock.module('@/lib/plugin-registry', () => ({
  isCorePlugin: () => false,
}))

import {
  type PluginLockEntry,
  addPlugin,
  readPluginLockfile,
  writePluginLockfile,
} from '../../../packages/core/src/plugins/lockfile'
import { computeSourceTreeSha, upgradePlugin, UpgradeRefusedError } from '../../../src/core/plugins/upgrade'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

const NOW = '2026-04-25T12:00:00Z'

function writeFixturePlugin(rootDir: string, opts: { id: string; version: string }): void {
  mkdirSync(rootDir, { recursive: true })
  writeFileSync(
    join(rootDir, 'bakin-plugin.json'),
    JSON.stringify({ id: opts.id, name: opts.id, version: opts.version, permissions: [] }),
    'utf-8',
  )
  writeFileSync(join(rootDir, 'index.ts'), `export default { id: '${opts.id}', activate() {} }`, 'utf-8')
}

function localEntry(opts: { id: string; sourcePath: string; version: string; sourceTreeSha?: string }): PluginLockEntry {
  return {
    source: opts.sourcePath,
    type: 'local',
    ref: '',
    commitSha: '',
    installedAt: NOW,
    version: opts.version,
    permissions: [],
    manifestSha: 'abc',
    sourceTreeSha: opts.sourceTreeSha,
  }
}

describe('computeSourceTreeSha', () => {
  it('is stable across copies of the same content', () => {
    const a = join(testDir, 'a')
    const b = join(testDir, 'b')
    writeFixturePlugin(a, { id: 'sample', version: '1.0.0' })
    writeFixturePlugin(b, { id: 'sample', version: '1.0.0' })
    expect(computeSourceTreeSha(a)).toBe(computeSourceTreeSha(b))
  })

  it('changes when content changes', () => {
    const a = join(testDir, 'a')
    writeFixturePlugin(a, { id: 'sample', version: '1.0.0' })
    const before = computeSourceTreeSha(a)
    writeFileSync(join(a, 'extra.txt'), 'new content', 'utf-8')
    expect(computeSourceTreeSha(a)).not.toBe(before)
  })
})

describe('upgradePlugin (local)', () => {
  it('errors when the original source path no longer exists', async () => {
    const sourcePath = join(testDir, 'gone-source')
    const pluginDir = join(testDir, 'plugins', 'absent-source')
    writeFixturePlugin(pluginDir, { id: 'absent-source', version: '1.0.0' })
    writePluginLockfile(addPlugin(readPluginLockfile(), 'absent-source', localEntry({
      id: 'absent-source',
      sourcePath,
      version: '1.0.0',
    })))

    await expect(upgradePlugin('absent-source')).rejects.toThrow(UpgradeRefusedError)
  })

  it('short-circuits as no-op when source tree sha matches lockfile', async () => {
    const sourcePath = join(testDir, 'src-noop')
    const pluginDir = join(testDir, 'plugins', 'noop-plugin')
    writeFixturePlugin(sourcePath, { id: 'noop-plugin', version: '1.0.0' })
    writeFixturePlugin(pluginDir, { id: 'noop-plugin', version: '1.0.0' })
    const treeSha = computeSourceTreeSha(sourcePath)
    writePluginLockfile(addPlugin(readPluginLockfile(), 'noop-plugin', localEntry({
      id: 'noop-plugin',
      sourcePath,
      version: '1.0.0',
      sourceTreeSha: treeSha,
    })))

    const result = await upgradePlugin('noop-plugin')
    expect(result.noop).toBe(true)
    expect(result.before).toEqual(result.after)
  })

  it('re-syncs source dir, rebuilds, and updates lockfile when content changed', async () => {
    const sourcePath = join(testDir, 'src-change')
    const pluginDir = join(testDir, 'plugins', 'change-plugin')
    writeFixturePlugin(sourcePath, { id: 'change-plugin', version: '1.0.0' })
    writeFixturePlugin(pluginDir, { id: 'change-plugin', version: '1.0.0' })
    const initialSha = computeSourceTreeSha(sourcePath)
    writePluginLockfile(addPlugin(readPluginLockfile(), 'change-plugin', localEntry({
      id: 'change-plugin',
      sourcePath,
      version: '1.0.0',
      sourceTreeSha: initialSha,
    })))

    // Mutate the source — bump version + add a new file.
    writeFixturePlugin(sourcePath, { id: 'change-plugin', version: '1.1.0' })
    writeFileSync(join(sourcePath, 'extra.md'), '# new', 'utf-8')

    const result = await upgradePlugin('change-plugin')
    expect(result.noop).toBe(false)
    expect(result.before.version).toBe('1.0.0')
    expect(result.after.version).toBe('1.1.0')

    // Plugin dir got the new file.
    expect(existsSync(join(pluginDir, 'extra.md'))).toBe(true)

    // Lockfile updated with new tree sha + upgradedAt + version.
    const updated = readPluginLockfile().plugins['change-plugin']
    expect(updated?.version).toBe('1.1.0')
    expect(updated?.sourceTreeSha).not.toBe(initialSha)
    expect(updated?.upgradedAt).toBeTruthy()
  })

  it('errors when no lockfile entry exists for the id', async () => {
    await expect(upgradePlugin('never-installed')).rejects.toThrow(UpgradeRefusedError)
  })
})
