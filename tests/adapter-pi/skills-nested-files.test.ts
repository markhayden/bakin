/**
 * Pin: Pi's skills.write accepts NESTED file paths (scripts/, references/)
 * with traversal guarded BEFORE the first write, projects scripts with the
 * executable bit set, and get() reads the whole tree back. The old flat-only
 * guard broke hub-skill bundles and the runtime-switch skill carry
 * (OpenClaw skills legitimately carry nested paths).
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-pi-skill-nested-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = pathJoin(testDir, 'pi')
process.env.BAKIN_HOME = testDir

import { afterAll, describe, expect, it, mock } from 'bun:test'
import { existsSync, rmSync, statSync } from 'fs'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: pathJoin(testDir, 'bakin.db') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: pathJoin(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { getPiPath, resetPiHome } from '../../packages/adapter-pi/src/home'
import { createSkillsSurface } from '../../packages/adapter-pi/src/skills'

afterAll(() => {
  resetPiHome()
  rmSync(testDir, { recursive: true, force: true })
})

const installedBy = {
  package: 'hub-test',
  version: '1.0.0',
  ref: '',
  commitSha: '',
  sha256: 'a'.repeat(64),
  installedAt: new Date().toISOString(),
}

describe('pi skills nested files', () => {
  it('round-trips nested files and sets exec bits on scripts', async () => {
    const skills = createSkillsSurface()
    await skills.write({
      name: 'nested',
      instructions: '# nested skill',
      files: {
        'SKILL.md': '# nested skill',
        'scripts/fetch.sh': '#!/usr/bin/env bash\necho hi\n',
        'scripts/helper.py': 'print("hi")\n',
        'references/guide.md': '# guide',
        'bin/run': '#!/bin/sh\necho shebang-no-extension\n',
        'references/data.txt': 'plain text, not executable',
      },
      metadata: { installedBy },
    })

    const skill = await skills.get('nested')
    expect(skill).not.toBeNull()
    expect(skill!.files?.['scripts/fetch.sh']).toContain('echo hi')
    expect(skill!.files?.['references/guide.md']).toBe('# guide')
    expect(skill!.files?.['SKILL.md']).toBe('# nested skill')

    const dir = getPiPath('agent', 'skills', 'nested')
    // Scripts (by extension or shebang) are executable; plain files are not.
    expect(statSync(pathJoin(dir, 'scripts', 'fetch.sh')).mode & 0o111).not.toBe(0)
    expect(statSync(pathJoin(dir, 'scripts', 'helper.py')).mode & 0o111).not.toBe(0)
    expect(statSync(pathJoin(dir, 'bin', 'run')).mode & 0o111).not.toBe(0)
    expect(statSync(pathJoin(dir, 'references', 'data.txt')).mode & 0o111).toBe(0)
  })

  it('rejects traversal/absolute paths before writing anything', async () => {
    const skills = createSkillsSurface()
    for (const bad of ['../escape.md', 'scripts/../../escape.md', '/etc/passwd', 'a//b.md', 'nested\\win.md']) {
      await expect(
        skills.write({
          name: 'hostile',
          instructions: '# hostile',
          files: { 'SKILL.md': '# hostile', [bad]: 'nope' },
        }),
      ).rejects.toThrow()
      // Validation happens before the first write — no half-written directory.
      expect(existsSync(getPiPath('agent', 'skills', 'hostile'))).toBe(false)
    }
  })

  it('excludes sidecars at any depth from the files map', async () => {
    const skills = createSkillsSurface()
    await skills.write({
      name: 'sidecars',
      instructions: '# s',
      files: { 'SKILL.md': '# s', 'references/notes.md': 'n' },
      metadata: { installedBy },
    })
    const skill = await skills.get('sidecars')
    expect(skill!.files?.['.installedBy']).toBeUndefined()
    expect(Object.keys(skill!.files ?? {}).some((k) => k.endsWith('.installedBy'))).toBe(false)
    expect(skill!.metadata?.installedBy).toBeDefined()
  })

  it('accepts an OpenClaw-shaped carry payload (nested files map)', async () => {
    // The runtime-switch carry hands Pi whatever OpenClaw's get() returned —
    // a nested files map. This is the exact shape that used to throw.
    const skills = createSkillsSurface()
    const carried = {
      name: 'carried-skill',
      instructions: '# carried',
      files: {
        'SKILL.md': '# carried',
        'scripts/main.sh': '#!/bin/sh\necho carried\n',
        'assets/prompt.md': 'prompt text',
      },
    }
    await skills.write(carried)
    const back = await skills.get('carried-skill')
    expect(Object.keys(back!.files ?? {}).sort()).toEqual(['SKILL.md', 'assets/prompt.md', 'scripts/main.sh'])
  })
})
