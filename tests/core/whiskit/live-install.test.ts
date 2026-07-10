/**
 * Live artifact install (Phase 6): a published artifact lands in the content
 * dir + plugin lockfile, toolchain-free. Mocks content-dir so the install
 * targets a temp ~/.bakin.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-whiskit-live-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { startArtifactServer, type ArtifactServer } from '../../fixtures/whiskit-artifact-server'
import { assemblePluginArtifact, indexFromEntries } from '../../../src/core/whiskit/publish'
import { writeArtifactsIndex, NEUTRAL_PLATFORM, INDEX_FILENAME } from '../../../src/core/whiskit/artifacts-index'
import { httpIndexResolver } from '../../../src/core/whiskit/resolver'
import { installArtifact } from '../../../src/core/whiskit/live-install'
import { readPluginLockfile } from '../../../packages/core/src/plugins/lockfile'

let host: ArtifactServer | null = null
const extraDirs: string[] = []

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})
beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

function freshDir(prefix: string): string {
  const d = pathJoin(tmpdir(), `whiskit-${prefix}-${Date.now()}-${randomUUID()}`)
  mkdirSync(d, { recursive: true })
  extraDirs.push(d)
  return d
}

async function publishServedPlugin(origin: string): Promise<string> {
  const built = freshDir('built')
  writeFileSync(
    join(built, 'bakin-plugin.json'),
    JSON.stringify({
      id: 'messaging',
      name: 'Messaging',
      version: '0.1.0',
      bakin: '>=0.0.1',
      description: 'live-install fixture',
      permissions: ['storage.read'],
    }),
  )
  mkdirSync(join(built, 'dist'), { recursive: true })
  writeFileSync(join(built, 'dist', 'index.js'), 'module.exports = {}\n')
  writeFileSync(join(built, 'dist', 'client.js'), 'console.log(1)\n')

  const releaseDir = freshDir('release')
  const filename = `messaging-0.1.0-${NEUTRAL_PLATFORM}.tar.gz`
  const result = await assemblePluginArtifact({
    builtDir: built,
    pluginId: 'messaging',
    pluginVersion: '0.1.0',
    bakinVersion: '0.0.1-rc.15',
    bakinRange: '>=0.0.1-rc.1',
    platform: NEUTRAL_PLATFORM,
    whiskitVersion: '1',
    buildBackend: 'system-bun',
    artifactUrl: `${origin}/${filename}`,
    outDir: releaseDir,
    builtAt: '2026-06-04T00:00:00.000Z',
  })
  writeArtifactsIndex(join(releaseDir, INDEX_FILENAME), indexFromEntries([result.indexEntry]))
  return releaseDir
}

describe('installArtifact (live consumer install)', () => {
  it('installs a published artifact into the content dir + lockfile', async () => {
    const releaseDir = await (async () => {
      // Serve a placeholder dir first to get the origin, then publish into it.
      const dir = freshDir('serve')
      host = await startArtifactServer(dir)
      const published = await publishServedPlugin(host.origin)
      // Move published files into the served dir.
      const { cpSync } = await import('fs')
      cpSync(published, dir, { recursive: true })
      return dir
    })()
    expect(existsSync(releaseDir)).toBe(true)

    const resolver = httpIndexResolver(host!.origin)
    const result = await installArtifact({
      resolver,
      source: 'github:markhayden/bakin-bits-official#plugins/messaging',
      pluginId: 'messaging',
      version: 'latest',
      platform: 'darwin-arm64',
    })

    // Landed in the content dir.
    expect(result.installDir).toBe(join(testDir, 'plugins', 'messaging'))
    expect(existsSync(join(testDir, 'plugins', 'messaging', 'bakin-plugin.json'))).toBe(true)
    expect(existsSync(join(testDir, 'plugins', 'messaging', 'dist', 'index.js'))).toBe(true)
    expect(existsSync(join(testDir, 'plugins', 'messaging', '.whiskit', 'build.json'))).toBe(true)

    // Recorded in the lockfile.
    const entry = readPluginLockfile().plugins['messaging']
    expect(entry).toBeDefined()
    expect(entry.version).toBe('0.1.0')
    expect(entry.type).toBe('github')
    expect(entry.permissions).toContain('storage.read')

    // No staging leftover.
    expect(existsSync(join(testDir, '.whiskit-staging'))).toBe(false)
  })

  it('throws NO_PREBUILT_ARTIFACT for a plugin not in the index', async () => {
    const dir = freshDir('serve')
    host = await startArtifactServer(dir)
    const published = await publishServedPlugin(host.origin)
    const { cpSync } = await import('fs')
    cpSync(published, dir, { recursive: true })

    const resolver = httpIndexResolver(host.origin)
    await expect(
      installArtifact({
        resolver,
        source: 'github:owner/repo#plugins/ghost',
        pluginId: 'ghost',
        version: 'latest',
        platform: 'darwin-arm64',
      }),
    ).rejects.toMatchObject({ code: 'NO_PREBUILT_ARTIFACT' })
  })
})

afterAll(() => {
  if (host) void host.stop()
  for (const d of extraDirs) rmSync(d, { recursive: true, force: true })
})
