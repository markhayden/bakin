/**
 * Tests for the plugin-assets onboarding component.
 *
 * The component installs runtime skills (S-B in the spec) that
 * plugins ship at `defaults/runtime-skills/{name}/SKILL.md`. The
 * component is the only piece that touches the runtime skill store -
 * everything else stays in plugin source on disk.
 *
 * All filesystem ops are confined to a temp dir; the runtime adapter is
 * mocked so the component never touches the production runtime skill store.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import type { AgentRuntimeAdapter, RuntimeSkill } from '@bakin/core/adapters/runtime'

const testDir = join(tmpdir(), `bakin-test-plugin-assets-${Date.now()}`)
const runtimeSkillHome = join(testDir, 'runtime-skills-home')
const bakinHome = join(testDir, 'bakin')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => bakinHome,
  getBakinPaths: () => ({ workflows: join(bakinHome, 'workflows') }),
}))
// CLAUDE.md mock-both-paths rule — the lockfile module imports its own
// `getContentDir` from `@bakin/core/content-dir`, so without this mock
// `syncLockfileInstalledSkills` would trip the production-content-dir
// safety guard and silently abort.
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => bakinHome,
  getBakinPaths: () => ({ workflows: join(bakinHome, 'workflows') }),
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
// discoverPlugins() scans the live core-plugin set from bakin.config; the
// pluginAssetsComponent.check() test below asserts the empty/"nothing to do"
// branch, so isolate it from whatever runtime-skills core plugins ship.
mock.module('../../../bakin.config', () => ({ default: { plugins: [] } }))

import {
  scanPluginAssets,
  installPluginAssets,
  pluginAssetsComponent,
} from '@/core/onboarding/plugin-assets'

type TestGlobal = typeof globalThis & {
  __bakinAppServices?: { runtime: AgentRuntimeAdapter }
}

const SKILL_BODY = `---
name: cold-email
description: Draft a cold outreach email
---

## Instructions

Write a cold outreach email to a SaaS founder.
`

const SKILL_BODY_V2 = `---
name: cold-email
description: Draft a cold outreach email v2
---

## Instructions

Write a cold outreach email to a SaaS founder. Personalize harder.
`

function makePluginWithSkill(pluginId: string, skillName: string, body: string): string {
  const pluginDir = join(testDir, 'plugins', pluginId)
  const skillDir = join(pluginDir, 'defaults', 'runtime-skills', skillName)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), body)
  return pluginDir
}

function readSkillTree(root: string, prefix = ''): Record<string, string> {
  const files: Record<string, string> = {}
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const abs = join(root, rel)
    if (entry.isDirectory()) {
      Object.assign(files, readSkillTree(root, rel))
    } else if (entry.isFile()) {
      files[rel] = readFileSync(abs, 'utf-8')
    }
  }
  return files
}

function readMarker(skillDir: string): unknown {
  try {
    return JSON.parse(readFileSync(join(skillDir, '.installedBy'), 'utf-8'))
  } catch {
    return null
  }
}

function installRuntimeMock(): void {
  const skillRoot = join(runtimeSkillHome, 'skills')
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
          files: readSkillTree(dir),
          metadata: {
            installedBy: readMarker(dir),
            userEdited: existsSync(join(dir, '.userEdited')),
          },
        }
      },
      write: async (skill: RuntimeSkill) => {
        const dir = skillDir(skill.name)
        const files = skill.files ?? { 'SKILL.md': skill.instructions ?? '' }
        for (const [rel, content] of Object.entries(files)) {
          const target = join(dir, rel)
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, content, 'utf-8')
        }
        if (skill.metadata?.installedBy) {
          writeFileSync(join(dir, '.installedBy'), JSON.stringify(skill.metadata.installedBy, null, 2), 'utf-8')
        }
      },
      remove: async (name: string) => {
        rmSync(skillDir(name), { recursive: true, force: true })
      },
    },
  } as unknown as AgentRuntimeAdapter
  ;(globalThis as TestGlobal).__bakinAppServices = { runtime }
}

describe('plugin-assets onboarding component', () => {
  beforeEach(() => {
    mkdirSync(runtimeSkillHome, { recursive: true })
    mkdirSync(bakinHome, { recursive: true })
    installRuntimeMock()
  })
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('scanPluginAssets', () => {
    it('returns empty drift when no plugin ships defaults/runtime-skills/', async () => {
      const pluginDir = join(testDir, 'plugins', 'noop')
      mkdirSync(pluginDir, { recursive: true })

      const report = await scanPluginAssets([{ id: 'noop', path: pluginDir }])

      expect(report.totalAvailable).toBe(0)
      expect(report.missing).toEqual([])
      expect(report.drifted).toEqual([])
      expect(report.installed).toEqual([])
      expect(report.userEdited).toEqual([])
    })

    it('reports a skill as missing when not yet in the runtime skill store', async () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)

      const report = await scanPluginAssets([{ id: 'sdr', path: pluginDir }])

      expect(report.totalAvailable).toBe(1)
      expect(report.missing).toEqual([{ pluginId: 'sdr', name: 'cold-email' }])
    })

    it('reports a skill as installed when hashes match', async () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)
      await installPluginAssets([{ id: 'sdr', path: pluginDir }])

      const report = await scanPluginAssets([{ id: 'sdr', path: pluginDir }])

      expect(report.installed).toEqual([{ pluginId: 'sdr', name: 'cold-email' }])
      expect(report.drifted).toEqual([])
      expect(report.missing).toEqual([])
    })

    it('reports a skill as drifted when source hash differs from installed hash', async () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)
      await installPluginAssets([{ id: 'sdr', path: pluginDir }])

      // Plugin author updates their skill
      writeFileSync(join(pluginDir, 'defaults', 'runtime-skills', 'cold-email', 'SKILL.md'), SKILL_BODY_V2)

      const report = await scanPluginAssets([{ id: 'sdr', path: pluginDir }])

      expect(report.drifted).toEqual([{ pluginId: 'sdr', name: 'cold-email' }])
      expect(report.installed).toEqual([])
    })

    it('reports a skill as userEdited when .userEdited sentinel exists', async () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)
      await installPluginAssets([{ id: 'sdr', path: pluginDir }])

      writeFileSync(join(runtimeSkillHome, 'skills', 'cold-email', '.userEdited'), '')

      const report = await scanPluginAssets([{ id: 'sdr', path: pluginDir }])

      expect(report.userEdited).toEqual([{ pluginId: 'sdr', name: 'cold-email' }])
      expect(report.installed).toEqual([])
      expect(report.drifted).toEqual([])
    })
  })

  describe('installPluginAssets', () => {
    it('copies SKILL.md to the runtime skill store', async () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)

      const result = await installPluginAssets([{ id: 'sdr', path: pluginDir }])

      const installedPath = join(runtimeSkillHome, 'skills', 'cold-email', 'SKILL.md')
      expect(existsSync(installedPath)).toBe(true)
      expect(readFileSync(installedPath, 'utf-8')).toBe(SKILL_BODY)
      expect(result.installed.length).toBe(1)
      expect(result.skipped.length).toBe(0)
    })

    it('writes a .installedBy marker with pluginId and source hash', async () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)

      await installPluginAssets([{ id: 'sdr', path: pluginDir }])

      const markerPath = join(runtimeSkillHome, 'skills', 'cold-email', '.installedBy')
      expect(existsSync(markerPath)).toBe(true)
      const marker = JSON.parse(readFileSync(markerPath, 'utf-8'))
      expect(marker.pluginId).toBe('sdr')
      expect(typeof marker.sha256).toBe('string')
      expect(marker.sha256.length).toBe(64)
    })

    it('is idempotent — second install on identical source is a noop', async () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)

      await installPluginAssets([{ id: 'sdr', path: pluginDir }])
      const result = await installPluginAssets([{ id: 'sdr', path: pluginDir }])

      expect(result.installed.length).toBe(0)
      expect(result.unchanged.length).toBe(1)
    })

    it('overwrites a drifted skill with the new source content', async () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)
      await installPluginAssets([{ id: 'sdr', path: pluginDir }])

      writeFileSync(join(pluginDir, 'defaults', 'runtime-skills', 'cold-email', 'SKILL.md'), SKILL_BODY_V2)
      const result = await installPluginAssets([{ id: 'sdr', path: pluginDir }])

      const installedPath = join(runtimeSkillHome, 'skills', 'cold-email', 'SKILL.md')
      expect(readFileSync(installedPath, 'utf-8')).toBe(SKILL_BODY_V2)
      expect(result.installed.length).toBe(1)
    })

    it('skips skills with .userEdited sentinel and records them in skipped', async () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)
      await installPluginAssets([{ id: 'sdr', path: pluginDir }])
      writeFileSync(join(runtimeSkillHome, 'skills', 'cold-email', '.userEdited'), '')

      writeFileSync(join(pluginDir, 'defaults', 'runtime-skills', 'cold-email', 'SKILL.md'), SKILL_BODY_V2)
      const result = await installPluginAssets([{ id: 'sdr', path: pluginDir }])

      expect(result.skipped).toEqual([
        { pluginId: 'sdr', name: 'cold-email', reason: 'userEdited' },
      ])
      const installedPath = join(runtimeSkillHome, 'skills', 'cold-email', 'SKILL.md')
      expect(readFileSync(installedPath, 'utf-8')).toBe(SKILL_BODY)
    })

    it('copies sibling files in the skill directory (e.g. scripts/)', async () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)
      const scriptsDir = join(pluginDir, 'defaults', 'runtime-skills', 'cold-email', 'scripts')
      mkdirSync(scriptsDir, { recursive: true })
      writeFileSync(join(scriptsDir, 'helper.sh'), '#!/bin/sh\necho hi\n')

      await installPluginAssets([{ id: 'sdr', path: pluginDir }])

      const installedScript = join(runtimeSkillHome, 'skills', 'cold-email', 'scripts', 'helper.sh')
      expect(existsSync(installedScript)).toBe(true)
      expect(readFileSync(installedScript, 'utf-8')).toContain('echo hi')
    })

    it('reconciles installedSkills into the lockfile entry (C25 — was silently dead in tests)', async () => {
      // Seed a lockfile entry as if `bakin plugins install sdr` already ran.
      // installPluginAssets should then update its installedSkills to match
      // what's on disk in defaults/runtime-skills/.
      const { addPlugin, readPluginLockfile, writePluginLockfile } =
        await import('../../../packages/core/src/plugins/lockfile')
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)
      writePluginLockfile(addPlugin(readPluginLockfile(), 'sdr', {
        source: pluginDir,
        type: 'local',
        ref: '',
        commitSha: '',
        installedAt: '2026-04-26T00:00:00Z',
        version: '1.0.0',
        permissions: [],
        manifestSha: 'fixture-sha',
        // installedSkills intentionally omitted — should be populated by sync
      }))

      await installPluginAssets([{ id: 'sdr', path: pluginDir }])

      const entry = readPluginLockfile().plugins['sdr']
      expect(entry?.installedSkills).toEqual(['cold-email'])
    })

    it('skips lockfile reconciliation for plugins without an entry (e.g. core)', async () => {
      const { readPluginLockfile } = await import('../../../packages/core/src/plugins/lockfile')
      const pluginDir = makePluginWithSkill('built-in-plugin', 'some-skill', SKILL_BODY)

      // No lockfile entry seeded. Reconciliation should be a no-op.
      await installPluginAssets([{ id: 'built-in-plugin', path: pluginDir }])

      // Lockfile still empty — we never created an entry for an id we
      // didn't already know about.
      expect(readPluginLockfile().plugins['built-in-plugin']).toBeUndefined()
    })
  })

  describe('pluginAssetsComponent', () => {
    it('check() returns ok with "0 plugin assets to install" when nothing to do', async () => {
      const result = await pluginAssetsComponent.check()

      expect(result.name).toBe('plugin-assets')
      expect(result.status).toBe('ok')
      expect(result.message).toMatch(/0 plugin assets/i)
    })
  })
})
