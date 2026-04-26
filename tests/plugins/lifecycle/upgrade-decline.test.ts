/**
 * Upgrade-decline path coverage (commit C18 / review C1 fix verification).
 *
 * The original upgrade flow mutated the working tree BEFORE the consent
 * gate; declined consent left a half-upgraded plugin (working tree at the
 * new version, lockfile at the old). Spec §4.1 promised "Aborted
 * install/upgrade: lockfile not mutated, plugin dir not changed" — these
 * tests assert that promise holds for both github and local upgrades.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-upgrade-decline-${Date.now()}-${randomUUID()}`)
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
mock.module('@/lib/plugin-registry', () => ({
  isCorePlugin: () => false,
}))
mock.module(
  '../../../packages/host/src/plugin-host/user-plugin-builder',
  () => ({ buildUserPlugin: async () => {} }),
)

import {
  createBareRepo,
  fixturePluginFiles,
  gitAvailable,
  pushCommit,
} from '../../fixtures/plugins/hermetic-git'
import {
  type PluginLockEntry,
  addPlugin,
  readPluginLockfile,
  writePluginLockfile,
} from '../../../packages/core/src/plugins/lockfile'
import { upgradePlugin } from '../../../src/core/plugins/upgrade'

const HAS_GIT = gitAvailable()

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

function cloneRepoIntoPluginsDir(opts: { pluginId: string; cloneUrl: string }): void {
  const pluginsDir = join(testDir, 'plugins')
  mkdirSync(pluginsDir, { recursive: true })
  const target = join(pluginsDir, opts.pluginId)
  execFileSync('git', ['clone', opts.cloneUrl, target], { stdio: ['pipe', 'pipe', 'pipe'] })
  execFileSync('git', ['config', 'user.email', 'test@bakin.local'], { cwd: target })
  execFileSync('git', ['config', 'user.name', 'Bakin Test'], { cwd: target })
}

function headSha(dir: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim()
}

function readManifestVersion(pluginDir: string): string {
  const m = JSON.parse(readFileSync(join(pluginDir, 'bakin-plugin.json'), 'utf-8')) as { version?: string }
  return m.version ?? '?'
}

describe('upgrade decline path — github', () => {
  if (!HAS_GIT) {
    it.skip('git not on PATH — skipping integration tests', () => {})
    return
  }

  it('declined widened-perms upgrade leaves working tree + lockfile unchanged', async () => {
    const repo = createBareRepo(testDir, 'decline-fixture',
      fixturePluginFiles({ id: 'declinep', version: '1.0.0', permissions: ['storage.read'] }))
    cloneRepoIntoPluginsDir({ pluginId: 'declinep', cloneUrl: repo.cloneUrl })
    const pluginDir = join(testDir, 'plugins', 'declinep')
    const installedSha = headSha(pluginDir)

    writePluginLockfile(addPlugin(readPluginLockfile(), 'declinep', {
      source: repo.cloneUrl,
      type: 'github',
      ref: 'main',
      commitSha: installedSha,
      installedAt: '2026-04-25T00:00:00Z',
      version: '1.0.0',
      permissions: ['storage.read'],
      manifestSha: 'fixture-sha',
    } as PluginLockEntry))

    // Push a commit that ADDS storage.write — widening triggers consent.
    pushCommit(repo.workingClonePath,
      fixturePluginFiles({ id: 'declinep', version: '1.1.0', permissions: ['storage.read', 'storage.write'] }),
      'add storage.write')

    // Snapshot the on-disk state BEFORE the upgrade attempt.
    const beforeManifestVersion = readManifestVersion(pluginDir)
    const beforeWorkingHead = headSha(pluginDir)
    const beforeLockfile = readPluginLockfile().plugins['declinep']

    // No --yes → consent required → returns awaitingConsent.
    const result = await upgradePlugin('declinep')
    expect(result.awaitingConsent).toBe(true)
    expect(result.newPermissions).toEqual(['storage.write'])

    // Working tree must NOT have been fast-forwarded yet.
    const afterWorkingHead = headSha(pluginDir)
    expect(afterWorkingHead).toBe(beforeWorkingHead)
    expect(readManifestVersion(pluginDir)).toBe(beforeManifestVersion)

    // Lockfile must NOT have been touched.
    const afterLockfile = readPluginLockfile().plugins['declinep']
    expect(afterLockfile).toEqual(beforeLockfile)
  })
})

describe('upgrade decline path — local', () => {
  it('declined widened-perms upgrade leaves plugin dir + lockfile unchanged', async () => {
    const sourcePath = join(testDir, 'src-decline')
    mkdirSync(sourcePath, { recursive: true })
    const fixture = fixturePluginFiles({ id: 'declinel', version: '1.0.0', permissions: ['storage.read'] })
    for (const [name, content] of Object.entries(fixture)) {
      const fs = require('fs')
      fs.writeFileSync(join(sourcePath, name), content, 'utf-8')
    }

    // Pretend the plugin was previously installed.
    const pluginDir = join(testDir, 'plugins', 'declinel')
    mkdirSync(pluginDir, { recursive: true })
    for (const [name, content] of Object.entries(fixture)) {
      const fs = require('fs')
      fs.writeFileSync(join(pluginDir, name), content, 'utf-8')
    }
    writePluginLockfile(addPlugin(readPluginLockfile(), 'declinel', {
      source: sourcePath,
      type: 'local',
      ref: '',
      commitSha: '',
      installedAt: '2026-04-25T00:00:00Z',
      version: '1.0.0',
      permissions: ['storage.read'],
      manifestSha: 'fixture-sha',
      sourceTreeSha: 'old-tree-sha',
    } as PluginLockEntry))

    // Mutate the source: bump version + widen permissions.
    const fs = require('fs')
    const widerFixture = fixturePluginFiles({ id: 'declinel', version: '1.1.0', permissions: ['storage.read', 'events.emit'] })
    for (const [name, content] of Object.entries(widerFixture)) {
      fs.writeFileSync(join(sourcePath, name), content, 'utf-8')
    }

    const beforePluginDirVersion = readManifestVersion(pluginDir)
    const beforeLockfile = readPluginLockfile().plugins['declinel']

    const result = await upgradePlugin('declinel')
    expect(result.awaitingConsent).toBe(true)
    expect(result.newPermissions).toEqual(['events.emit'])

    // Plugin dir must NOT have been wiped + recopied.
    expect(readManifestVersion(pluginDir)).toBe(beforePluginDirVersion)

    // Lockfile must NOT have been touched.
    expect(readPluginLockfile().plugins['declinel']).toEqual(beforeLockfile)
  })
})
