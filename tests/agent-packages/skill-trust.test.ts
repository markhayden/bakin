/**
 * T9 (#687): the trust gate — preview assembly, instruction-risk scan,
 * consent token binding, drift bounce, and audited refusals. Local fixture
 * sources only; no network.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-skill-trust-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: pathJoin(testDir, 'bin'), db: pathJoin(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: pathJoin(testDir, 'bin'), db: pathJoin(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../src/core/settings', () => ({
  getSettings: () => ({ runtime: { adapter: 'pi' } }),
}))

const skillStore = new Map<string, { name: string; files?: Record<string, string> }>()
mock.module('../../src/core/app-services', () => ({
  getAppServices: () => ({
    runtime: {
      agents: { list: async () => [], get: async () => null },
      skills: {
        list: async () => Array.from(skillStore.values()),
        get: async (name: string) => skillStore.get(name) ?? null,
        write: async (skill: { name: string }) => {
          skillStore.set(skill.name, skill as { name: string; files?: Record<string, string> })
        },
        remove: async (name: string) => {
          skillStore.delete(name)
        },
      },
    },
  }),
  maybeGetAppServices: () => undefined,
}))

import {
  buildSkillPreview,
  confirmSkillInstall,
  scanInstructionRisk,
} from '../../src/core/agent-packages/skill-trust'
import { readLockfile } from '../../packages/core/src/agent-packages/lockfile'

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'skill-bundles')

function seedSource(fixture: string, name: string): string {
  const dir = join(testDir, 'sources', name)
  rmSync(dir, { recursive: true, force: true })
  cpSync(join(FIXTURES, fixture), dir, { recursive: true })
  return dir
}

beforeEach(() => {
  skillStore.clear()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('scanInstructionRisk', () => {
  it('flags the ClawHavoc-shaped patterns with file/line anchors', () => {
    const files = {
      'SKILL.md': readFileSync(join(FIXTURES, 'malicious-shaped', 'SKILL.md'), 'utf-8'),
      'scripts/setup.sh': readFileSync(join(FIXTURES, 'malicious-shaped', 'scripts', 'setup.sh'), 'utf-8'),
    }
    const findings = scanInstructionRisk(files)
    const patterns = findings.map((f) => f.pattern)
    expect(patterns).toContain('curl-pipe-shell')
    expect(patterns).toContain('wget-pipe-shell')
    expect(patterns).toContain('base64-decode-exec')
    expect(findings.every((f) => f.line > 0 && f.snippet.length > 0)).toBe(true)
  })

  it('stays quiet on benign content (a plain curl without a pipe is fine)', () => {
    expect(scanInstructionRisk({ 'SKILL.md': '# ok\nUse curl to call the API.\n' })).toEqual([])
  })
})

describe('buildSkillPreview', () => {
  it('assembles the full preview for a requirement-bearing bundle', async () => {
    const src = seedSource('clawhub-style', 'preview-a')
    const result = await buildSkillPreview(src)
    if (!result.ok) throw new Error(result.error)
    const p = result.preview
    expect(p.packageId).toBe('hub-ebay-research')
    expect(p.version).toBe('1.2.0')
    // Whole-staging-tree paths (the preview covers EVERY contributed skill
    // dir, not just contributions.skills[0]).
    expect(p.files.map((f) => f.path)).toContain('skills/ebay-research/scripts/fetch.sh')
    // The synthesized manifest is shown as structured requirements instead.
    expect(p.files.map((f) => f.path)).not.toContain('bakin-package.json')
    expect(p.files.every((f) => f.bytes > 0)).toBe(true)
    expect(p.requirements.secrets.map((s) => s.name)).toContain('EBAY_API_KEY')
    expect(p.requirements.prereqs.map((q) => q.probe)).toContain('jq')
    expect(p.rawMetadata).toBeDefined() // untranslated metadata rides verbatim
    expect(p.consentToken.length).toBeGreaterThan(20)
    expect(p.verdictState).toBe('none') // local source — no hub verdict exists
  })

  it('surfaces risk findings for malicious-shaped content instead of installing it', async () => {
    const src = seedSource('malicious-shaped', 'preview-m')
    const result = await buildSkillPreview(src)
    if (!result.ok) throw new Error(result.error)
    expect(result.preview.risk.length).toBeGreaterThanOrEqual(3)
    expect(result.preview.mentions).toContain('AWS_SECRET_ACCESS_KEY')
    // Preview NEVER installs or projects.
    expect(skillStore.size).toBe(0)
    expect(Object.keys(readLockfile().packages)).toEqual([])
  })

  it('binary bundles refuse with an audited refusal', async () => {
    const src = seedSource('binary-file', 'preview-b')
    const result = await buildSkillPreview(src)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refused).toBe(true)
    expect(result.error).toContain('binary files')
  })
})

describe('confirmSkillInstall', () => {
  it('happy path: preview token → install → audit', async () => {
    const src = seedSource('bare-style', 'confirm-a')
    const preview = await buildSkillPreview(src)
    if (!preview.ok) throw new Error(preview.error)
    const confirmed = await confirmSkillInstall(src, preview.preview.consentToken)
    expect(confirmed.status).toBe('installed')
    expect(skillStore.has('commit-messages')).toBe(true)
  })

  it('content drift between preview and commit bounces to a FRESH preview', async () => {
    const src = seedSource('bare-style', 'confirm-drift')
    const preview = await buildSkillPreview(src)
    if (!preview.ok) throw new Error(preview.error)

    // Upstream changes after the user saw the preview.
    writeFileSync(join(src, 'SKILL.md'), '---\nname: commit-messages\ndescription: CHANGED\n---\n# changed')

    const confirmed = await confirmSkillInstall(src, preview.preview.consentToken)
    expect(confirmed.status).toBe('drift')
    if (confirmed.status !== 'drift') return
    expect(confirmed.preview.consentToken).not.toBe(preview.preview.consentToken)
    expect(skillStore.size).toBe(0) // nothing installed under stale consent
  })

  it('rejects tokens for a different ref and garbage tokens', async () => {
    const a = seedSource('bare-style', 'confirm-x')
    const b = seedSource('clawhub-style', 'confirm-y')
    const preview = await buildSkillPreview(a)
    if (!preview.ok) throw new Error(preview.error)
    expect((await confirmSkillInstall(b, preview.preview.consentToken)).status).toBe('invalid-token')
    expect((await confirmSkillInstall(a, 'garbage.token')).status).toBe('invalid-token')
  })

  it('never leaves staging behind', async () => {
    const src = seedSource('bare-style', 'confirm-clean')
    const preview = await buildSkillPreview(src)
    if (!preview.ok) throw new Error(preview.error)
    await confirmSkillInstall(src, preview.preview.consentToken)
    const staging = join(testDir, 'packages')
    const leftovers = (await import('fs')).readdirSync(staging, { recursive: false })
      .filter((entry) => String(entry).startsWith('.staging'))
    expect(leftovers).toEqual([])
  })
})

describe('re-install IS the update path (#687 review)', () => {
  it('installing the same ref twice supersedes — no collision, no duplicate entry', async () => {
    const src = seedSource('bare-style', 'reinstall')

    const first = await buildSkillPreview(src)
    if (!first.ok) throw new Error(first.error)
    expect((await confirmSkillInstall(src, first.preview.consentToken)).status).toBe('installed')

    // Upstream edits the content WITHOUT bumping the version (the common
    // ClawHub case) — the old code threw "already installed".
    writeFileSync(join(src, 'SKILL.md'), '---\nname: commit-messages\ndescription: edited\n---\n# edited body\n')

    const second = await buildSkillPreview(src)
    if (!second.ok) throw new Error(second.error)
    const result = await confirmSkillInstall(src, second.preview.consentToken)
    expect(result.status).toBe('installed')

    // Exactly ONE lockfile entry for this skill, holding the new content.
    const keys = Object.keys(readLockfile().packages).filter((k) => k.startsWith('hub-commit-messages'))
    expect(keys).toHaveLength(1)
    expect(skillStore.get('commit-messages')?.files?.['SKILL.md']).toContain('edited body')
  })

  it('a version bump also leaves exactly one entry', async () => {
    const src = seedSource('bare-style', 'reinstall-bump')
    const first = await buildSkillPreview(src)
    if (!first.ok) throw new Error(first.error)
    await confirmSkillInstall(src, first.preview.consentToken)

    writeFileSync(join(src, 'SKILL.md'), '---\nname: commit-messages\ndescription: v2\nversion: 2.0.0\n---\n# v2\n')
    const second = await buildSkillPreview(src)
    if (!second.ok) throw new Error(second.error)
    expect((await confirmSkillInstall(src, second.preview.consentToken)).status).toBe('installed')

    const keys = Object.keys(readLockfile().packages).filter((k) => k.startsWith('hub-commit-messages'))
    expect(keys).toEqual(['hub-commit-messages@2.0.0'])
  })
})

describe('consent binds the bytes that get INSTALLED (TOCTOU, #687 review)', () => {
  it('content swapped after the consent check never lands', async () => {
    const src = seedSource('bare-style', 'toctou')
    const preview = await buildSkillPreview(src)
    if (!preview.ok) throw new Error(preview.error)

    // Tamper between preview and confirm: the gate re-hashes, sees drift,
    // and bounces instead of installing the swapped content.
    writeFileSync(join(src, 'SKILL.md'), '---\nname: commit-messages\ndescription: evil\n---\n# malicious payload\n')
    const result = await confirmSkillInstall(src, preview.preview.consentToken)
    expect(result.status).toBe('drift')
    expect(skillStore.get('commit-messages')).toBeUndefined()
  })
})

describe('a failed re-install never destroys the working install (#687 second review)', () => {
  it('a refused re-install leaves the previously installed skill intact', async () => {
    const src = seedSource('bare-style', 'refuse-keeps')
    const first = await buildSkillPreview(src)
    if (!first.ok) throw new Error(first.error)
    expect((await confirmSkillInstall(src, first.preview.consentToken)).status).toBe('installed')
    const beforeKeys = Object.keys(readLockfile().packages)

    // Upstream ships a manifest the installer will REFUSE (wrong runtime).
    // The old code removed the working install before discovering this.
    writeFileSync(join(src, 'bakin-package.json'), JSON.stringify({
      id: 'hub-commit-messages',
      name: 'commit-messages',
      version: '0.0.0',
      kind: 'skill-pack',
      contributions: { skills: ['skills/commit-messages'] },
      runtimes: ['openclaw'],
    }))
    mkdirSync(join(src, 'skills', 'commit-messages'), { recursive: true })
    writeFileSync(join(src, 'skills', 'commit-messages', 'SKILL.md'), '# refused version')

    const preview = await buildSkillPreview(src)
    if (!preview.ok) throw new Error(preview.error)
    const result = await confirmSkillInstall(src, preview.preview.consentToken)
    expect(result.status).toBe('refused')

    // The working skill and its lockfile entry SURVIVE.
    expect(Object.keys(readLockfile().packages)).toEqual(beforeKeys)
    expect(skillStore.has('commit-messages')).toBe(true)
  })
})

describe('dependency disclosure (#687 second review)', () => {
  it('declared dependencies are surfaced and bound into consent', async () => {
    const dir = join(testDir, 'sources', 'dep-bearing')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(join(dir, 'skills', 'depskill'), { recursive: true })
    writeFileSync(join(dir, 'skills', 'depskill', 'SKILL.md'), '# dep skill')
    writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify({
      id: 'depskill', name: 'depskill', version: '1.0.0', kind: 'skill-pack',
      contributions: { skills: ['skills/depskill'] },
      // A payload hidden behind one indirection would otherwise be invisible.
      dependencies: { skills: [{ source: 'github:evil/payload', ref: 'main' }] },
    }))

    const preview = await buildSkillPreview(dir)
    if (!preview.ok) throw new Error(preview.error)
    expect(preview.preview.requirements.dependencies).toEqual(['github:evil/payload@main'])
  })
})
