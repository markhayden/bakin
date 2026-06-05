/**
 * Whiskit publish core (Phase 4): assemble a published artifact from a built
 * plugin dir + build the index. Fakes a built dir (dist/) rather than running a
 * real build. Mandatory isolation mocks per project rule.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'

const mockDir = join(tmpdir(), `whiskit-publish-mock-${Date.now()}-${randomUUID()}`)
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

import { assemblePluginArtifact, indexFromEntries } from '../../../src/core/whiskit/publish'
import { safeExtractArtifact } from '../../../src/core/whiskit/artifact'
import { readProvenance } from '../../../src/core/whiskit/provenance'
import { NEUTRAL_PLATFORM, resolveArtifact } from '../../../src/core/whiskit/artifacts-index'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function freshDir(prefix: string): string {
  const d = join(tmpdir(), `whiskit-${prefix}-${Date.now()}-${randomUUID()}`)
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}

/** A fake built plugin dir: manifest + dist + a stray SOURCE file + node_modules. */
function seedBuilt(): string {
  const dir = freshDir('built')
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify({ id: 'messaging', version: '0.1.0' }))
  writeFileSync(join(dir, 'index.ts'), 'export default {}\n') // source — must NOT end up in artifact
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'index.js'), 'module.exports = {}\n')
  writeFileSync(join(dir, 'dist', 'client.js'), 'console.log(1)\n')
  // node_modules (incl. host-provided externals) must NOT end up in the artifact.
  mkdirSync(join(dir, 'node_modules', 'react'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', 'react', 'index.js'), 'module.exports = {}\n')
  return dir
}

function input(builtDir: string, outDir: string) {
  return {
    builtDir,
    pluginId: 'messaging',
    pluginVersion: '0.1.0',
    bakinVersion: '0.0.1-rc.15',
    bakinRange: '>=0.0.1-rc.15 <0.1.0',
    platform: NEUTRAL_PLATFORM,
    whiskitVersion: '1',
    buildBackend: 'system-bun',
    artifactUrl: 'https://example/messaging-0.1.0-neutral.tar.gz',
    outDir,
    builtAt: '2026-06-04T00:00:00.000Z',
  }
}

describe('assemblePluginArtifact', () => {
  it('produces an artifact + sha256 sidecar + index entry, with provenance', async () => {
    const out = freshDir('out')
    const result = await assemblePluginArtifact(input(seedBuilt(), out))

    expect(existsSync(result.artifactPath)).toBe(true)
    expect(existsSync(`${result.artifactPath}.sha256`)).toBe(true)
    expect(readFileSync(`${result.artifactPath}.sha256`, 'utf-8')).toContain(result.sha256)
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.provenance.outputs.clientEntry).toBe('dist/client.js')
    expect(result.provenance.sourceTreeSha).toMatch(/^[0-9a-f]{64}$/)
    expect(result.indexEntry.entry.sha256).toBe(result.sha256)
  })

  it('excludes plugin SOURCE files from the artifact (allow-list only)', async () => {
    const out = freshDir('out')
    const result = await assemblePluginArtifact(input(seedBuilt(), out))

    const dest = freshDir('extract')
    await safeExtractArtifact(result.artifactPath, dest)
    expect(existsSync(join(dest, 'bakin-plugin.json'))).toBe(true)
    expect(existsSync(join(dest, 'dist', 'index.js'))).toBe(true)
    expect(existsSync(join(dest, '.whiskit', 'build.json'))).toBe(true)
    // The stray index.ts source must not be present.
    expect(existsSync(join(dest, 'index.ts'))).toBe(false)
    // node_modules (host-provided externals) must not be shipped in v1.
    expect(existsSync(join(dest, 'node_modules'))).toBe(false)
    // Provenance inside the artifact is readable + valid.
    expect(readProvenance(join(dest, '.whiskit', 'build.json')).pluginId).toBe('messaging')
  })

  it('throws when dist/index.js is missing (not built)', async () => {
    const dir = freshDir('unbuilt')
    writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify({ id: 'x', version: '0.1.0' }))
    await expect(assemblePluginArtifact(input(dir, freshDir('out')))).rejects.toThrow(/not found/i)
  })

  it('builds an index that resolves the published artifact', async () => {
    const out = freshDir('out')
    const result = await assemblePluginArtifact(input(seedBuilt(), out))
    const index = indexFromEntries([result.indexEntry])
    const resolved = resolveArtifact(index, 'messaging', 'latest', 'darwin-arm64')
    expect(resolved?.url).toBe('https://example/messaging-0.1.0-neutral.tar.gz')
    expect(resolved?.sha256).toBe(result.sha256)
  })
})
