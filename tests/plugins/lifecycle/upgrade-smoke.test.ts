/**
 * Smoke tests for upgradePlugin (commit C4).
 *
 * Coverage at this commit is intentionally narrow — local-path no-op
 * detection + happy path + missing-source error. Full integration
 * (hermetic git, force-push detection, widened-permissions prompt) lands
 * with C10's `upgrade-flow.integration.test.ts`.
 */
import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { installFilesystemRuntimeAppServices } from '../../helpers/runtime-app-services'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

const testDir = join(tmpdir(), `bakin-test-upgrade-smoke-${Date.now()}-${randomUUID()}`)
const openClawDir = join(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = openClawDir

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
import { installPluginAssets } from '../../../src/core/onboarding/plugin-assets'
import { resetSettingsCache } from '../../../src/core/settings'
import { computeSourceTreeSha, upgradePlugin, UpgradeRefusedError } from '../../../src/core/plugins/upgrade'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  installFilesystemRuntimeAppServices({ openClawDir })
  resetSettingsCache()
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

function writeRuntimeSkill(pluginRoot: string, name: string, body: string): void {
  const skillDir = join(pluginRoot, 'defaults', 'runtime-skills', name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), body, 'utf-8')
}

function readInstalledSkill(name: string): string {
  return readFileSync(join(openClawDir, 'skills', name, 'SKILL.md'), 'utf-8')
}

const SKILL_V1 = `---
name: upgrade-helper
description: Upgrade helper v1
---

Use the original helper.
`

const SKILL_V2 = `---
name: upgrade-helper
description: Upgrade helper v2
---

Use the upgraded helper.
`

const FRESH_SKILL = `---
name: fresh-helper
description: Fresh helper
---

Use the newly shipped helper.
`

