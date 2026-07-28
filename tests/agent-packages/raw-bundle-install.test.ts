/**
 * T7 (#687): raw Agent-Skills bundles install end-to-end through the ONE
 * packages engine. Fetch detects the missing manifest + present SKILL.md,
 * synthesis restructures staging, and everything downstream (lockfile,
 * projection, readiness, update, remove) is stock machinery.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-raw-bundle-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: pathJoin(testDir, 'bin'), db: pathJoin(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
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

const skillStore = new Map<string, { name: string; instructions?: string; files?: Record<string, string>; metadata?: Record<string, unknown> }>()
const runtimeMock = {
  agents: { list: async () => [], get: async () => null },
  skills: {
    list: async () => Array.from(skillStore.values()),
    get: async (name: string) => skillStore.get(name) ?? null,
    write: async (skill: { name: string }) => {
      skillStore.set(skill.name, skill)
    },
    remove: async (name: string) => {
      skillStore.delete(name)
    },
  },
}
mock.module('../../src/core/app-services', () => ({
  getAppServices: () => ({ runtime: runtimeMock }),
  maybeGetAppServices: () => ({ runtime: runtimeMock }),
}))

import { installPackage } from '../../src/core/agent-packages/installer'
import { removePackageById } from '../../src/core/agent-packages/uninstaller'
import { updatePackageById } from '../../src/core/agent-packages/updater'
import { listCapabilities } from '../../src/core/agent-packages/capability-readiness'
import { readLockfile } from '../../packages/core/src/agent-packages/lockfile'

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'skill-bundles')

function seedRawBundle(fixture: string, name: string): string {
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

describe('raw-bundle install (local source)', () => {
  it('installs, locks, projects, and reports readiness — full cycle', async () => {
    const src = seedRawBundle('clawhub-style', 'ebay-a')
    const result = await installPackage({ source: src })
    expect(result.packageId).toBe('hub-ebay-research')
    expect(result.kind).toBe('skill-pack')

    // Lockfile entry under the compound hub key.
    const entry = readLockfile().packages['hub-ebay-research@1.2.0']
    expect(entry).toBeDefined()
    expect(entry!.kind).toBe('skill-pack')

    // Skill projected globally with the FULL nested tree.
    const projected = skillStore.get('ebay-research')
    expect(projected).toBeDefined()
    expect(projected!.files?.['scripts/fetch.sh']).toContain('EBAY_API_KEY')

    // Installed manifest carries upstream provenance.
    const manifestPath = join(testDir, 'packages', 'skill-packs', 'hub-ebay-research@1.2.0', 'bakin-package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    expect(manifest.upstream.source).toBe(src)

    // Requirement-bearing → capability readiness leg with the missing key.
    const caps = await listCapabilities()
    const cap = caps.find((c) => c.capability === 'ebay-research')
    expect(cap).toBeDefined()
    expect(cap!.ready).toBe(false)
    expect(cap!.secrets.find((s) => s.name === 'EBAY_API_KEY')?.status).toBe('missing')
    expect(cap!.prereqs.find((p) => p.name === 'jq')).toBeDefined()

    // Remove cleans projection and lockfile.
    await removePackageById({ packageId: 'hub-ebay-research@1.2.0' })
    expect(skillStore.has('ebay-research')).toBe(false)
    expect(readLockfile().packages['hub-ebay-research@1.2.0']).toBeUndefined()
  })

  it('a requirement-free bundle installs with NO capability surface (no noise)', async () => {
    const src = seedRawBundle('bare-style', 'bare-a')
    await installPackage({ source: src })
    expect(skillStore.has('commit-messages')).toBe(true)
    const caps = await listCapabilities()
    expect(caps.find((c) => c.packageId === 'hub-commit-messages')).toBeUndefined()
    await removePackageById({ packageId: 'hub-commit-messages@0.0.0' })
  })

  it('update re-fetches through the same synthesis path and re-projects changed content', async () => {
    const src = seedRawBundle('bare-style', 'bare-up')
    await installPackage({ source: src })

    // Upstream ships a new version with changed instructions.
    const skillMd = readFileSync(join(src, 'SKILL.md'), 'utf-8')
      .replace('version: 0.0.0', '')
      .replace('# Commit Messages', '# Commit Messages v2')
    writeFileSync(join(src, 'SKILL.md'), `---\nname: commit-messages\ndescription: v2\nversion: 2.0.0\n---\n# Commit Messages v2\n`)
    void skillMd

    const updated = await updatePackageById({ packageId: 'hub-commit-messages@0.0.0' })
    expect(updated.toVersion).toBe('2.0.0')
    expect(skillStore.get('commit-messages')?.files?.['SKILL.md']).toContain('v2')
    // Engine semantics: the lockfile KEY is stable across updates; the
    // version field inside the entry is the truth.
    expect(readLockfile().packages['hub-commit-messages@0.0.0']?.version).toBe('2.0.0')
  })

  it('a dir with neither manifest nor SKILL.md still fails with the classic error + hint', async () => {
    const dir = join(testDir, 'sources', 'not-a-bundle')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'readme.md'), 'nothing here')
    await expect(installPackage({ source: dir })).rejects.toThrow(/bakin-package\.json|SKILL\.md/)
  })

  it('binary-carrying bundles refuse at fetch with the file named', async () => {
    const src = seedRawBundle('binary-file', 'bin-a')
    await expect(installPackage({ source: src })).rejects.toThrow(/binary files[^]*logo\.png/)
    expect(skillStore.size).toBe(0)
  })

  it('manifest-bearing sources behave bit-identically (no synthesis interference)', async () => {
    const dir = join(testDir, 'sources', 'real-pack')
    mkdirSync(join(dir, 'skills', 'real'), { recursive: true })
    writeFileSync(join(dir, 'skills', 'real', 'SKILL.md'), '# real')
    writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify({
      id: 'realpack', name: 'realpack', version: '1.0.0', kind: 'skill-pack',
      contributions: { skills: ['skills/real'] },
    }))
    const result = await installPackage({ source: dir })
    expect(result.packageId).toBe('realpack')
    expect(skillStore.has('real')).toBe(true)
  })
})
