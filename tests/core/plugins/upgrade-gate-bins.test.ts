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

import { gateUpgradeConsent } from '../../../src/core/plugins/upgrade-gate'
import { consentBinsOf, sameBins } from '../../../src/core/plugins/consent-bins'
import { binPlatformKey } from '../../../src/core/agent-packages/bin-installer'
import type { BinRequirement } from '../../../packages/core/src/plugins/bin-requirement'
import type { PluginLockEntry } from '../../../packages/core/src/plugins/lockfile'
import type { Permission } from '../../../packages/core/src/plugins/permissions'

const A = 'a'.repeat(64)
const platform = binPlatformKey()!
const archive = (member: string): BinRequirement => ({
  name: 'tool', version: '1.0.0', install: { [platform]: { url: 'https://example.com/tool.tar.gz', sha256: A, archive: { format: 'tar.gz', member, extractedSha256: 'e'.repeat(64) } } },
})

describe('binary consent identity', () => {
  it('consent bins carry the member, and the token comparison sees a member change', () => {
    const a = consentBinsOf([archive('bin/tool-a')])
    const b = consentBinsOf([archive('bin/tool-b')])
    expect(a[0]!.member).toBe('bin/tool-a')
    expect(sameBins(a, consentBinsOf([archive('bin/tool-a')]))).toBe(true)
    expect(sameBins(a, b)).toBe(false)
  })
})

describe('gateUpgradeConsent — consent comes from the TARGET declaration, never the lockfile', () => {
  const before = { version: '1.0.0', commitSha: '' }
  const after = { version: '1.5.0', commitSha: '' }
  const entryWith = (over: Partial<PluginLockEntry> = {}): PluginLockEntry => ({
    source: 'github:markhayden/bakin-bits-official#plugins/terminal', type: 'github' as const, ref: '', commitSha: '',
    installedAt: '2026-10-01T00:00:00.000Z', version: '1.0.0', permissions: [] as Permission[], manifestSha: 'c'.repeat(64), ...over,
  })
  const manifest = { id: 'terminal', version: '1.5.0', permissions: ['events.emit'], requires: { bins: [archive('bin/tool-a')] } }

  it('a forged lock entry that already "has" every permission and binary cannot remove the prompt', () => {
    const forged = entryWith({ permissions: ['events.emit'], installedBins: [{ name: 'tool', sha256: A, member: 'bin/tool-a' }] })
    const gate = gateUpgradeConsent({ id: 'terminal', entry: forged, manifest, manifestSha: 'd'.repeat(64), before, after, opts: { previewOnly: true } })
    expect(gate).toMatchObject({ proceed: false, result: { awaitingConsent: true, declaredPermissions: ['events.emit'] } })
    if (gate.proceed) throw new Error('expected a prompt')
    expect(gate.result.declaredBins.map((b) => [b.name, b.member])).toEqual([['tool', 'bin/tool-a']])
  })

  it('unchanged declarations still prompt (and disclose everything)', () => {
    const gate = gateUpgradeConsent({ id: 'terminal', entry: entryWith({ permissions: ['events.emit'] }), manifest, manifestSha: 'd'.repeat(64), before, after, opts: {} })
    expect(gate).toMatchObject({ proceed: false, result: { awaitingConsent: true } })
  })

  it('a target that declares nothing needs no consent', () => {
    const empty = { id: 'terminal', version: '1.5.0', permissions: [] }
    const gate = gateUpgradeConsent({ id: 'terminal', entry: entryWith({ permissions: ['events.emit'] }), manifest: empty, manifestSha: 'd'.repeat(64), before, after, opts: { previewOnly: true } })
    expect(gate).toMatchObject({ proceed: false, result: { awaitingConsent: false, ready: true, declaredPermissions: [], declaredBins: [] } })
  })
})

describe('gateUpgradeConsent — a supplied consent always binds the release', () => {
  it('a commit whose manifest changed since the preview bounces back even when nothing new needs consent', async () => {
    const entry = {
      source: 'github:markhayden/bakin-bits-official#plugins/terminal', type: 'github' as const, ref: '', commitSha: '',
      installedAt: '2026-10-01T00:00:00.000Z', version: '1.0.0', permissions: [], manifestSha: 'c'.repeat(64),
    }
    const manifest = { id: 'terminal', version: '1.5.0', permissions: [] }
    const before = { version: '1.0.0', commitSha: '' }
    const after = { version: '1.5.0', commitSha: '' }
    const matching = gateUpgradeConsent({ id: 'terminal', entry, manifest, manifestSha: 'd'.repeat(64), before, after, opts: { accepted: { manifestSha: 'd'.repeat(64), permissions: [], bins: [] } } })
    expect(matching.proceed).toBe(true)
    const republished = gateUpgradeConsent({ id: 'terminal', entry, manifest, manifestSha: 'e'.repeat(64), before, after, opts: { accepted: { manifestSha: 'd'.repeat(64), permissions: [], bins: [] } } })
    expect(republished).toMatchObject({ proceed: false, result: { awaitingConsent: true, manifestChanged: true } })
  })
})

describe('computeUpgradeAvailable — artifact rebuilds', () => {
  it('a compatible rebuild under the installed version is still an upgrade', async () => {
    const { computeUpgradeAvailable } = await import('../../../packages/core/src/plugins/lockfile')
    const base = {
      source: 'github:markhayden/bakin-bits-official#plugins/terminal', type: 'github' as const, ref: '', commitSha: '',
      installedAt: '2026-10-01T00:00:00.000Z', version: '1.5.0', permissions: [], manifestSha: 'c'.repeat(64), remoteArtifactVersion: '1.5.0',
    }
    expect(computeUpgradeAvailable(base)).toBe(false)
    expect(computeUpgradeAvailable({ ...base, remoteArtifactRebuild: true })).toBe(true)
    expect(computeUpgradeAvailable({ ...base, remoteArtifactVersion: '1.6.0' })).toBe(true)
  })
})
