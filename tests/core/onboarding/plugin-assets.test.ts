/**
 * Tests for the plugin-assets onboarding component.
 *
 * The component installs OpenClaw runtime skills (S-B in the spec) that
 * plugins ship at `defaults/openclaw-skills/{name}/SKILL.md`. The
 * component is the only piece that touches `~/.openclaw/skills/` —
 * everything else stays in plugin source on disk.
 *
 * All filesystem ops are confined to a temp dir; `getOpenClawHome` is
 * mocked so the component never touches the production OpenClaw home.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-plugin-assets-${Date.now()}`)
const openclawHome = join(testDir, 'openclaw')
const bakinHome = join(testDir, 'bakin')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => bakinHome,
  getBakinPaths: () => ({ workflows: join(bakinHome, 'workflows') }),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => openclawHome,
  getOpenClawPath: (...parts: string[]) => join(openclawHome, ...parts),
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import {
  scanPluginAssets,
  installPluginAssets,
  pluginAssetsComponent,
} from '@/core/onboarding/plugin-assets'

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
  const skillDir = join(pluginDir, 'defaults', 'openclaw-skills', skillName)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), body)
  return pluginDir
}

describe('plugin-assets onboarding component', () => {
  beforeEach(() => {
    mkdirSync(openclawHome, { recursive: true })
    mkdirSync(bakinHome, { recursive: true })
  })
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('scanPluginAssets', () => {
    it('returns empty drift when no plugin ships defaults/openclaw-skills/', () => {
      const pluginDir = join(testDir, 'plugins', 'noop')
      mkdirSync(pluginDir, { recursive: true })

      const report = scanPluginAssets([{ id: 'noop', path: pluginDir }])

      expect(report.totalAvailable).toBe(0)
      expect(report.missing).toEqual([])
      expect(report.drifted).toEqual([])
      expect(report.installed).toEqual([])
      expect(report.userEdited).toEqual([])
    })

    it('reports a skill as missing when not yet on disk in OpenClaw', () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)

      const report = scanPluginAssets([{ id: 'sdr', path: pluginDir }])

      expect(report.totalAvailable).toBe(1)
      expect(report.missing).toEqual([{ pluginId: 'sdr', name: 'cold-email' }])
    })

    it('reports a skill as installed when hashes match', () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)
      installPluginAssets([{ id: 'sdr', path: pluginDir }])

      const report = scanPluginAssets([{ id: 'sdr', path: pluginDir }])

      expect(report.installed).toEqual([{ pluginId: 'sdr', name: 'cold-email' }])
      expect(report.drifted).toEqual([])
      expect(report.missing).toEqual([])
    })

    it('reports a skill as drifted when source hash differs from installed hash', () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)
      installPluginAssets([{ id: 'sdr', path: pluginDir }])

      // Plugin author updates their skill
      writeFileSync(join(pluginDir, 'defaults', 'openclaw-skills', 'cold-email', 'SKILL.md'), SKILL_BODY_V2)

      const report = scanPluginAssets([{ id: 'sdr', path: pluginDir }])

      expect(report.drifted).toEqual([{ pluginId: 'sdr', name: 'cold-email' }])
      expect(report.installed).toEqual([])
    })

    it('reports a skill as userEdited when .userEdited sentinel exists', () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)
      installPluginAssets([{ id: 'sdr', path: pluginDir }])

      writeFileSync(join(openclawHome, 'skills', 'cold-email', '.userEdited'), '')

      const report = scanPluginAssets([{ id: 'sdr', path: pluginDir }])

      expect(report.userEdited).toEqual([{ pluginId: 'sdr', name: 'cold-email' }])
      expect(report.installed).toEqual([])
      expect(report.drifted).toEqual([])
    })
  })

  describe('installPluginAssets', () => {
    it('copies SKILL.md to ~/.openclaw/skills/{name}/SKILL.md', () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)

      const result = installPluginAssets([{ id: 'sdr', path: pluginDir }])

      const installedPath = join(openclawHome, 'skills', 'cold-email', 'SKILL.md')
      expect(existsSync(installedPath)).toBe(true)
      expect(readFileSync(installedPath, 'utf-8')).toBe(SKILL_BODY)
      expect(result.installed.length).toBe(1)
      expect(result.skipped.length).toBe(0)
    })

    it('writes a .installedBy marker with pluginId and source hash', () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)

      installPluginAssets([{ id: 'sdr', path: pluginDir }])

      const markerPath = join(openclawHome, 'skills', 'cold-email', '.installedBy')
      expect(existsSync(markerPath)).toBe(true)
      const marker = JSON.parse(readFileSync(markerPath, 'utf-8'))
      expect(marker.pluginId).toBe('sdr')
      expect(typeof marker.sha256).toBe('string')
      expect(marker.sha256.length).toBe(64)
    })

    it('is idempotent — second install on identical source is a noop', () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)

      installPluginAssets([{ id: 'sdr', path: pluginDir }])
      const result = installPluginAssets([{ id: 'sdr', path: pluginDir }])

      expect(result.installed.length).toBe(0)
      expect(result.unchanged.length).toBe(1)
    })

    it('overwrites a drifted skill with the new source content', () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)
      installPluginAssets([{ id: 'sdr', path: pluginDir }])

      writeFileSync(join(pluginDir, 'defaults', 'openclaw-skills', 'cold-email', 'SKILL.md'), SKILL_BODY_V2)
      const result = installPluginAssets([{ id: 'sdr', path: pluginDir }])

      const installedPath = join(openclawHome, 'skills', 'cold-email', 'SKILL.md')
      expect(readFileSync(installedPath, 'utf-8')).toBe(SKILL_BODY_V2)
      expect(result.installed.length).toBe(1)
    })

    it('skips skills with .userEdited sentinel and records them in skipped', () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)
      installPluginAssets([{ id: 'sdr', path: pluginDir }])
      writeFileSync(join(openclawHome, 'skills', 'cold-email', '.userEdited'), '')

      writeFileSync(join(pluginDir, 'defaults', 'openclaw-skills', 'cold-email', 'SKILL.md'), SKILL_BODY_V2)
      const result = installPluginAssets([{ id: 'sdr', path: pluginDir }])

      expect(result.skipped).toEqual([
        { pluginId: 'sdr', name: 'cold-email', reason: 'userEdited' },
      ])
      const installedPath = join(openclawHome, 'skills', 'cold-email', 'SKILL.md')
      expect(readFileSync(installedPath, 'utf-8')).toBe(SKILL_BODY)
    })

    it('copies sibling files in the skill directory (e.g. scripts/)', () => {
      const pluginDir = makePluginWithSkill('sdr', 'cold-email', SKILL_BODY)
      const scriptsDir = join(pluginDir, 'defaults', 'openclaw-skills', 'cold-email', 'scripts')
      mkdirSync(scriptsDir, { recursive: true })
      writeFileSync(join(scriptsDir, 'helper.sh'), '#!/bin/sh\necho hi\n')

      installPluginAssets([{ id: 'sdr', path: pluginDir }])

      const installedScript = join(openclawHome, 'skills', 'cold-email', 'scripts', 'helper.sh')
      expect(existsSync(installedScript)).toBe(true)
      expect(readFileSync(installedScript, 'utf-8')).toContain('echo hi')
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
