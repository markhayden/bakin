import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { installFilesystemRuntimeAppServices } from '../../helpers/runtime-app-services'
import type { PluginLockEntry } from '../../../packages/core/src/plugins/lockfile'

const testDir = join(tmpdir(), `bakin-test-uninstall-snapshot-${Date.now()}-${randomUUID()}`)
const openClawDir = join(testDir, 'openclaw')

process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = openClawDir

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))

import {
  listUninstallSnapshots,
  pruneUninstallSnapshots,
  restoreUninstallSnapshot,
  snapshotUninstall,
} from '../../../src/core/plugins/uninstall-snapshot'
import {
  addPlugin,
  readPluginLockfile,
  removePlugin,
  writePluginLockfile,
} from '../../../packages/core/src/plugins/lockfile'

const pluginEntry: PluginLockEntry = {
  source: 'github:madeinwyo/example-plugin',
  type: 'github',
  ref: 'main',
  commitSha: '0123456789abcdef0123456789abcdef01234567',
  installedAt: '2026-05-03T00:00:00.000Z',
  version: '1.2.3',
  permissions: [],
  manifestSha: 'fixture-manifest-sha',
  installedSkills: ['demo-skill'],
}

function writeSnapshotFile(pluginId: string, safeTimestamp: string): string {
  const dir = join(testDir, '.uninstalled')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${pluginId}-${safeTimestamp}.tar.gz`)
  writeFileSync(path, 'fixture', 'utf-8')
  return path
}

function seedInstalledPlugin(pluginId = 'demo-plugin'): { pluginDir: string; settingsFile: string } {
  const pluginDir = join(testDir, 'plugins', pluginId)
  const settingsFile = join(testDir, 'plugin-settings', `${pluginId}.json`)
  mkdirSync(pluginDir, { recursive: true })
  mkdirSync(join(pluginDir, 'defaults', 'runtime-skills', 'demo-skill'), { recursive: true })
  mkdirSync(join(testDir, 'plugin-settings'), { recursive: true })
  writeFileSync(join(pluginDir, 'bakin-plugin.json'), JSON.stringify({
    id: pluginId,
    name: 'Demo Plugin',
    version: '1.2.3',
    permissions: [],
  }, null, 2), 'utf-8')
  writeFileSync(join(pluginDir, 'defaults', 'runtime-skills', 'demo-skill', 'SKILL.md'), '# Demo skill\n', 'utf-8')
  writeFileSync(settingsFile, JSON.stringify({ enabled: true }, null, 2), 'utf-8')
  writePluginLockfile(addPlugin(readPluginLockfile(), pluginId, pluginEntry))
  return { pluginDir, settingsFile }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  installFilesystemRuntimeAppServices({ openClawDir })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('uninstall snapshot registry', () => {
  it('lists valid uninstall snapshots newest first', () => {
    writeSnapshotFile('demo-plugin', '2026-05-03T18-00-00-000Z')
    writeSnapshotFile('demo-plugin', '2026-05-04T18-00-00-000Z')
    writeSnapshotFile('other-plugin', '2026-05-04T19-00-00-000Z')
    writeFileSync(join(testDir, '.uninstalled', 'not-a-snapshot.txt'), 'ignore', 'utf-8')

    const snapshots = listUninstallSnapshots('demo-plugin')

    expect(snapshots.map(s => s.filename)).toEqual([
      'demo-plugin-2026-05-04T18-00-00-000Z.tar.gz',
      'demo-plugin-2026-05-03T18-00-00-000Z.tar.gz',
    ])
    expect(snapshots[0].createdAt).toBe('2026-05-04T18:00:00.000Z')
  })

  it('prunes only snapshots outside both retention windows', () => {
    const old1 = writeSnapshotFile('demo-plugin', '2026-01-01T00-00-00-000Z')
    const old2 = writeSnapshotFile('demo-plugin', '2026-01-02T00-00-00-000Z')
    const old3 = writeSnapshotFile('demo-plugin', '2026-01-03T00-00-00-000Z')
    const recent = writeSnapshotFile('demo-plugin', '2026-05-01T00-00-00-000Z')
    const onlyOther = writeSnapshotFile('other-plugin', '2026-01-01T00-00-00-000Z')

    const report = pruneUninstallSnapshots({
      keepPerPlugin: 2,
      maxAgeDays: 30,
      now: new Date('2026-05-04T00:00:00.000Z'),
    })

    expect(report.removed.map(s => s.path).sort()).toEqual([old1, old2].sort())
    expect(existsSync(old1)).toBe(false)
    expect(existsSync(old2)).toBe(false)
    expect(existsSync(old3)).toBe(true)
    expect(existsSync(recent)).toBe(true)
    expect(existsSync(onlyOther)).toBe(true)
  })
})

describe('restoreUninstallSnapshot', () => {
  it('refuses to restore over an existing plugin dir', async () => {
    const { pluginDir, settingsFile } = seedInstalledPlugin()
    await snapshotUninstall({
      pluginId: 'demo-plugin',
      pluginDir,
      settingsFile,
      lockEntry: pluginEntry,
      removedSkills: [{ name: 'demo-skill', files: { 'SKILL.md': '# Demo skill\n' } }],
    })

    await expect(restoreUninstallSnapshot({ pluginId: 'demo-plugin' }))
      .rejects
      .toThrow(/already exists/i)
  })

  it('restores plugin files, settings, runtime skills, and lockfile provenance', async () => {
    const { pluginDir, settingsFile } = seedInstalledPlugin()
    const snapshot = await snapshotUninstall({
      pluginId: 'demo-plugin',
      pluginDir,
      settingsFile,
      lockEntry: pluginEntry,
      removedSkills: [{ name: 'demo-skill', files: { 'SKILL.md': '# Demo skill\n' } }],
    })

    rmSync(pluginDir, { recursive: true, force: true })
    rmSync(settingsFile, { force: true })
    writePluginLockfile(removePlugin(readPluginLockfile(), 'demo-plugin'))

    const restored = await restoreUninstallSnapshot({ pluginId: 'demo-plugin' })

    expect(restored.snapshot.path).toBe(snapshot.tarballPath)
    expect(existsSync(join(testDir, 'plugins', 'demo-plugin', 'bakin-plugin.json'))).toBe(true)
    expect(existsSync(join(testDir, 'plugin-settings', 'demo-plugin.json'))).toBe(true)
    expect(readPluginLockfile().plugins['demo-plugin']?.source).toBe('github:madeinwyo/example-plugin')
    expect(readPluginLockfile().plugins['demo-plugin']?.commitSha).toBe(pluginEntry.commitSha)

    const runtime = (await import('@/core/app-services')).getAppServices().runtime
    const skill = await runtime.skills.get('demo-skill')
    expect(skill?.instructions).toBe('# Demo skill\n')
    expect(skill?.metadata?.installedBy).toEqual({
      pluginId: 'demo-plugin',
      sha256: expect.any(String),
    })
  })
})