type TestGlobal = typeof globalThis & {
  __bakinAppServices?: { runtime: AgentRuntimeAdapter }
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

function writeSettings(settings: Record<string, unknown>): void {
  writeFileSync(join(testDir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8')
  resetSettingsCache()
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

  it('rejects unsigned local plugin upgrades when signatures are required', async () => {
    const sourcePath = join(testDir, 'src-unsigned')
    const pluginDir = join(testDir, 'plugins', 'unsigned-plugin')
    writeFixturePlugin(sourcePath, { id: 'unsigned-plugin', version: '1.0.0' })
    writeFixturePlugin(pluginDir, { id: 'unsigned-plugin', version: '1.0.0' })
    const initialSha = computeSourceTreeSha(sourcePath)
    writePluginLockfile(addPlugin(readPluginLockfile(), 'unsigned-plugin', localEntry({
      id: 'unsigned-plugin',
      sourcePath,
      version: '1.0.0',
      sourceTreeSha: initialSha,
    })))

    writeFixturePlugin(sourcePath, { id: 'unsigned-plugin', version: '1.1.0' })
    writeSettings({
      plugins: {
        requireSignatures: true,
        trustedSigners: [],
      },
    })

    await expect(upgradePlugin('unsigned-plugin')).rejects.toThrow(/signed plugin manifest/)
    expect(readPluginLockfile().plugins['unsigned-plugin']?.version).toBe('1.0.0')
    expect(existsSync(join(pluginDir, 'bakin-plugin.json'))).toBe(true)
  })

  it('installs changed and new runtime skills from the upgraded local plugin', async () => {
    const sourcePath = join(testDir, 'src-assets')
    const pluginDir = join(testDir, 'plugins', 'asset-plugin')
    writeFixturePlugin(sourcePath, { id: 'asset-plugin', version: '1.0.0' })
    writeRuntimeSkill(sourcePath, 'upgrade-helper', SKILL_V1)
    writeFixturePlugin(pluginDir, { id: 'asset-plugin', version: '1.0.0' })
    writeRuntimeSkill(pluginDir, 'upgrade-helper', SKILL_V1)

    const initialSha = computeSourceTreeSha(sourcePath)
    writePluginLockfile(addPlugin(readPluginLockfile(), 'asset-plugin', localEntry({
      id: 'asset-plugin',
      sourcePath,
      version: '1.0.0',
      sourceTreeSha: initialSha,
    })))
    await installPluginAssets([{ id: 'asset-plugin', path: pluginDir }])

    writeFixturePlugin(sourcePath, { id: 'asset-plugin', version: '1.1.0' })
    writeRuntimeSkill(sourcePath, 'upgrade-helper', SKILL_V2)
    writeRuntimeSkill(sourcePath, 'fresh-helper', FRESH_SKILL)

    const result = await upgradePlugin('asset-plugin')

    expect(result.noop).toBe(false)
    expect(readInstalledSkill('upgrade-helper')).toBe(SKILL_V2)
    expect(readInstalledSkill('fresh-helper')).toBe(FRESH_SKILL)
    expect(result.pluginAssets?.installed.map((s) => s.name).sort()).toEqual(['fresh-helper', 'upgrade-helper'])
    expect(result.pluginAssets?.skipped).toEqual([])
    expect(readPluginLockfile().plugins['asset-plugin']?.installedSkills?.sort()).toEqual([
      'fresh-helper',
      'upgrade-helper',
    ])
  })

  it('reports and preserves user-edited runtime skills during local plugin upgrade', async () => {
    const sourcePath = join(testDir, 'src-user-edited')
    const pluginDir = join(testDir, 'plugins', 'locked-plugin')
    writeFixturePlugin(sourcePath, { id: 'locked-plugin', version: '1.0.0' })
    writeRuntimeSkill(sourcePath, 'upgrade-helper', SKILL_V1)
    writeFixturePlugin(pluginDir, { id: 'locked-plugin', version: '1.0.0' })
    writeRuntimeSkill(pluginDir, 'upgrade-helper', SKILL_V1)

    const initialSha = computeSourceTreeSha(sourcePath)
    writePluginLockfile(addPlugin(readPluginLockfile(), 'locked-plugin', localEntry({
      id: 'locked-plugin',
      sourcePath,
      version: '1.0.0',
      sourceTreeSha: initialSha,
    })))
    await installPluginAssets([{ id: 'locked-plugin', path: pluginDir }])
    writeFileSync(join(openClawDir, 'skills', 'upgrade-helper', '.userEdited'), '', 'utf-8')

    writeFixturePlugin(sourcePath, { id: 'locked-plugin', version: '1.1.0' })
    writeRuntimeSkill(sourcePath, 'upgrade-helper', SKILL_V2)

    const result = await upgradePlugin('locked-plugin')

    expect(result.noop).toBe(false)
    expect(readInstalledSkill('upgrade-helper')).toBe(SKILL_V1)
    expect(result.pluginAssets?.installed).toEqual([])
    expect(result.pluginAssets?.skipped).toEqual([
      { pluginId: 'locked-plugin', name: 'upgrade-helper', reason: 'userEdited' },
    ])
  })

  it('fails loud and leaves lockfile upgrade markers unchanged when runtime skill install fails', async () => {
    const sourcePath = join(testDir, 'src-install-fails')
    const pluginDir = join(testDir, 'plugins', 'fail-assets')
    writeFixturePlugin(sourcePath, { id: 'fail-assets', version: '1.0.0' })
    writeFixturePlugin(pluginDir, { id: 'fail-assets', version: '1.0.0' })

    const initialSha = computeSourceTreeSha(sourcePath)
    writePluginLockfile(addPlugin(readPluginLockfile(), 'fail-assets', localEntry({
      id: 'fail-assets',
      sourcePath,
      version: '1.0.0',
      sourceTreeSha: initialSha,
    })))

    writeFixturePlugin(sourcePath, { id: 'fail-assets', version: '1.1.0' })
    writeRuntimeSkill(sourcePath, 'upgrade-helper', SKILL_V2)

    const services = (globalThis as TestGlobal).__bakinAppServices
    if (!services) throw new Error('test app services not installed')
    services.runtime.skills.write = async () => {
      throw new Error('runtime store unavailable')
    }

    await expect(upgradePlugin('fail-assets')).rejects.toThrow(/runtime store unavailable/)

    const lockEntry = readPluginLockfile().plugins['fail-assets']
    expect(lockEntry?.version).toBe('1.0.0')
    expect(lockEntry?.sourceTreeSha).toBe(initialSha)
    expect(lockEntry?.upgradedAt).toBeUndefined()
  })

  it('errors when no lockfile entry exists for the id', async () => {
    await expect(upgradePlugin('never-installed')).rejects.toThrow(UpgradeRefusedError)
  })
})
