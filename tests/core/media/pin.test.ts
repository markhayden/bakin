/**
 * Sharp prebuild pin shape (#889 T4). Pure data validation — no network;
 * the tarballs themselves are verified at install time (sha256 + probe).
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-media-pin-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { MEDIA_PLATFORM_KEYS, SHARP_PIN, mediaPlatformKey, pinnedTarballsFor } from '../../../packages/core/src/media/pin'

const SHA256_RE = /^[0-9a-f]{64}$/
const NPM_TARBALL_RE = /^https:\/\/registry\.npmjs\.org\/.+\.tgz$/

describe('SHARP_PIN', () => {
  it('pins a concrete sharp version', () => {
    expect(SHARP_PIN.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('carries the full shared JS set (sharp + its three runtime deps)', () => {
    const names = SHARP_PIN.shared.map((t) => t.name).sort()
    expect(names).toEqual(['@img/colour', 'detect-libc', 'semver', 'sharp'])
  })

  it('covers exactly the binary release platform matrix', () => {
    expect(Object.keys(SHARP_PIN.platform).sort()).toEqual([...MEDIA_PLATFORM_KEYS].sort())
  })

  it('every platform set is native + libvips for that platform', () => {
    for (const key of MEDIA_PLATFORM_KEYS) {
      const names = SHARP_PIN.platform[key].map((t) => t.name).sort()
      expect(names).toEqual([`@img/sharp-${key}`, `@img/sharp-libvips-${key}`].sort())
    }
  })

  it('every tarball entry has an immutable registry URL and a sha256 pin', () => {
    for (const t of [...SHARP_PIN.shared, ...Object.values(SHARP_PIN.platform).flat()]) {
      expect(t.url).toMatch(NPM_TARBALL_RE)
      expect(t.sha256).toMatch(SHA256_RE)
      expect(t.version).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('the sharp tarball version matches the pin version', () => {
    const sharp = SHARP_PIN.shared.find((t) => t.name === 'sharp')
    expect(sharp?.version).toBe(SHARP_PIN.version)
  })
})

describe('mediaPlatformKey / pinnedTarballsFor', () => {
  it('this test platform maps to a pinned key (or null on unsupported)', () => {
    const key = mediaPlatformKey()
    if (key) expect(MEDIA_PLATFORM_KEYS).toContain(key)
  })

  it('returns shared legs first, then the platform natives', () => {
    const tarballs = pinnedTarballsFor('darwin-arm64')
    expect(tarballs.length).toBe(6)
    expect(tarballs.slice(0, 4).map((t) => t.name)).toEqual(SHARP_PIN.shared.map((t) => t.name))
    expect(tarballs.at(-1)?.name).toBe('@img/sharp-libvips-darwin-arm64')
  })
})
