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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
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
  getBakinPaths: () => ({ workflows: join(bakinHome, 'workflows'), bin: join(bakinHome, 'bin') }),
}))
// CLAUDE.md mock-both-paths rule — the lockfile module imports its own
// `getContentDir` from `@bakin/core/content-dir`, so without this mock
// `syncLockfileInstalledSkills` would trip the production-content-dir
// safety guard and silently abort.
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => bakinHome,
  getBakinPaths: () => ({ workflows: join(bakinHome, 'workflows'), bin: join(bakinHome, 'bin') }),
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
import { addPlugin, readPluginLockfile, writePluginLockfile } from '../../../packages/core/src/plugins/lockfile'
import { readInstalledBy } from '../../../packages/core/src/agent-packages/markers'

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

// ─── Binaries (spec plugin-managed-binaries S5) ────────────────────────────

const TOOL = '#!/bin/sh\necho tool\n'
const TOOL_V2 = '#!/bin/sh\necho tool v2\n'
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const platform = `${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
const otherPlatform = platform.startsWith('darwin') ? 'linux-x64' : 'darwin-arm64'
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
let binServer: { port: number; stop: (force?: boolean) => void }
let NativeResponse: typeof Response
let served = TOOL

function makePluginWithBin(pluginId: string, opts: { sha?: string; platformKey?: string; root?: string } = {}): string {
  const pluginDir = join(opts.root ?? join(testDir, 'plugins'), pluginId)
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'bakin-plugin.json'), JSON.stringify({
    id: pluginId, name: pluginId, version: '1.0.0', bakin: '*', description: 'declares a binary',
    requires: { bins: [{ name: 'tool', version: '1.0.0', install: { [opts.platformKey ?? platform]: { url: `http://127.0.0.1:${binServer.port}/tool`, sha256: opts.sha ?? sha256(TOOL) } } }] },
  }))
  return pluginDir
}
const binPath = () => join(bakinHome, 'bin', 'tool')

