/**
 * Install via a published Whiskit artifact through the REST handler (Phase 6
 * wiring). A `github:` source resolves a published artifact, downloads it,
 * verifies the checksum, safe-extracts it, and installs it — no git clone, no
 * build. Only `github-resolver` is mocked (to point at a hermetic host);
 * download/verify/extract run for real.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-install-artifact-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// Point the github resolver at the hermetic host; derive pluginId from subpath
// like the real implementation. `currentOrigin` is set once the host is up.
let currentOrigin = ''
mock.module('../../../src/core/whiskit/github-resolver', () => ({
  githubArtifactSource: (source: string) => {
    const { httpIndexResolver } = require('../../../src/core/whiskit/resolver')
    const subpath = source.split('#')[1] ?? ''
    const pluginId = subpath.split('/').filter(Boolean).pop()
    return { resolver: httpIndexResolver(currentOrigin, 'github'), pluginId, baseUrl: currentOrigin }
  },
}))

import { post as installPOST } from '../../../packages/host/src/api/plugins/install'
import { readPluginLockfile } from '../../../packages/core/src/plugins/lockfile'
import { startArtifactServer, type ArtifactServer } from '../../fixtures/whiskit-artifact-server'
import { assemblePluginArtifact, indexFromEntries } from '../../../src/core/whiskit/publish'
import { writeArtifactsIndex, NEUTRAL_PLATFORM, INDEX_FILENAME } from '../../../src/core/whiskit/artifacts-index'

let host: ArtifactServer | null = null
const releaseDir = join(testDir, 'release')
const ARTIFACT_FILE = `foo-1.0.0-${NEUTRAL_PLATFORM}.tar.gz`

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/plugins/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Build + publish a fresh "foo" artifact into the served release dir. */
async function publishFoo(manifestOverrides: Record<string, unknown> = {}): Promise<void> {
  const built = join(testDir, 'built-foo')
  rmSync(built, { recursive: true, force: true })
  mkdirSync(join(built, 'dist'), { recursive: true })
  writeFileSync(
    join(built, 'bakin-plugin.json'),
    JSON.stringify({
      id: 'foo',
      name: 'Foo',
      version: '1.0.0',
      bakin: '*',
      description: 'Foo artifact-install fixture',
            permissions: [],
      ...manifestOverrides,
    }),
  )
  writeFileSync(join(built, 'dist', 'index.js'), 'module.exports = {}\n')

  rmSync(releaseDir, { recursive: true, force: true })
  mkdirSync(releaseDir, { recursive: true })
  const result = await assemblePluginArtifact({
    builtDir: built,
    pluginId: 'foo',
    pluginVersion: '1.0.0',
    bakinVersion: '0.0.1-rc.15',
    bakinRange: '>=1.0.0',
    platform: NEUTRAL_PLATFORM,
    whiskitVersion: '1',
    buildBackend: 'system-bun',
    artifactUrl: `${currentOrigin}/${ARTIFACT_FILE}`,
    outDir: releaseDir,
    builtAt: '2026-06-04T00:00:00.000Z',
  })
  writeArtifactsIndex(join(releaseDir, INDEX_FILENAME), indexFromEntries([result.indexEntry]))
}

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  host = await startArtifactServer(releaseDir)
  currentOrigin = host.origin
})

afterAll(async () => {
  if (host) await host.stop()
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(async () => {
  rmSync(join(testDir, 'plugins'), { recursive: true, force: true })
  await publishFoo()
})

describe('install via published artifact (REST handler)', () => {
  it('installs a github plugin from a published artifact — no git, no build', async () => {
    const res = await installPOST(
      makeRequest({ source: 'github:markhayden/bakin-bits-official#plugins/foo', type: 'github' }),
      new URL('http://localhost/api/plugins/install'),
    )
    const json = (await res.json()) as { ok?: boolean; id?: string; error?: string }
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.id).toBe('foo')

    // Landed from the artifact: dist shipped + provenance present (not a build).
    expect(existsSync(join(testDir, 'plugins', 'foo', 'dist', 'index.js'))).toBe(true)
    expect(existsSync(join(testDir, 'plugins', 'foo', '.whiskit', 'build.json'))).toBe(true)
    // No staging or artifact-tarball leftovers.
    expect(existsSync(join(testDir, 'plugins', 'foo', '.whiskit-artifact.tar.gz'))).toBe(false)

    // Recorded in the lockfile as a github install.
    const entry = readPluginLockfile().plugins['foo']
    expect(entry).toBeDefined()
    expect(entry.version).toBe('1.0.0')
    expect(entry.type).toBe('github')
  })

  it('rejects a tampered artifact with a hard failure (no silent source fallback)', async () => {
    // Corrupt the served artifact after the index recorded its checksum.
    writeFileSync(join(testDir, 'release', `foo-1.0.0-${NEUTRAL_PLATFORM}.tar.gz`), 'tampered')
    const res = await installPOST(
      makeRequest({ source: 'github:markhayden/bakin-bits-official#plugins/foo', type: 'github' }),
      new URL('http://localhost/api/plugins/install'),
    )
    const json = (await res.json()) as { ok?: boolean; error?: string }
    expect(json.ok).toBe(false)
    expect(existsSync(join(testDir, 'plugins', 'foo'))).toBe(false)
  })

  it('rejects an artifact whose manifest carries the removed entry field (full parse, PR #635 review fix)', async () => {
    await publishFoo({ entry: { server: 'src/index.ts' } })
    const res = await installPOST(
      makeRequest({ source: 'github:markhayden/bakin-bits-official#plugins/foo', type: 'github' }),
      new URL('http://localhost/api/plugins/install'),
    )
    const json = (await res.json()) as { ok?: boolean; error?: string }
    expect(json.ok).toBe(false)
    expect(json.error).toContain('"entry" was removed')
    expect(existsSync(join(testDir, 'plugins', 'foo'))).toBe(false)
  })

  it('rejects an artifact with a malformed bakin range (gate applies to the artifact path too)', async () => {
    // Well-formedness is enforced even on dev hosts (satisfaction is skipped).
    await publishFoo({ bakin: 'banana' })
    const res = await installPOST(
      makeRequest({ source: 'github:markhayden/bakin-bits-official#plugins/foo', type: 'github' }),
      new URL('http://localhost/api/plugins/install'),
    )
    const json = (await res.json()) as { ok?: boolean; error?: string }
    expect(json.ok).toBe(false)
    expect(json.error).toContain('banana')
    expect(existsSync(join(testDir, 'plugins', 'foo'))).toBe(false)
  })
})
