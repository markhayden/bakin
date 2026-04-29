/**
 * Smoke tests for the remove flow's full teardown sweep (commit C7).
 *
 * Coverage at this commit:
 *   - planPluginAssetsRemoval partitions skills by .installedBy and .userEdited
 *   - removePluginAssets actually removes the to-remove runtime skills
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
import type { AgentRuntimeAdapter, RuntimeSkill } from '@bakin/core/adapters/runtime'

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
  planPluginAssetsRemoval,
  removePluginAssets,
} from '../../../src/core/onboarding/plugin-assets'
import { snapshotUninstall } from '../../../src/core/plugins/uninstall-snapshot'

type TestGlobal = typeof globalThis & {
  __bakinAppServices?: { runtime: AgentRuntimeAdapter }
}

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(join(testDir, 'openclaw', 'skills'), { recursive: true })
  installRuntimeMock()
})

function writeSkill(name: string, opts: { ownedBy: string; userEdited?: boolean; content?: string }): string {
  const dir = join(testDir, 'openclaw', 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), opts.content ?? `# ${name}\n`, 'utf-8')
  writeFileSync(join(dir, '.installedBy'), JSON.stringify({ pluginId: opts.ownedBy, sha256: 'abc' }), 'utf-8')
  if (opts.userEdited) writeFileSync(join(dir, '.userEdited'), '', 'utf-8')
  return dir
}

function readMarker(skillDir: string): unknown {
  try {
    return JSON.parse(readFileSync(join(skillDir, '.installedBy'), 'utf-8'))
  } catch {
    return null
  }
}

function installRuntimeMock(): void {
  const skillRoot = join(testDir, 'openclaw', 'skills')
  const skillDir = (name: string) => join(skillRoot, name)
  const runtime = {
    skills: {
      list: async () => [],
      get: async (name: string): Promise<RuntimeSkill | null> => {
        const dir = skillDir(name)
        const skillPath = join(dir, 'SKILL.md')
        if (!existsSync(skillPath)) return null
        return {
          name,
          path: skillPath,
          instructions: readFileSync(skillPath, 'utf-8'),
          files: { 'SKILL.md': readFileSync(skillPath, 'utf-8') },
          metadata: {
            installedBy: readMarker(dir),
            userEdited: existsSync(join(dir, '.userEdited')),
          },
        }
      },
      write: async () => {},
      remove: async (name: string) => {
        rmSync(skillDir(name), { recursive: true, force: true })
      },
    },
  } as unknown as AgentRuntimeAdapter
  ;(globalThis as TestGlobal).__bakinAppServices = { runtime }
}

describe('planPluginAssetsRemoval', () => {
  it('partitions skills by lockfile allowlist + .userEdited', async () => {
    writeSkill('a1', { ownedBy: 'plugin-a' })
    writeSkill('a2', { ownedBy: 'plugin-a', userEdited: true })
    writeSkill('b1', { ownedBy: 'plugin-b' })

    // Lockfile says plugin-a installed [a1, a2]. plugin-b is not in scope.
    const plan = await planPluginAssetsRemoval('plugin-a', ['a1', 'a2'])
    expect(plan.toRemove).toEqual(['a1'])
    expect(plan.toKeep).toEqual(['a2'])
    expect(plan.missingFromDisk).toEqual([])
    expect(plan.snapshots.map((snapshot) => snapshot.name)).toEqual(['a1'])
  })

  it('returns empty plan when no skills match the plugin', async () => {
    writeSkill('foo', { ownedBy: 'plugin-x' })
    await expect(planPluginAssetsRemoval('plugin-y', [])).resolves.toEqual({
      toRemove: [],
      toKeep: [],
      missingFromDisk: [],
      snapshots: [],
    })
  })

  it('refuses to delete a skill the lockfile did NOT record (defeats fake .installedBy)', async () => {
    // A malicious plugin wrote {pluginId: 'evil'} into a victim's
    // .installedBy at runtime. The lockfile entry for 'evil' did not
    // record ownership of 'victim' — so the plan must not delete it.
    const victimDir = writeSkill('victim', { ownedBy: 'evil' })
    const plan = await planPluginAssetsRemoval('evil', [])
    expect(plan.toRemove).toEqual([])
    expect(plan.toKeep).toEqual([])
    // 'victim' isn't in the allowlist so it doesn't appear in
    // missingFromDisk either — that field tracks lockfile claims, not
    // on-disk state.
    expect(existsSync(victimDir)).toBe(true)
  })

  it('reports lockfile-claimed skills missing from disk', async () => {
    const plan = await planPluginAssetsRemoval('plugin-z', ['ghost1', 'ghost2'])
    expect(plan.toRemove).toEqual([])
    expect(plan.toKeep).toEqual([])
    expect(plan.missingFromDisk.sort()).toEqual(['ghost1', 'ghost2'])
  })
})

describe('removePluginAssets', () => {
  it('removes only owned-and-not-user-edited skills, returns counts', async () => {
    const a1 = writeSkill('a1', { ownedBy: 'plugin-a' })
    const a2 = writeSkill('a2', { ownedBy: 'plugin-a', userEdited: true })

    const result = await removePluginAssets('plugin-a', ['a1', 'a2'])
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
