/**
 * Whiskin artifact assemble / checksum / safe-extract (Phase 3).
 *
 * Uses real `tar` (present on macOS/Linux) over temp dirs; no network, no
 * ~/.bakin/~/.openclaw. Mandatory isolation mocks added per project rule.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, symlinkSync } from 'fs'

const mockDir = join(tmpdir(), `whiskin-artifact-mock-${Date.now()}-${randomUUID()}`)
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

import {
  assembleArtifact,
  computeSha256,
  verifyChecksum,
  safeExtractArtifact,
  validateArtifactListing,
  ArtifactError,
} from '../../../src/core/whiskin/artifact'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function freshDir(): string {
  const d = join(tmpdir(), `whiskin-artifact-test-${Date.now()}-${randomUUID()}`)
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}

/** A minimal valid artifact staging layout. */
function seedStaging(): string {
  const staging = freshDir()
  writeFileSync(join(staging, 'bakin-plugin.json'), JSON.stringify({ id: 'p', version: '0.1.0' }))
  mkdirSync(join(staging, 'dist'), { recursive: true })
  writeFileSync(join(staging, 'dist', 'index.js'), 'export default {}\n')
  mkdirSync(join(staging, '.whiskin'), { recursive: true })
  writeFileSync(join(staging, '.whiskin', 'build.json'), '{}')
  return staging
}

describe('whiskin artifact assemble + checksum', () => {
  it('assembles a tarball, hashes it, and verifies the checksum', async () => {
    const out = freshDir()
    const tarball = join(out, 'p-0.1.0.tar.gz')
    await assembleArtifact(seedStaging(), tarball)
    expect(existsSync(tarball)).toBe(true)

    const sha = await computeSha256(tarball)
    expect(sha).toMatch(/^[0-9a-f]{64}$/)
    await expect(verifyChecksum(tarball, sha)).resolves.toBeUndefined()
  })

  it('throws CHECKSUM_MISMATCH on a wrong checksum', async () => {
    const out = freshDir()
    const tarball = join(out, 'p.tar.gz')
    await assembleArtifact(seedStaging(), tarball)
    await expect(verifyChecksum(tarball, 'f'.repeat(64))).rejects.toMatchObject({
      code: 'CHECKSUM_MISMATCH',
    })
  })
})

describe('whiskin artifact safe extraction', () => {
  it('round-trips an artifact into a dest dir', async () => {
    const out = freshDir()
    const tarball = join(out, 'p.tar.gz')
    await assembleArtifact(seedStaging(), tarball)

    const dest = freshDir()
    await safeExtractArtifact(tarball, dest)
    expect(existsSync(join(dest, 'bakin-plugin.json'))).toBe(true)
    expect(readFileSync(join(dest, 'dist', 'index.js'), 'utf-8')).toContain('export default')
  })

  it('rejects a symlink in the artifact', async () => {
    const staging = seedStaging()
    // A symlink whose NAME is safe (dist/link) still gets rejected post-extract.
    symlinkSync('/etc/hosts', join(staging, 'dist', 'link'))
    const out = freshDir()
    const tarball = join(out, 'p.tar.gz')
    await assembleArtifact(staging, tarball)

    const dest = freshDir()
    await expect(safeExtractArtifact(tarball, dest)).rejects.toMatchObject({
      code: 'UNSAFE_ARTIFACT',
    })
  })
})

describe('validateArtifactListing', () => {
  it('accepts a normal listing', () => {
    expect(() =>
      validateArtifactListing('./\n./bakin-plugin.json\n./dist/\n./dist/index.js\n./.whiskin/build.json\n'),
    ).not.toThrow()
  })

  const bad: Array<[string, string]> = [
    ['absolute path', '/etc/passwd\n'],
    ['parent traversal', 'dist/../../escape\n'],
    ['dot segment', 'dist/./x\n'],
    ['backslash', 'dist\\evil\n'],
    ['unexpected top-level', 'evil/x\n'],
  ]
  for (const [label, listing] of bad) {
    it(`rejects ${label}`, () => {
      expect(() => validateArtifactListing(listing)).toThrow(ArtifactError)
    })
  }
})