describe('plugin-assets — binaries', () => {
  beforeAll(async () => {
    NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
    binServer = (Bun as unknown as { serve: (o: unknown) => typeof binServer }).serve({ port: 0, fetch: () => new NativeResponse(served) })
  })
  afterAll(() => binServer.stop(true))
  beforeEach(() => {
    mkdirSync(runtimeSkillHome, { recursive: true })
    mkdirSync(bakinHome, { recursive: true })
    installRuntimeMock()
    served = TOOL
  })
  afterEach(() => rmSync(testDir, { recursive: true, force: true }))

  it('missing → install downloads + marks + records in the lockfile → installed; tampered bytes → drifted → reinstalled', async () => {
    const pluginDir = makePluginWithBin('term')
    writePluginLockfile(addPlugin(readPluginLockfile(), 'term', {
      source: pluginDir, type: 'local', ref: '', commitSha: 'a'.repeat(40), installedAt: '2026-09-01T00:00:00.000Z', version: '1.0.0', permissions: [], manifestSha: 'a'.repeat(64),
    }))
    const entry = { id: 'term', path: pluginDir }

    let report = await scanPluginAssets([entry])
    expect(report.bins).toEqual({ total: 1, installed: [], missing: [{ pluginId: 'term', name: 'tool' }], drifted: [], unsupported: [] })

    const installed = await installPluginAssets([entry])
    expect(installed.bins.installed).toEqual([{ pluginId: 'term', name: 'tool' }])
    expect(installed.bins.failed).toEqual([])
    expect(readFileSync(binPath(), 'utf-8')).toBe(TOOL)
    expect(readInstalledBy(binPath())).toMatchObject({ package: 'plugin:term', commitSha: 'a'.repeat(40) })
    expect(readPluginLockfile().plugins.term?.installedBins).toEqual([{ name: 'tool', sha256: sha256(TOOL) }])

    report = await scanPluginAssets([entry])
    expect(report.bins.installed).toEqual([{ pluginId: 'term', name: 'tool' }])
    expect((await installPluginAssets([entry])).bins.unchanged).toEqual([{ pluginId: 'term', name: 'tool' }])

    // Bytes change under an untouched marker → drifted, and install re-downloads.
    writeFileSync(binPath(), '#!/bin/sh\necho tampered\n')
    report = await scanPluginAssets([entry])
    expect(report.bins.drifted).toEqual([{ pluginId: 'term', name: 'tool' }])
    const repaired = await installPluginAssets([entry])
    expect(repaired.bins.installed).toEqual([{ pluginId: 'term', name: 'tool' }])
    expect(readFileSync(binPath(), 'utf-8')).toBe(TOOL)
  })

  it('a bin with no build for this platform is reported as unsupported, never installed', async () => {
    const pluginDir = makePluginWithBin('term', { platformKey: otherPlatform })
    const report = await scanPluginAssets([{ id: 'term', path: pluginDir }])
    expect(report.bins.unsupported).toEqual([{ pluginId: 'term', name: 'tool' }])
    const installed = await installPluginAssets([{ id: 'term', path: pluginDir }])
    expect(installed.bins).toEqual({ installed: [], unchanged: [], failed: [] })
    expect(existsSync(binPath())).toBe(false)
  })

  it('a pin another owner holds differently fails THAT plugin\'s repair loudly and writes nothing', async () => {
    const pluginDir = makePluginWithBin('term')
    writePluginLockfile(addPlugin(readPluginLockfile(), 'otherplug', {
      source: '/x', type: 'local', ref: '', commitSha: '', installedAt: '2026-09-01T00:00:00.000Z', version: '1.0.0', permissions: [], manifestSha: 'b'.repeat(64),
      installedBins: [{ name: 'tool', sha256: sha256(TOOL_V2) }],
    }))
    const installed = await installPluginAssets([{ id: 'term', path: pluginDir }])
    expect(installed.bins.installed).toEqual([])
    expect(installed.bins.failed).toHaveLength(1)
    expect(installed.bins.failed[0]!.error).toMatch(/otherplug/)
    expect(existsSync(binPath())).toBe(false)
  })

  it('the component names missing binaries, repairs them, and reports a conflict as a failed install', async () => {
    // Under bakinHome/plugins so discoverPlugins() finds it.
    makePluginWithBin('term', { root: join(bakinHome, 'plugins') })
    const check = await pluginAssetsComponent.check()
    expect(check.status).toBe('warn')
    expect(check.message).toMatch(/1 binary missing: tool \(term\)/)
    expect(check.remediation).toMatch(/bakin install plugin-assets/)

    const install = await pluginAssetsComponent.install({ interactive: false, autoApprove: true, json: false, checkOnly: false, force: false })
    expect(install.status).toBe('installed')
    expect(install.message).toMatch(/1 binary: tool \(term\)/)
    expect((await pluginAssetsComponent.check()).status).toBe('ok')
    expect((await pluginAssetsComponent.check()).message).toMatch(/incl\. 1 binary/)

    // Another owner re-pins the same target differently → the repair refuses, loudly.
    rmSync(binPath(), { force: true })
    writePluginLockfile(addPlugin(readPluginLockfile(), 'otherplug', {
      source: '/x', type: 'local', ref: '', commitSha: '', installedAt: '2026-09-01T00:00:00.000Z', version: '1.0.0', permissions: [], manifestSha: 'b'.repeat(64),
      installedBins: [{ name: 'tool', sha256: sha256(TOOL_V2) }],
    }))
    const refused = await pluginAssetsComponent.install({ interactive: false, autoApprove: true, json: false, checkOnly: false, force: false })
    expect(refused.status).toBe('failed')
    expect(refused.message).toMatch(/tool \(term\)/)
    expect(refused.message).toMatch(/otherplug/)
  })
})
