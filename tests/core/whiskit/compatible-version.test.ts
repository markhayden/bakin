/** Which published artifact a host can run: contract AND Bakin range, newest first. */
import { describe, expect, it } from 'bun:test'
import { newestCompatibleVersion, artifactRunsOn } from '../../../src/core/whiskit/compatible-version'
import type { ArtifactsIndex } from '../../../src/core/whiskit/artifacts-index'

const SHA = 'a'.repeat(64)
const entry = (externalsContract: string, bakinRange: string) => ({ url: 'https://example.test/a.tgz', sha256: SHA, externalsContract, bakinRange })

function index(versions: Record<string, Record<string, ReturnType<typeof entry>>>): ArtifactsIndex {
  const latest = Object.keys(versions).sort().at(-1)!
  return {
    version: 1,
    plugins: { projects: { latest, versions: Object.fromEntries(Object.entries(versions).map(([v, platforms]) => [v, { platforms }])) } },
  }
}

const HOST = { platform: 'darwin-arm64', hostContract: 'react19-sdk-focused-v1', hostVersion: '0.0.1-rc.41' }

describe('newestCompatibleVersion', () => {
  it('skips a newer release built for another contract family and returns the newest one this host runs', () => {
    const idx = index({
      '0.11.3': { neutral: entry('react19-sdk-makinbakin-v2', '>=0.0.1-rc.30') },
      '0.11.4': { neutral: entry('react19-sdk-focused-v1', '>=0.0.1-rc.41') },
      '0.12.0': { neutral: entry('react19-sdk-focused-v2', '>=0.0.1-rc.45') },
    })
    expect(newestCompatibleVersion(idx, 'projects', HOST)?.version).toBe('0.11.4')
  })

  it('honors the Bakin range: a release floored above this host is not compatible', () => {
    const idx = index({ '0.11.4': { neutral: entry('react19-sdk-focused-v1', '>=0.0.1-rc.42') } })
    expect(newestCompatibleVersion(idx, 'projects', HOST)).toBeNull()
  })

  it('prefers the platform artifact and falls back to neutral', () => {
    const idx = index({ '1.0.0': { 'linux-x64': entry('react19-sdk-focused-v1', '>=0.0.1-rc.1') } })
    expect(newestCompatibleVersion(idx, 'projects', HOST)).toBeNull()
    expect(newestCompatibleVersion(idx, 'projects', { ...HOST, platform: 'linux-x64' })?.version).toBe('1.0.0')
  })

  it('orders by semver, not by string (0.10.0 is newer than 0.9.0)', () => {
    const idx = index({
      '0.9.0': { neutral: entry('react19-sdk-focused-v1', '>=0.0.1-rc.1') },
      '0.10.0': { neutral: entry('react19-sdk-focused-v1', '>=0.0.1-rc.1') },
    })
    expect(newestCompatibleVersion(idx, 'projects', HOST)?.version).toBe('0.10.0')
  })

  it('an additive newer contract version within the family is not runnable on an older host', () => {
    expect(artifactRunsOn(entry('react19-sdk-focused-v2', '>=0.0.1-rc.1'), { hostContract: 'react19-sdk-focused-v1', hostVersion: '0.0.1-rc.41' })).toBe(false)
    expect(artifactRunsOn(entry('react19-sdk-focused-v1', '>=0.0.1-rc.1'), { hostContract: 'react19-sdk-focused-v2', hostVersion: '0.0.1-rc.41' })).toBe(true)
  })
})
