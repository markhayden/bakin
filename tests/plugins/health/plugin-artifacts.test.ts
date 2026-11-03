/**
 * plugin-artifacts health check (P9 surfacing). Scans installed plugins for
 * needs-update / invalid Whiskit provenance.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-plugin-artifacts-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { checkPluginArtifacts, type PluginArtifactDeps } from '../../../plugins/health/lib/system-checks/plugin-artifacts'
import type { UpdateRecord } from '@makinbakin/sdk/types'
import { writeProvenance, WHISKIT_PROVENANCE_VERSION, type WhiskitBuildProvenance } from '../../../src/core/whiskit/provenance'
import { EXTERNALS_CONTRACT } from '../../../src/core/whiskit/externals'
import type { HealthCheckRunInput } from '@makinbakin/sdk'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'

function observed(run: HealthCheckRunInput) {
  const parsed = parseHealthCheckRunInput(run)
  expect(parsed.outcome).toBe('observed')
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}

function installPlugin(id: string, externalsContract: string): void {
  const dir = join(testDir, 'plugins', id)
  mkdirSync(join(dir, '.whiskit'), { recursive: true })
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify({ id, version: '1.0.0' }))
  const prov: WhiskitBuildProvenance = {
    version: WHISKIT_PROVENANCE_VERSION,
    pluginId: id,
    pluginVersion: '1.0.0',
    bakinVersion: '0.0.1-rc.15',
    bakinRange: '>=0.0.1-rc.1',
    whiskitVersion: '1',
    buildBackend: 'system-bun',
    platform: 'neutral',
    sourceCommitSha: '',
    sourceTreeSha: 'a'.repeat(64),
    manifestSha: 'b'.repeat(64),
    externalsContract,
    approvedInstallScripts: [],
    outputs: { serverEntry: 'dist/index.js' },
    builtAt: '2026-06-04T00:00:00.000Z',
  }
  writeProvenance(join(dir, '.whiskit', 'build.json'), prov)
}

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => {
  rmSync(join(testDir, 'plugins'), { recursive: true, force: true })
  mkdirSync(join(testDir, 'plugins'), { recursive: true })
})

describe('checkPluginArtifacts', () => {
  it('is healthy when no plugins are installed', async () => {
    rmSync(join(testDir, 'plugins'), { recursive: true, force: true })
    expect(observed(await checkPluginArtifacts())[0].status).toBe('healthy')
  })

  it('is healthy when all installed artifacts are compatible', async () => {
    installPlugin('foo', EXTERNALS_CONTRACT)
    expect(observed(await checkPluginArtifacts())[0].status).toBe('healthy')
  })

  it('warns about a needs-update artifact (incompatible externals contract)', async () => {
    installPlugin('foo', EXTERNALS_CONTRACT)
    installPlugin('stale', 'react18-old-vX')
    const r = observed(await checkPluginArtifacts())[0]
    expect(r.status).toBe('warning')
    expect(r.summary).toContain('stale')
    expect(r.summary).toContain('compatible update')
    expect(r.incident?.disposition).toBe('action_required')
  })
})

describe('checkPluginArtifacts — what the source offers this host', () => {
  function lockEntry(id: string, version = '1.0.0') {
    writeFileSync(join(testDir, 'plugins', 'lock.json'), JSON.stringify({
      version: 1,
      plugins: {
        [id]: {
          source: `github:markhayden/bakin-bits-official#plugins/${id}`,
          type: 'github',
          ref: '',
          commitSha: '',
          installedAt: '2026-10-01T00:00:00.000Z',
          version,
          permissions: [],
          manifestSha: 'c'.repeat(64),
        },
      },
    }))
  }
  const record = (over: Partial<UpdateRecord> & Pick<UpdateRecord, 'outcome'>): UpdateRecord => ({
    id: 'plugin:stale',
    group: 'available',
    subject: { kind: 'plugin', id: 'stale', label: 'stale' },
    source: { kind: 'artifact-index', endpoint: 'https://example.test/index.json' },
    fingerprint: 'fp',
    observedAt: '2026-10-19T12:00:00.000Z',
    attempt: { at: '2026-10-19T12:00:00.000Z' },
    ...over,
  })
  /** The engine's record: a compatible release on offer, or blocked with the engine's reason. */
  const offering = (compatible: string | null, latest = '2.0.0'): PluginArtifactDeps => ({
    record: async () => (compatible
      ? record({ outcome: 'update-available', installed: { version: '1.0.0', display: '1.0.0' }, available: { version: compatible, display: compatible }, reason: 'newer-version' })
      : record({ outcome: 'blocked', blockedReason: `no published release of stale runs on this Bakin yet (newest is ${latest})` })),
  })

  it('a compatible release becomes a one-click upgrade repair', async () => {
    installPlugin('stale', 'react18-old-vX')
    lockEntry('stale')
    const [row] = observed(await checkPluginArtifacts(offering('1.5.0')))
    expect(row.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'plugin-upgrade', label: 'Install 1.5.0 for this Bakin' })
    expect(row.evidence).toMatchObject({ compatibleVersion: '1.5.0', updateObservedAt: '2026-10-19T12:00:00.000Z' })
  })

  it('no compatible release yet says so instead of pointing at an upgrade that would refuse', async () => {
    installPlugin('stale', 'react18-old-vX')
    lockEntry('stale')
    const [row] = observed(await checkPluginArtifacts(offering(null, '2.0.0')))
    // Row 98: upstream-blocked is the operator's decision on the plugin's Explore card (wait, or disable — the card choice);
    // the reason rides the impact copy. This fixture declares no contributions, so it is advisory (see plugin-disable.test.ts).
    expect(row.incident?.resolution).toMatchObject({ type: 'human', needs: 'decision', key: 'await-compatible-release', href: '/explore?tab=plugins&item=plugin:stale' })
    expect(row.incident?.resolution.choices?.map((choice) => choice.key)).toEqual(['disable-plugin', 'updates'])
    expect(row.incident).toMatchObject({ declarationId: 'needs-update-blocked', required: false, disposition: 'advisory' })
    expect(row.incident?.impact).toContain('newest is 2.0.0')
  })

  it('no record, no successful observation, or a record read that throws offers the reinstall of the recorded install (never a fake upgrade)', async () => {
    installPlugin('stale', 'react18-old-vX')
    lockEntry('stale')
    const none = observed(await checkPluginArtifacts({ record: async () => undefined }))[0]
    expect(none.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'plugin-reinstall' })
    expect(none.evidence).toMatchObject({ updateObservedAt: null })

    const failed = observed(await checkPluginArtifacts({ record: async () => record({ outcome: 'unknown', observedAt: undefined, attempt: { at: 'now', error: 'index: 503' } }) }))[0]
    expect(failed.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'plugin-reinstall' })
    expect(failed.evidence).toMatchObject({ updateObservedAt: null, updateCheckError: 'index: 503' })

    const threw = observed(await checkPluginArtifacts({ record: async () => { throw new Error('engine gone') } }))[0]
    expect(threw.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'plugin-reinstall' })
  })

  it('review r1 #8: a failed attempt after a retained offer or a blocked verdict is never hidden — the offer stands AND the error is in evidence', async () => {
    installPlugin('stale', 'react18-old-vX')
    lockEntry('stale')
    const offerThenFail = observed(await checkPluginArtifacts({ record: async () => record({ outcome: 'update-available', available: { version: '1.5.0', display: '1.5.0' }, attempt: { at: '2026-10-20T00:00:00.000Z', error: 'index: 503' } }) }))[0]
    expect(offerThenFail.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'plugin-upgrade' })
    expect(offerThenFail.evidence).toMatchObject({ compatibleVersion: '1.5.0', updateObservedAt: '2026-10-19T12:00:00.000Z', updateCheckError: 'index: 503' })

    const blockedThenFail = observed(await checkPluginArtifacts({ record: async () => record({ outcome: 'blocked', blockedReason: 'no published release of stale runs on this Bakin yet (newest is 2.0.0)', attempt: { at: '2026-10-20T00:00:00.000Z', error: 'index: 503' } }) }))[0]
    expect(blockedThenFail.incident?.resolution).toMatchObject({ type: 'human', needs: 'decision', key: 'await-compatible-release' })
    expect(blockedThenFail.evidence).toMatchObject({ updateObservedAt: '2026-10-19T12:00:00.000Z', updateCheckError: 'index: 503' })
  })

  it('without a running engine the default reads are unknown — the check never probes an index itself; the reinstall repair stands', async () => {
    installPlugin('stale', 'react18-old-vX')
    lockEntry('stale')
    const [row] = observed(await checkPluginArtifacts())
    expect(row.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'plugin-reinstall' })
    expect(row.evidence).toMatchObject({ updateObservedAt: null })
  })

  it('a compatible rebuild published under the installed version number is still offered (the installed artifact does not run)', async () => {
    installPlugin('stale', 'react18-old-vX')
    lockEntry('stale', '1.5.0')
    const [row] = observed(await checkPluginArtifacts({ record: async () => record({ outcome: 'update-available', installed: { version: '1.5.0', display: '1.5.0' }, available: { version: '1.5.0', display: '1.5.0 (rebuilt for this Bakin)' }, reason: 'compatible-rebuild' }) }))
    expect(row.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'plugin-upgrade' })
  })
})
