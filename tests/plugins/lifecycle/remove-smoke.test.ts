/**
 * Smoke tests for the remove flow's full teardown sweep (commit C7).
 *
 * Coverage at this commit:
 *   - planPluginAssetsRemoval partitions skills by .installedBy and .userEdited
 *   - removePluginAssets actually removes the to-remove dirs
 *   - snapshotUninstall produces a tarball at the expected path
 *
 * Full integration (the actual /api/plugins/remove handler exercising the
 * whole sweep) lands with C10's `remove-flow.integration.test.ts`.
 */
import { describe, it, expect, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-remove-smoke-${Date.now()}-${randomUUID()}`)
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
  planPluginAssetsRemoval,
  removePluginAssets,
} from '../../../src/core/onboarding/plugin-assets'
import { snapshotUninstall } from '../../../src/core/plugins/uninstall-snapshot'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(join(testDir, 'openclaw', 'skills'), { recursive: true })
})

function writeSkill(name: string, opts: { ownedBy: string; userEdited?: boolean; content?: string }): string {
  const dir = join(testDir, 'openclaw', 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), opts.content ?? `# ${name}\n`, 'utf-8')
  writeFileSync(join(dir, '.installedBy'), JSON.stringify({ pluginId: opts.ownedBy, sha256: 'abc' }), 'utf-8')
  if (opts.userEdited) writeFileSync(join(dir, '.userEdited'), '', 'utf-8')
  return dir
}

describe('planPluginAssetsRemoval', () => {
  it('partitions skill dirs by installedBy.pluginId and .userEdited', () => {
    const a1 = writeSkill('a1', { ownedBy: 'plugin-a' })
    const a2 = writeSkill('a2', { ownedBy: 'plugin-a', userEdited: true })
    writeSkill('b1', { ownedBy: 'plugin-b' })

    const plan = planPluginAssetsRemoval('plugin-a')
    expect(plan.toRemove.sort()).toEqual([a1].sort())
    expect(plan.toKeep).toEqual([a2])
  })

  it('returns empty plan when no skills match the plugin', () => {
    writeSkill('foo', { ownedBy: 'plugin-x' })
    expect(planPluginAssetsRemoval('plugin-y')).toEqual({ toRemove: [], toKeep: [] })
  })
})

describe('removePluginAssets', () => {
  it('removes only owned-and-not-user-edited skills, returns counts', async () => {
    const a1 = writeSkill('a1', { ownedBy: 'plugin-a' })
    const a2 = writeSkill('a2', { ownedBy: 'plugin-a', userEdited: true })

    const result = await removePluginAssets('plugin-a')
    expect(result.removed).toBe(1)
    expect(result.kept).toBe(1)
    expect(existsSync(a1)).toBe(false)
    expect(existsSync(a2)).toBe(true)
  })
})

describe('snapshotUninstall', () => {
  it('writes a tarball at ~/.bakin/.uninstalled/<id>-<ts>.tar.gz', async () => {
    // Build minimal plugin dir + settings + skill so the snapshot has content.
    const pluginDir = join(testDir, 'plugins', 'sample')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(join(pluginDir, 'bakin-plugin.json'), JSON.stringify({ id: 'sample', version: '1.0.0' }), 'utf-8')

    const settingsFile = join(testDir, 'plugin-settings', 'sample.json')
    mkdirSync(join(testDir, 'plugin-settings'), { recursive: true })
    writeFileSync(settingsFile, JSON.stringify({ key: 'value' }), 'utf-8')

    const skillDir = writeSkill('snapshot-skill', { ownedBy: 'sample' })

    const result = await snapshotUninstall({
      pluginId: 'sample',
      pluginDir,
      settingsFile,
      removedSkillDirs: [skillDir],
    })

    expect(result.tarballPath.startsWith(join(testDir, '.uninstalled'))).toBe(true)
    expect(result.tarballPath.endsWith('.tar.gz')).toBe(true)
    expect(existsSync(result.tarballPath)).toBe(true)
    // Sanity: the tarball is non-empty.
    expect(statSync(result.tarballPath).size).toBeGreaterThan(0)
    // capturedPaths should match what we asked it to capture (filtered to existing).
    expect(result.capturedPaths.length).toBe(3)
  })

  it('writes an empty tarball when nothing exists to capture', async () => {
    const result = await snapshotUninstall({
      pluginId: 'absent',
      pluginDir: join(testDir, 'plugins', 'absent'),
      settingsFile: undefined,
      removedSkillDirs: [],
    })
    expect(existsSync(result.tarballPath)).toBe(true)
    expect(result.capturedPaths.length).toBe(0)
  })
})
