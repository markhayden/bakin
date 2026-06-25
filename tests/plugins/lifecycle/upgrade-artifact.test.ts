/**
 * Artifact-lane check + upgrade (Whiskit P8).
 *
 * An artifact-installed plugin (`.whiskit/build.json` provenance present)
 * must check and upgrade through the published-artifact pipeline — resolve
 * the immutable index, compare versions, refetch + verify + atomically
 * replace — never `git clone` + rebuild on the consumer's machine.
 *
 * Hermetic: artifacts are published into a local dir served over an
 * ephemeral localhost port; the github resolver module is mocked to point
 * at it. Mandatory isolation mocks per project rule.
 */
import { describe, it, expect, afterAll, afterEach, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-upgrade-artifact-${Date.now()}-${randomUUID()}`)
const openClawDir = join(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = openClawDir

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('@/core/plugin-registry', () => ({
  isCorePlugin: () => false,
}))
// Point the github resolver at the local artifact host. `currentBaseUrl` is
// set per-test after the ephemeral server starts.
let currentBaseUrl = ''
mock.module('@/core/whiskit/github-resolver', () => {
  const { httpIndexResolver } = require('../../../src/core/whiskit/resolver') as typeof import('../../../src/core/whiskit/resolver')
  return {
    githubArtifactSource: (source: string) => ({
      resolver: httpIndexResolver(currentBaseUrl, 'github'),
      pluginId: source.split('/').filter(Boolean).pop()!,
      baseUrl: currentBaseUrl,
    }),
  }
})

import { startArtifactServer, type ArtifactServer } from '../../fixtures/whiskit-artifact-server'
import { assemblePluginArtifact, indexFromEntries } from '../../../src/core/whiskit/publish'
import {
  INDEX_FILENAME,
  NEUTRAL_PLATFORM,
  mergeArtifactsIndex,
  readArtifactsIndex,
  writeArtifactsIndex,
} from '../../../src/core/whiskit/artifacts-index'
import { installArtifact } from '../../../src/core/whiskit/live-install'
import { httpIndexResolver } from '../../../src/core/whiskit/resolver'
import { readPluginLockfile } from '../../../packages/core/src/plugins/lockfile'
import { isArtifactInstall, runChecks, upgradePlugin } from '../../../src/core/plugins/upgrade'

const SOURCE = 'github:markhayden/bakin-bits-official#plugins/messaging'
const PLATFORM = `${process.platform}-${process.arch}`

let host: ArtifactServer | null = null
let releaseDir = ''

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(async () => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  releaseDir = join(testDir, 'release')
  mkdirSync(releaseDir, { recursive: true })
  host = await startArtifactServer(releaseDir)
  currentBaseUrl = host.origin
})

afterEach(async () => {
  if (host) {
    await host.stop()
    host = null
  }
})

/** Publish version `v` of "messaging" into the release dir (index merged). */
async function publishVersion(v: string, permissions: string[] = ['storage.read']): Promise<void> {
  const builtDir = join(testDir, `built-${v}`)
  mkdirSync(join(builtDir, 'dist'), { recursive: true })
  writeFileSync(join(builtDir, 'bakin-plugin.json'), JSON.stringify({
    id: 'messaging', name: 'Messaging', version: v, bakin: '>=0.0.1',
    description: 'fixture', entry: { server: 'index.ts' }, permissions,
  }))
  writeFileSync(join(builtDir, 'dist', 'index.js'), `export default { id: 'messaging', version: '${v}', activate() {} }\n`)

  const filename = `messaging-${v}-${NEUTRAL_PLATFORM}.tar.gz`
  const result = await assemblePluginArtifact({
    builtDir,
    pluginId: 'messaging',
    pluginVersion: v,
    bakinVersion: '0.0.1-rc.16',
    bakinRange: '>=0.0.1',
    platform: NEUTRAL_PLATFORM,
    whiskitVersion: '1',
    buildBackend: 'system-bun',
    artifactUrl: `${host!.origin}/${filename}`,
    outDir: releaseDir,
    builtAt: '2026-06-05T00:00:00.000Z',
  })
  const indexPath = join(releaseDir, INDEX_FILENAME)
  const fresh = indexFromEntries([result.indexEntry])
  const index = existsSync(indexPath)
    ? mergeArtifactsIndex(readArtifactsIndex(indexPath), fresh)
    : fresh
  writeArtifactsIndex(indexPath, index)
}

/** Install messaging@<v> the way the live consumer path does. */
async function installVersion(v: string): Promise<string> {
  const { installDir } = await installArtifact({
    resolver: httpIndexResolver(host!.origin, 'github'),
    source: SOURCE,
    pluginId: 'messaging',
    version: v,
    platform: PLATFORM,
  })
  return installDir
}

describe('artifact-lane check (runChecks)', () => {
  it('reports the latest published version instead of probing git', async () => {
    await publishVersion('0.1.0')
    const installDir = await installVersion('0.1.0')
    expect(isArtifactInstall(installDir)).toBe(true)

    // Same version published — no upgrade.
    let results = await runChecks(['messaging'])
    expect(results[0].error).toBeUndefined()
    expect(results[0].upgradeAvailable).toBe(false)
    expect(results[0].remoteArtifactVersion).toBe('0.1.0')

    // New version published — upgrade available, marker persisted.
    await publishVersion('0.2.0')
    results = await runChecks(['messaging'])
    expect(results[0].upgradeAvailable).toBe(true)
    expect(results[0].remoteArtifactVersion).toBe('0.2.0')

    const entry = readPluginLockfile().plugins['messaging']
    expect(entry.remoteArtifactVersion).toBe('0.2.0')
    expect(entry.lastChecked).toBeDefined()
  })
})

describe('artifact-lane upgrade (upgradePlugin)', () => {
  it('refetches the latest artifact and atomically replaces the install', async () => {
    await publishVersion('0.1.0')
    const installDir = await installVersion('0.1.0')
    await publishVersion('0.2.0')

    const result = await upgradePlugin('messaging')
    expect(result.noop).toBe(false)
    expect(result.awaitingConsent).toBe(false)
    expect(result.before.version).toBe('0.1.0')
    expect(result.after.version).toBe('0.2.0')

    // Disk replaced with the new artifact (still provenance-carrying).
    const manifest = JSON.parse(readFileSync(join(installDir, 'bakin-plugin.json'), 'utf-8')) as { version: string }
    expect(manifest.version).toBe('0.2.0')
    expect(readFileSync(join(installDir, 'dist', 'index.js'), 'utf-8')).toContain("version: '0.2.0'")
    expect(isArtifactInstall(installDir)).toBe(true)

    // Lockfile updated.
    const entry = readPluginLockfile().plugins['messaging']
    expect(entry.version).toBe('0.2.0')
    expect(entry.upgradedAt).toBeDefined()
    expect(entry.remoteArtifactVersion).toBe('0.2.0')
  })

  it('is a no-op when already on the latest published version', async () => {
    await publishVersion('0.1.0')
    await installVersion('0.1.0')

    const result = await upgradePlugin('messaging')
    expect(result.noop).toBe(true)
    expect(result.after.version).toBe('0.1.0')
  })

  it('gates widened permissions behind consent without touching disk', async () => {
    await publishVersion('0.1.0')
    const installDir = await installVersion('0.1.0')
    await publishVersion('0.2.0', ['storage.read', 'storage.write', 'events.emit'])

    const pending = await upgradePlugin('messaging')
    expect(pending.awaitingConsent).toBe(true)
    expect(pending.newPermissions.sort()).toEqual(['events.emit', 'storage.write'])

    // Nothing mutated before consent.
    const manifest = JSON.parse(readFileSync(join(installDir, 'bakin-plugin.json'), 'utf-8')) as { version: string }
    expect(manifest.version).toBe('0.1.0')
    expect(readPluginLockfile().plugins['messaging'].version).toBe('0.1.0')

    // Consent accepted — upgrade lands, permissions recorded.
    const accepted = await upgradePlugin('messaging', { yes: true })
    expect(accepted.awaitingConsent).toBe(false)
    expect(accepted.after.version).toBe('0.2.0')
    const entry = readPluginLockfile().plugins['messaging']
    expect(entry.permissions.sort()).toEqual(['events.emit', 'storage.read', 'storage.write'])
  })
})
