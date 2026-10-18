/** Which published artifact a host can run: contract AND Bakin range, newest first. */
import { describe, expect, it } from 'bun:test'
import { newestCompatibleVersion, artifactRunsOn, artifactUpgradeTarget } from '../../../src/core/whiskit/compatible-version'
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

describe('artifactUpgradeTarget (the one upgrade decision)', () => {
  it('a working install only moves forward; a published rollback below it is not an upgrade', () => {
    expect(artifactUpgradeTarget('1.5.0', true, '1.6.0')).toBe('1.6.0')
    expect(artifactUpgradeTarget('1.5.0', true, '1.5.0')).toBeNull()
    expect(artifactUpgradeTarget('1.5.0', true, '1.4.0')).toBeNull()
    expect(artifactUpgradeTarget('1.5.0', true, null)).toBeNull()
  })

  it('a stranded install takes ANY compatible release, including a same-version rebuild or an older one', () => {
    expect(artifactUpgradeTarget('1.5.0', false, '1.5.0')).toBe('1.5.0')
    expect(artifactUpgradeTarget('1.5.0', false, '1.4.0')).toBe('1.4.0')
    expect(artifactUpgradeTarget('1.5.0', false, null)).toBeNull()
  })

  it('an installed artifact out of its Bakin range does not run, even with a matching contract', () => {
    expect(artifactRunsOn({ externalsContract: 'react19-sdk-focused-v1', bakinRange: '>=0.0.1-rc.50' }, { hostContract: 'react19-sdk-focused-v1', hostVersion: '0.0.1-rc.41' })).toBe(false)
  })
})
