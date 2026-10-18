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
import { waitUntil } from '../../helpers/wait'
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
  const offering = (compatible: string | null, latest = '2.0.0'): PluginArtifactDeps => ({
    publishedVersions: async () => ({ pluginId: 'stale', latest, compatible }),
  })

  it('a compatible release becomes a one-click upgrade repair', async () => {
    installPlugin('stale', 'react18-old-vX')
    lockEntry('stale')
    const [row] = observed(await checkPluginArtifacts(offering('1.5.0')))
    expect(row.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'upgrade-plugin-artifact', label: 'Install 1.5.0 for this Bakin' })
    expect(row.evidence).toMatchObject({ compatibleVersion: '1.5.0' })
  })

  it('no compatible release yet says so instead of pointing at an upgrade that would refuse', async () => {
    installPlugin('stale', 'react18-old-vX')
    lockEntry('stale')
    const [row] = observed(await checkPluginArtifacts(offering(null, '2.0.0')))
    expect(row.incident?.resolution).toMatchObject({ type: 'instructions', key: 'await-compatible-release' })
    expect(JSON.stringify(row.incident?.resolution)).toContain('newest is 2.0.0')
  })

  it('an unreadable source index keeps the generic instructions (never a fake repair)', async () => {
    installPlugin('stale', 'react18-old-vX')
    lockEntry('stale')
    const [row] = observed(await checkPluginArtifacts({ publishedVersions: async () => { throw new Error('offline') } }))
    expect(row.incident?.resolution).toMatchObject({ type: 'instructions', key: 'upgrade-plugin' })
  })

  it('a compatible rebuild published under the installed version number is still offered (the installed artifact does not run)', async () => {
    installPlugin('stale', 'react18-old-vX')
    lockEntry('stale', '1.5.0')
    const [row] = observed(await checkPluginArtifacts(offering('1.5.0')))
    expect(row.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'upgrade-plugin-artifact' })
  })
})

describe('checkPluginArtifacts — index reads are concurrent', () => {
  it('reads every stranded plugin\'s index at once (N slow sources cost one read, not N)', async () => {
    for (const id of ['one', 'two', 'three']) installPlugin(id, 'react18-old-vX')
    writeFileSync(join(testDir, 'plugins', 'lock.json'), JSON.stringify({
      version: 1,
      plugins: Object.fromEntries(['one', 'two', 'three'].map((id) => [id, {
        source: `github:markhayden/bakin-bits-official#plugins/${id}`, type: 'github', ref: '', commitSha: '',
        installedAt: '2026-10-01T00:00:00.000Z', version: '1.0.0', permissions: [], manifestSha: 'c'.repeat(64),
      }])),
    }))
    let inFlight = 0
    let peak = 0
    const release: Array<() => void> = []
    const running = checkPluginArtifacts({
      publishedVersions: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise<void>((resolve) => { release.push(resolve) })
        inFlight -= 1
        return { pluginId: 'x', latest: '2.0.0', compatible: '2.0.0' }
      },
    })
    await waitUntil(() => release.length === 3, { label: 'all three index reads started' })
    for (const r of release) r()
    expect(observed(await running)).toHaveLength(3)
    expect(peak).toBe(3)
  })
})
