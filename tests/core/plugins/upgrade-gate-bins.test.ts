/**
 * Upgrade consent identity for binaries (review round 2): a changed archive
 * member is a NEW binary — it widens, and a consent token bound to the old
 * member does not match.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-upgrade-gate-bins-${Date.now()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
const paths = () => ({ root: testDir, home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') })
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))

import { diffNewBins } from '../../../src/core/plugins/upgrade-gate'
import { consentBinsOf, sameBins } from '../../../src/core/plugins/consent-bins'
import { binPlatformKey } from '../../../src/core/agent-packages/bin-installer'
import type { BinRequirement } from '../../../packages/core/src/plugins/bin-requirement'

const A = 'a'.repeat(64)
const platform = binPlatformKey()!
const archive = (member: string): BinRequirement => ({
  name: 'tool', version: '1.0.0', install: { [platform]: { url: 'https://example.com/tool.tar.gz', sha256: A, archive: { format: 'tar.gz', member } } },
})

describe('binary consent identity', () => {
  it('a different member of the same archive is a widening', () => {
    const recorded = [{ name: 'tool', sha256: A, member: 'bin/tool-a' }]
    expect(diffNewBins(recorded, [archive('bin/tool-a')])).toEqual([])
    expect(diffNewBins(recorded, [archive('bin/tool-b')]).map((b) => [b.name, b.member])).toEqual([['tool', 'bin/tool-b']])
    // A record without a member (raw download) against an archive declaration is a widening too.
    expect(diffNewBins([{ name: 'tool', sha256: A }], [archive('bin/tool-a')])).toHaveLength(1)
  })

  it('consent bins carry the member, and the token comparison sees a member change', () => {
    const a = consentBinsOf([archive('bin/tool-a')])
    const b = consentBinsOf([archive('bin/tool-b')])
    expect(a[0]!.member).toBe('bin/tool-a')
    expect(sameBins(a, consentBinsOf([archive('bin/tool-a')]))).toBe(true)
    expect(sameBins(a, b)).toBe(false)
  })
})
