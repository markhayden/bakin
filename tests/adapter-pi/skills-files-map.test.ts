/**
 * Pin: Pi's skills.get serves the COMPLETE files map — SKILL.md included
 * (OpenClaw parity). Excluding it made every Pi-hosted skill read
 * permanently drifted in the sync scanner (which hashes skill.files
 * strictly) and dropped instructions from uninstall snapshots.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-pi-skill-files-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = pathJoin(testDir, 'pi')
process.env.BAKIN_HOME = testDir

import { afterAll, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'fs'

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

import { resetPiHome } from '../../packages/adapter-pi/src/home'
import { createSkillsSurface } from '../../packages/adapter-pi/src/skills'

afterAll(() => {
  resetPiHome()
  rmSync(testDir, { recursive: true, force: true })
})

describe('pi skills files map', () => {
  it('write→get round trip includes SKILL.md in files (and never sidecars)', async () => {
    const skills = createSkillsSurface()
    await skills.write({
      name: 'roundtrip',
      instructions: '# roundtrip skill',
      files: { 'SKILL.md': '# roundtrip skill', 'helper.js': 'console.log(1)' },
      metadata: { installedBy: { package: 'p', version: '1.0.0', ref: '', commitSha: '', sha256: 'a'.repeat(64), installedAt: new Date().toISOString() } },
    })
    const skill = await skills.get('roundtrip')
    expect(skill).not.toBeNull()
    expect(skill!.files?.['SKILL.md']).toBe('# roundtrip skill')
    expect(skill!.files?.['helper.js']).toBe('console.log(1)')
    expect(skill!.files?.['.installedBy']).toBeUndefined()
    expect(skill!.instructions).toBe('# roundtrip skill')
  })
})
