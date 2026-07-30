/**
 * D14 (#687): manifest.runtimes / manifest.platforms are enforced SERVER-SIDE
 * at install time — previously only the Explore UI badge knew. A pack that
 * declares runtimes: ['openclaw'] while the active adapter is pi must refuse
 * before any projection; same for a platforms list excluding this machine.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-rt-gate-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
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
import { readLockfile } from '../../packages/core/src/agent-packages/lockfile'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function seedPack(id: string, extra: Record<string, unknown>): string {
  const dir = join(testDir, 'sources', id)
  mkdirSync(join(dir, 'skills', 'demo'), { recursive: true })
  writeFileSync(join(dir, 'skills', 'demo', 'SKILL.md'), '# demo')
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id,
      name: id,
      version: '1.0.0',
      kind: 'skill-pack',
      contributions: { skills: ['skills/demo'] },
      ...extra,
    }),
  )
  return dir
}

beforeEach(() => {
  skillStore.clear()
})

describe('runtime/platform install gate (D14)', () => {
  it('refuses a pack whose runtimes exclude the active adapter', async () => {
    const src = seedPack('openclaw-only', { runtimes: ['openclaw'] })
    await expect(installPackage({ source: src })).rejects.toThrow(/not for the active runtime \(pi\)/)
    // Nothing projected, nothing locked.
    expect(skillStore.size).toBe(0)
    expect(readLockfile().packages['openclaw-only@1.0.0']).toBeUndefined()
  })

  it('installs when runtimes includes the active adapter or is a wildcard', async () => {
    const src = seedPack('pi-ok', { runtimes: ['pi', 'openclaw'] })
    const result = await installPackage({ source: src })
    expect(result.packageId).toBe('pi-ok')
    expect(skillStore.has('demo')).toBe(true)

    skillStore.clear()
    const srcStar = seedPack('star-ok', { runtimes: ['*'] })
    await installPackage({ source: srcStar })
    expect(skillStore.has('demo')).toBe(true)
  })

  it('refuses a pack whose platforms exclude this machine', async () => {
    const other = process.platform === 'darwin' ? 'linux-x64' : 'darwin-arm64'
    const src = seedPack('wrong-os', { platforms: [other] })
    await expect(installPackage({ source: src })).rejects.toThrow(/not available on this platform/)
    expect(skillStore.size).toBe(0)
    expect(existsSync(join(testDir, 'packages', 'skill-packs', 'wrong-os@1.0.0'))).toBe(false)
  })
})
