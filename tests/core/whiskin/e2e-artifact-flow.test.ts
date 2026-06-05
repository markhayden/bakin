/**
 * Whiskin artifact-lane end-to-end (Phases 3+4+6): publish a built plugin,
 * serve the release over the hermetic host, then resolve → download → verify
 * checksum → safe-extract on the consumer side. No build backend, no live
 * install path, no browser — just the artifact data flow wired together.
 *
 * Mandatory isolation mocks per project rule (these modules don't read
 * ~/.bakin, but the harness requires the mocks).
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'

const mockDir = join(tmpdir(), `whiskin-e2e-mock-${Date.now()}-${randomUUID()}`)
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => mockDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => mockDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(mockDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(mockDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { startArtifactServer, type ArtifactServer } from '../../fixtures/whiskin-artifact-server'
import { assemblePluginArtifact, indexFromEntries } from '../../../src/core/whiskin/publish'
import { writeArtifactsIndex, NEUTRAL_PLATFORM, INDEX_FILENAME } from '../../../src/core/whiskin/artifacts-index'
import { httpIndexResolver } from '../../../src/core/whiskin/resolver'
import { materializeArtifact, WhiskinInstallError } from '../../../src/core/whiskin/consumer-install'

let host: ArtifactServer | null = null
const dirs: string[] = []
afterEach(async () => {
  if (host) {
    await host.stop()
    host = null
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function freshDir(prefix: string): string {
  const d = join(tmpdir(), `whiskin-${prefix}-${Date.now()}-${randomUUID()}`)
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}

function seedBuilt(): string {
  const dir = freshDir('built')
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify({ id: 'messaging', version: '0.1.0' }))
  writeFileSync(join(dir, 'index.ts'), 'export default {}\n')
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'index.js'), 'module.exports = {}\n')
  return dir
}

const FILENAME = `messaging-0.1.0-${NEUTRAL_PLATFORM}.tar.gz`

/** Publish a release into `releaseDir` served at `origin`, returning the sha. */
async function publishInto(releaseDir: string, origin: string): Promise<string> {
  const result = await assemblePluginArtifact({
    builtDir: seedBuilt(),
    pluginId: 'messaging',
    pluginVersion: '0.1.0',
    bakinVersion: '0.0.1-rc.15',
    bakinRange: '>=0.0.1-rc.15 <0.1.0',
    platform: NEUTRAL_PLATFORM,
    whiskinVersion: '1',
    buildBackend: 'system-bun',
    artifactUrl: `${origin}/${FILENAME}`,
    outDir: releaseDir,
    builtAt: '2026-06-04T00:00:00.000Z',
  })
  writeArtifactsIndex(join(releaseDir, INDEX_FILENAME), indexFromEntries([result.indexEntry]))
  return result.sha256
}

describe('Whiskin artifact lane end-to-end', () => {
  it('publish -> serve -> resolve -> download -> verify -> extract', async () => {
    const releaseDir = freshDir('release')
    host = await startArtifactServer(releaseDir)
    await publishInto(releaseDir, host.origin)

    const resolver = httpIndexResolver(host.origin)
    const materialized = await materializeArtifact(resolver, 'messaging', 'latest', 'darwin-arm64')
    try {
      expect(existsSync(join(materialized.stagingDir, 'bakin-plugin.json'))).toBe(true)
      expect(existsSync(join(materialized.stagingDir, 'dist', 'index.js'))).toBe(true)
      expect(existsSync(join(materialized.stagingDir, '.whiskin', 'build.json'))).toBe(true)
      expect(materialized.provenance.pluginId).toBe('messaging')
      expect(materialized.provenance.outputs.serverEntry).toBe('dist/index.js')
      // Plugin source never made it into the published artifact.
      expect(existsSync(join(materialized.stagingDir, 'index.ts'))).toBe(false)
    } finally {
      materialized.cleanup()
    }
  })

  it('rejects a tampered artifact with CHECKSUM_MISMATCH', async () => {
    const releaseDir = freshDir('release')
    host = await startArtifactServer(releaseDir)
    await publishInto(releaseDir, host.origin)

    // Tamper with the served artifact after the index recorded its checksum.
    writeFileSync(join(releaseDir, FILENAME), 'corrupted-bytes')

    const resolver = httpIndexResolver(host.origin)
    await expect(
      materializeArtifact(resolver, 'messaging', 'latest', 'darwin-arm64'),
    ).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' })
  })

  it('throws NO_PREBUILT_ARTIFACT for an unknown plugin', async () => {
    const releaseDir = freshDir('release')
    host = await startArtifactServer(releaseDir)
    await publishInto(releaseDir, host.origin)

    const resolver = httpIndexResolver(host.origin)
    await expect(
      materializeArtifact(resolver, 'does-not-exist', 'latest', 'darwin-arm64'),
    ).rejects.toBeInstanceOf(WhiskinInstallError)
  })
})
