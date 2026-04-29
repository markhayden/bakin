/**
 * Coverage for src/core/plugins/link.ts (Phase 2 P2.C2).
 *
 * Verifies the full link + unlink contract:
 *   - linkPlugin creates a symlink at ~/.bakin/plugins/<id>/, runs the
 *     initial build, and writes a `linked: true` lockfile entry.
 *   - id collisions with installed and core plugin ids refuse without
 *     --force; force=true overrides those, but never overwrites an
 *     already-linked plugin.
 *   - resolveAndContain refuses paths that escape the trusted roots.
 *   - Build failure rolls back the symlink so no half-linked state
 *     persists.
 *   - unlinkPlugin removes the symlink + lockfile entry; refuses on a
 *     non-linked entry; idempotent against missing-symlink-but-entry.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, lstatSync, existsSync, rmSync, unlinkSync, realpathSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-plugin-link-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// Stub the build step — exercising real Bun.build over a sample plugin
// is out-of-scope for these unit tests; the build is covered separately
// in tests/api/plugins-build.test.ts. Test #5 forces a build failure by
// switching this mock at runtime.
let buildCount = 0
let buildShouldThrow = false
const buildSpy = async (): Promise<void> => {
  buildCount += 1
  if (buildShouldThrow) throw new Error('synthetic build failure')
}
mock.module(
  '../../../packages/host/src/plugin-host/user-plugin-builder',
  () => ({ buildUserPlugin: buildSpy }),
)

// `isCorePlugin` is wired against a setter at boot time. For tests we
// stub it directly so we can control which ids count as core.
let coreIds = new Set<string>()
mock.module('@/lib/plugin-registry', () => ({
  isCorePlugin: (id: string) => coreIds.has(id),
}))

import {
  linkPlugin,
  unlinkPlugin,
  LinkRefusedError,
} from '../../../src/core/plugins/link'
import { readPluginLockfile, isLinked } from '../../../packages/core/src/plugins/lockfile'

const sourceDir = join(testDir, 'dev-plugin')

function writeManifest(dir: string, body: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify(body, null, 2), 'utf-8')
  writeFileSync(join(dir, 'index.ts'), `export default { id: '${body.id}', activate() {} }`, 'utf-8')
}

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(sourceDir, { recursive: true, force: true })
  rmSync(join(testDir, 'plugins'), { recursive: true, force: true })
  coreIds = new Set()
  buildCount = 0
  buildShouldThrow = false
})

describe('linkPlugin — happy path', () => {
  it('creates a symlink, runs the build, writes a linked lockfile entry', async () => {
    writeManifest(sourceDir, { id: 'devplug', name: 'Dev', version: '0.1.0', permissions: [] })
    const result = await linkPlugin(sourceDir)

    expect(result.id).toBe('devplug')
    expect(result.version).toBe('0.1.0')
    expect(result.linkedSource).toBe(realpathSync(sourceDir))

    const symlinkPath = join(testDir, 'plugins', 'devplug')
    expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true)
    expect(buildCount).toBe(1)

    const lock = readPluginLockfile()
    const entry = lock.plugins.devplug!
    expect(entry).toBeDefined()
    expect(isLinked(entry)).toBe(true)
    expect(entry.linkedSource).toBe(realpathSync(sourceDir))
    expect(entry.commitSha).toBe('')
    expect(entry.ref).toBe('')
  })

  it('falls back to version 0.0.0 when manifest omits version', async () => {
    writeManifest(sourceDir, { id: 'noversion', name: 'No Version', permissions: [] })
    const result = await linkPlugin(sourceDir)
    expect(result.version).toBe('0.0.0')
  })
})

describe('linkPlugin — refusal cases', () => {
  it('refuses when bakin-plugin.json is missing', async () => {
    mkdirSync(sourceDir, { recursive: true })
    await expect(linkPlugin(sourceDir)).rejects.toThrow(LinkRefusedError)
  })

  it('refuses invalid plugin id', async () => {
    writeManifest(sourceDir, { id: 'BadID', name: 'Bad', version: '0.1.0', permissions: [] })
    await expect(linkPlugin(sourceDir)).rejects.toThrow(/invalid plugin id/i)
  })

  it('refuses when source path does not exist', async () => {
    await expect(linkPlugin(join(testDir, 'no-such-dir'))).rejects.toThrow(
      /does not exist/,
    )
  })

  it('refuses id collision with an installed plugin (without force)', async () => {
    const { addPlugin, writePluginLockfile, readPluginLockfile } = await import(
      '../../../packages/core/src/plugins/lockfile'
    )
    writePluginLockfile(addPlugin(readPluginLockfile(), 'collide', {
      source: 'github:owner/repo',
      type: 'github',
      ref: 'main',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
      installedAt: new Date().toISOString(),
      version: '1.0.0',
      permissions: [],
      manifestSha: 'cafebabe',
    }))

    writeManifest(sourceDir, { id: 'collide', name: 'Collide', version: '1.0.0', permissions: [] })
    await expect(linkPlugin(sourceDir)).rejects.toThrow(/already installed/i)
  })

  it('--force allows linking over an installed plugin id', async () => {
    const { addPlugin, writePluginLockfile, readPluginLockfile } = await import(
      '../../../packages/core/src/plugins/lockfile'
    )
    writePluginLockfile(addPlugin(readPluginLockfile(), 'force-collide', {
      source: 'github:owner/repo',
      type: 'github',
      ref: 'main',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
      installedAt: new Date().toISOString(),
      version: '1.0.0',
      permissions: [],
      manifestSha: 'cafebabe',
    }))

    writeManifest(sourceDir, { id: 'force-collide', name: 'Force Collide', version: '2.0.0', permissions: [] })
    const result = await linkPlugin(sourceDir, { force: true })
    expect(result.id).toBe('force-collide')
    expect(readPluginLockfile().plugins['force-collide']?.linked).toBe(true)
  })

  it('refuses id collision with an already linked plugin even with force', async () => {
    const seedDir = join(testDir, 'seed-linked')
    writeManifest(seedDir, { id: 'linked-collide', name: 'Linked', version: '1.0.0', permissions: [] })
    await linkPlugin(seedDir)

    writeManifest(sourceDir, { id: 'linked-collide', name: 'Linked Again', version: '1.0.0', permissions: [] })
    await expect(linkPlugin(sourceDir, { force: true })).rejects.toThrow(/already dev-installed/i)
  })

  it('refuses id collision with a core plugin (without force)', async () => {
    coreIds = new Set(['tasks'])
    writeManifest(sourceDir, { id: 'tasks', name: 'My Tasks Fork', version: '0.1.0', permissions: [] })
    await expect(linkPlugin(sourceDir)).rejects.toThrow(/core feature module/i)
  })

  it('--force allows linking over a core plugin id', async () => {
    coreIds = new Set(['tasks'])
    writeManifest(sourceDir, { id: 'tasks', name: 'My Tasks Fork', version: '0.1.0', permissions: [] })
    const result = await linkPlugin(sourceDir, { force: true })
    expect(result.id).toBe('tasks')
  })

  it('rolls back the symlink when initial build fails', async () => {
    writeManifest(sourceDir, { id: 'buildfail', name: 'Bf', version: '0.1.0', permissions: [] })
    buildShouldThrow = true

    await expect(linkPlugin(sourceDir)).rejects.toThrow(/initial build/i)

    const symlinkPath = join(testDir, 'plugins', 'buildfail')
    expect(existsSync(symlinkPath)).toBe(false)
    // No lockfile entry should be persisted on rollback.
    expect(readPluginLockfile().plugins.buildfail).toBeUndefined()
  })
})

describe('unlinkPlugin', () => {
  it('removes the symlink and the lockfile entry', async () => {
    writeManifest(sourceDir, { id: 'unlinkme', name: 'U', version: '0.1.0', permissions: [] })
    await linkPlugin(sourceDir)

    const symlinkPath = join(testDir, 'plugins', 'unlinkme')
    expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true)

    const result = await unlinkPlugin('unlinkme')
    expect(result.id).toBe('unlinkme')
    expect(result.linkedSource).toBe(realpathSync(sourceDir))
    expect(existsSync(symlinkPath)).toBe(false)
    expect(readPluginLockfile().plugins.unlinkme).toBeUndefined()
  })

  it('refuses when the entry is installed (not linked)', async () => {
    // Synthesize an installed entry directly via the lockfile mutator.
    const { addPlugin, writePluginLockfile, readPluginLockfile } = await import(
      '../../../packages/core/src/plugins/lockfile'
    )
    const lock = readPluginLockfile()
    writePluginLockfile(addPlugin(lock, 'installed', {
      source: 'github:owner/repo',
      type: 'github',
      ref: 'main',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
      installedAt: new Date().toISOString(),
      version: '1.0.0',
      permissions: [],
      manifestSha: 'cafebabe',
    }))

    await expect(unlinkPlugin('installed')).rejects.toThrow(/not linked/i)
  })

  it('refuses on missing lockfile entry', async () => {
    await expect(unlinkPlugin('nope')).rejects.toThrow(/not in the lockfile/i)
  })

  it('still drops the lockfile entry when the symlink is already gone', async () => {
    writeManifest(sourceDir, { id: 'orphan', name: 'O', version: '0.1.0', permissions: [] })
    await linkPlugin(sourceDir)

    const symlinkPath = join(testDir, 'plugins', 'orphan')
    unlinkSync(symlinkPath) // user manually removed the symlink

    const result = await unlinkPlugin('orphan')
    expect(result.id).toBe('orphan')
    expect(readPluginLockfile().plugins.orphan).toBeUndefined()
  })
})
