/**
 * whiskin-artifacts.json schema, resolver, and carry-forward merge (Phase 3).
 *
 * Pure module over temp files; mandatory isolation mocks added per project rule.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, writeFileSync } from 'fs'

const mockDir = join(tmpdir(), `whiskin-index-mock-${Date.now()}-${randomUUID()}`)
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
  ARTIFACTS_INDEX_VERSION,
  NEUTRAL_PLATFORM,
  parseArtifactsIndex,
  readArtifactsIndex,
  writeArtifactsIndex,
  resolveArtifact,
  mergeArtifactsIndex,
  emptyArtifactsIndex,
  type ArtifactsIndex,
} from '../../../src/core/whiskin/artifacts-index'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function freshDir(): string {
  const d = join(tmpdir(), `whiskin-index-test-${Date.now()}-${randomUUID()}`)
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}

const SHA = 'a'.repeat(64)
function entry(url: string) {
  return { url, sha256: SHA, externalsContract: 'react19-sdk-makinbakin-v1', bakinRange: '>=0.0.1-rc.15 <0.1.0' }
}
function indexWith(pluginId: string, version: string, platform: string, url: string): ArtifactsIndex {
  return {
    version: ARTIFACTS_INDEX_VERSION,
    plugins: { [pluginId]: { latest: version, versions: { [version]: { platforms: { [platform]: entry(url) } } } } },
  }
}

describe('artifacts index schema + IO', () => {
  it('round-trips through write + read', () => {
    const dir = freshDir()
    const path = join(dir, 'whiskin-artifacts.json')
    const idx = indexWith('messaging', '0.1.0', NEUTRAL_PLATFORM, 'https://x/m.tar.gz')
    writeArtifactsIndex(path, idx)
    expect(readArtifactsIndex(path)).toEqual(idx)
  })

  it('rejects a malformed sha256', () => {
    const bad = indexWith('m', '0.1.0', NEUTRAL_PLATFORM, 'u')
    bad.plugins.m.versions['0.1.0'].platforms[NEUTRAL_PLATFORM].sha256 = 'nope'
    expect(() => parseArtifactsIndex(bad)).toThrow()
  })

  it('rejects non-JSON on disk', () => {
    const dir = freshDir()
    const path = join(dir, 'whiskin-artifacts.json')
    writeFileSync(path, '{bad', 'utf-8')
    expect(() => readArtifactsIndex(path)).toThrow(/not valid JSON/i)
  })
})

describe('resolveArtifact', () => {
  const idx: ArtifactsIndex = {
    version: ARTIFACTS_INDEX_VERSION,
    plugins: {
      messaging: {
        latest: '0.2.0',
        versions: {
          '0.1.0': { platforms: { [NEUTRAL_PLATFORM]: entry('u-0.1.0') } },
          '0.2.0': { platforms: { 'darwin-arm64': entry('u-darwin'), [NEUTRAL_PLATFORM]: entry('u-neutral') } },
        },
      },
    },
  }

  it('resolves an exact platform match', () => {
    expect(resolveArtifact(idx, 'messaging', '0.2.0', 'darwin-arm64')?.url).toBe('u-darwin')
  })
  it('falls back to the neutral artifact', () => {
    expect(resolveArtifact(idx, 'messaging', '0.2.0', 'linux-x64')?.url).toBe('u-neutral')
  })
  it('resolves "latest" to the latest version', () => {
    expect(resolveArtifact(idx, 'messaging', 'latest', 'darwin-arm64')?.url).toBe('u-darwin')
  })
  it('returns null for an unknown plugin/version/platform', () => {
    expect(resolveArtifact(idx, 'nope', 'latest', 'darwin-arm64')).toBeNull()
    expect(resolveArtifact(idx, 'messaging', '9.9.9', 'darwin-arm64')).toBeNull()
    expect(resolveArtifact(idx, 'messaging', '0.1.0', 'darwin-arm64')?.url).toBe('u-0.1.0') // neutral fallback
  })
})

describe('mergeArtifactsIndex (carry-forward)', () => {
  it('carries forward untouched plugins and overlays the rebuilt one', () => {
    const previous = mergeArtifactsIndex(
      emptyArtifactsIndex(),
      indexWith('projects', '0.1.0', NEUTRAL_PLATFORM, 'p-old'),
    )
    const withMessaging = mergeArtifactsIndex(
      previous,
      indexWith('messaging', '0.1.0', NEUTRAL_PLATFORM, 'm-0.1.0'),
    )
    // A second messaging release: projects + messaging@0.1.0 must carry forward.
    const next = mergeArtifactsIndex(
      withMessaging,
      indexWith('messaging', '0.2.0', NEUTRAL_PLATFORM, 'm-0.2.0'),
    )

    expect(resolveArtifact(next, 'projects', 'latest', 'x')?.url).toBe('p-old') // carried forward
    expect(next.plugins.messaging.latest).toBe('0.2.0') // pointer updated
    expect(resolveArtifact(next, 'messaging', '0.1.0', 'x')?.url).toBe('m-0.1.0') // old version retained
    expect(resolveArtifact(next, 'messaging', '0.2.0', 'x')?.url).toBe('m-0.2.0') // new version added
  })
})
