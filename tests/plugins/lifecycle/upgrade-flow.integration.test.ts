/**
 * Integration tests for the github upgrade flow against a hermetic local
 * bare git repo (commit C10).
 *
 * Skipped when `git` is not on PATH — emit a clear note instead of
 * pretending the path was tested.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-upgrade-integration-${Date.now()}-${randomUUID()}`)
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
  forcePushRewind,
  gitAvailable,
  pushCommit,
} from '../../fixtures/plugins/hermetic-git'
import {
  type PluginLockEntry,
  addPlugin,
  readPluginLockfile,
  writePluginLockfile,
} from '../../../packages/core/src/plugins/lockfile'
import {
  UpgradeRefusedError,
  upgradePlugin,
} from '../../../src/core/plugins/upgrade'

const HAS_GIT = gitAvailable()

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

function cloneRepoIntoPluginsDir(opts: {
  pluginId: string
  cloneUrl: string
}): void {
  const pluginsDir = join(testDir, 'plugins')
  mkdirSync(pluginsDir, { recursive: true })
  const target = join(pluginsDir, opts.pluginId)
  // Clone shallow into the plugin dir, mirroring what install.ts does.
  execFileSync('git', ['clone', opts.cloneUrl, target], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  // Configure committer identity for any future fetches in this clone.
  execFileSync('git', ['config', 'user.email', 'test@bakin.local'], { cwd: target })
  execFileSync('git', ['config', 'user.name', 'Bakin Test'], { cwd: target })
}

function makeLockEntry(opts: {
  cloneUrl: string
  ref: string
  commitSha: string
  version: string
}): PluginLockEntry {
  return {
    source: opts.cloneUrl,
    type: 'github',
    ref: opts.ref,
    commitSha: opts.commitSha,
    installedAt: new Date().toISOString(),
    version: opts.version,
    permissions: [],
    manifestSha: 'fixture-sha',
  }
}

function headSha(dir: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim()
}

describe('upgradePlugin — github (hermetic bare repo)', () => {
  if (!HAS_GIT) {
    it.skip('git not on PATH — skipping integration tests', () => {})
    return
  }

  beforeAll(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
  })

  it('detects no-op when remote sha matches lockfile commitSha', async () => {
    const repo = createBareRepo(testDir, 'noop-fixture', fixturePluginFiles({ id: 'noop', version: '1.0.0' }))
    cloneRepoIntoPluginsDir({ pluginId: 'noop', cloneUrl: repo.cloneUrl })
    const sha = headSha(join(testDir, 'plugins', 'noop'))
    writePluginLockfile(addPlugin(readPluginLockfile(), 'noop', makeLockEntry({
      cloneUrl: repo.cloneUrl,
      ref: 'main',
      commitSha: sha,
      version: '1.0.0',
    })))

    const result = await upgradePlugin('noop')
    expect(result.noop).toBe(true)
    expect(result.before).toEqual(result.after)
  })

  it('fast-forwards to a new remote commit and updates the lockfile', async () => {
    const repo = createBareRepo(testDir, 'ff-fixture', fixturePluginFiles({ id: 'ff', version: '1.0.0' }))
    cloneRepoIntoPluginsDir({ pluginId: 'ff', cloneUrl: repo.cloneUrl })
    const installedSha = headSha(join(testDir, 'plugins', 'ff'))
    writePluginLockfile(addPlugin(readPluginLockfile(), 'ff', makeLockEntry({
      cloneUrl: repo.cloneUrl,
      ref: 'main',
      commitSha: installedSha,
      version: '1.0.0',
    })))

    // Push a new commit upstream.
    const newSha = pushCommit(repo.workingClonePath, fixturePluginFiles({ id: 'ff', version: '1.1.0' }), 'bump version')

    const result = await upgradePlugin('ff')
    expect(result.noop).toBe(false)
    expect(result.before.version).toBe('1.0.0')
    expect(result.after.version).toBe('1.1.0')
    expect(result.after.commitSha).toBe(newSha)

    const updated = readPluginLockfile().plugins['ff']
    expect(updated?.version).toBe('1.1.0')
    expect(updated?.commitSha).toBe(newSha)
    expect(updated?.upgradedAt).toBeTruthy()
  })

  it('refuses to upgrade when remote history was rewritten (force-push)', async () => {
    const repo = createBareRepo(testDir, 'rewind-fixture', fixturePluginFiles({ id: 'rewind', version: '1.0.0' }))
    cloneRepoIntoPluginsDir({ pluginId: 'rewind', cloneUrl: repo.cloneUrl })
    const installedSha = headSha(join(testDir, 'plugins', 'rewind'))
    writePluginLockfile(addPlugin(readPluginLockfile(), 'rewind', makeLockEntry({
      cloneUrl: repo.cloneUrl,
      ref: 'main',
      commitSha: installedSha,
      version: '1.0.0',
    })))

    // Force-push divergent history.
    forcePushRewind(repo.workingClonePath, fixturePluginFiles({ id: 'rewind', version: '2.0.0' }), 'rewritten history')

    await expect(upgradePlugin('rewind')).rejects.toThrow(UpgradeRefusedError)
  })

  it('returns awaitingConsent when permissions widen on the upgrade target', async () => {
    const repo = createBareRepo(testDir, 'widen-fixture', fixturePluginFiles({ id: 'widen', version: '1.0.0', permissions: ['storage.read'] }))
    cloneRepoIntoPluginsDir({ pluginId: 'widen', cloneUrl: repo.cloneUrl })
    const installedSha = headSha(join(testDir, 'plugins', 'widen'))
    const lock = addPlugin(readPluginLockfile(), 'widen', {
      ...makeLockEntry({ cloneUrl: repo.cloneUrl, ref: 'main', commitSha: installedSha, version: '1.0.0' }),
      permissions: ['storage.read'],
    })
    writePluginLockfile(lock)

    pushCommit(repo.workingClonePath, fixturePluginFiles({ id: 'widen', version: '1.1.0', permissions: ['storage.read', 'events.emit'] }), 'add events.emit')

    const result = await upgradePlugin('widen')
    expect(result.awaitingConsent).toBe(true)
    expect(result.newPermissions).toEqual(['events.emit'])
    expect(result.noop).toBe(false)

    // Lockfile should NOT have been updated yet (consent gate held).
    const lockAfter = readPluginLockfile().plugins['widen']
    expect(lockAfter?.version).toBe('1.0.0')
    expect(lockAfter?.permissions).toEqual(['storage.read'])

    // Re-run with yes:true to commit the upgrade.
    const result2 = await upgradePlugin('widen', { yes: true })
    expect(result2.awaitingConsent).toBe(false)
    expect(result2.noop).toBe(false)
    const lockFinal = readPluginLockfile().plugins['widen']
    expect(lockFinal?.permissions.sort()).toEqual(['events.emit', 'storage.read'])
  })

  it('errors when no lockfile entry exists', async () => {
    await expect(upgradePlugin('never-installed')).rejects.toThrow(UpgradeRefusedError)
  })

  it('refuses upgrade when the new manifest declares a different id (anti-impersonation)', async () => {
    const repo = createBareRepo(testDir, 'rename-fixture',
      fixturePluginFiles({ id: 'rename', version: '1.0.0' }))
    cloneRepoIntoPluginsDir({ pluginId: 'rename', cloneUrl: repo.cloneUrl })
    const installedSha = headSha(join(testDir, 'plugins', 'rename'))
    writePluginLockfile(addPlugin(readPluginLockfile(), 'rename', makeLockEntry({
      cloneUrl: repo.cloneUrl,
      ref: 'main',
      commitSha: installedSha,
      version: '1.0.0',
    })))

    // Push a commit that swaps the manifest id to "tasks" — exactly the
    // core-plugin impersonation attack the C20 stability check defends.
    pushCommit(repo.workingClonePath,
      fixturePluginFiles({ id: 'tasks', version: '1.1.0' }), 'masquerade as core')

    await expect(upgradePlugin('rename', { yes: true })).rejects.toThrow(UpgradeRefusedError)

    // Lockfile entry must be untouched after the refused upgrade.
    const after = readPluginLockfile().plugins['rename']
    expect(after?.version).toBe('1.0.0')
    expect(after?.commitSha).toBe(installedSha)
  })

  it('resets origin URL from lockfile before fetch (defeats .git/config tampering)', async () => {
    // Two repos: A is the legitimate source, B is what a malicious plugin
    // would re-point its .git/config at to hijack the next upgrade.
    const repoA = createBareRepo(testDir, 'origin-pin-A',
      fixturePluginFiles({ id: 'pinme', version: '1.0.0' }))
    const repoB = createBareRepo(testDir, 'origin-pin-B',
      fixturePluginFiles({ id: 'pinme', version: '99.0.0' }))
    cloneRepoIntoPluginsDir({ pluginId: 'pinme', cloneUrl: repoA.cloneUrl })
    const pluginDir = join(testDir, 'plugins', 'pinme')

    writePluginLockfile(addPlugin(readPluginLockfile(), 'pinme', makeLockEntry({
      cloneUrl: repoA.cloneUrl,
      ref: 'main',
      commitSha: headSha(pluginDir),
      version: '1.0.0',
    })))

    // Tamper: rewrite the on-disk origin to point at repo B.
    execFileSync('git', ['remote', 'set-url', 'origin', repoB.cloneUrl], {
      cwd: pluginDir, stdio: ['pipe', 'pipe', 'pipe'],
    })
    expect(execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: pluginDir, encoding: 'utf-8',
    }).trim()).toBe(repoB.cloneUrl)

    // Push a fresh commit to repo A so there's something to upgrade to.
    pushCommit(repoA.workingClonePath,
      fixturePluginFiles({ id: 'pinme', version: '1.1.0' }), 'legitimate update')

    // Upgrade — must pull from repo A, not the tampered repo B.
    const result = await upgradePlugin('pinme', { yes: true })
    expect(result.after.version).toBe('1.1.0')

    // Origin should now be reset to the lockfile URL.
    const originAfter = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: pluginDir, encoding: 'utf-8',
    }).trim()
    expect(originAfter).toBe(repoA.cloneUrl)
  })
})
