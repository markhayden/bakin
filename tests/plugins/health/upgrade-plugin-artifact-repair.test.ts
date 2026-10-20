/**
 * The one-click upgrade for plugins a Bakin upgrade stranded: plan() previews
 * (version + every declared permission/binary are the change set an approval shows),
 * apply() re-previews and commits with exactly that consent, then activates.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-upgrade-artifact-repair-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}), isUsingBakinHome: () => true }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}), isUsingBakinHome: () => true }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }))

type Consent = { manifestSha: string; permissions: string[]; bins: Array<{ name: string; version: string; sha256: string }> }
type Expected = { version?: string; sha?: string; digest?: string }
const calls: Array<{ id: string; previewOnly?: boolean; accepted?: Consent; expected?: Expected }> = []
let previewManifest = 'd'.repeat(64)
let previewVersion = '1.5.0'
/** The published tarball's sha256 the artifact lane verifies — part of the frozen target (review r4 #2). */
let previewDigest = '7'.repeat(64)
let commitAwaitsConsent = false
class UpgradeRefusedError extends Error {}
mock.module('../../../src/core/plugins/upgrade', () => ({
  UpgradeRefusedError,
  upgradePlugin: async (id: string, opts: { previewOnly?: boolean; accepted?: Consent; expected?: Expected }) => {
    calls.push({ id, previewOnly: opts.previewOnly, accepted: opts.accepted, expected: opts.expected })
    if (opts.expected?.digest !== undefined && opts.expected.digest !== previewDigest) throw new UpgradeRefusedError(`${id}: the upgrade target changed since it was reviewed — artifact ${previewDigest.slice(0, 12)} (reviewed ${opts.expected.digest.slice(0, 12)}).`)
    const consent = { manifestSha: previewManifest, permissions: ['network'], bins: [{ name: 'ttyd', version: '1.7.7', sha256: 'e'.repeat(64) }] }
    const base = { id, before: { version: '1.0.0', commitSha: '' }, after: { version: previewVersion, commitSha: '' }, noop: false, identity: { version: previewVersion, digest: previewDigest } }
    if (opts.previewOnly) return { ...base, declaredPermissions: ['network'], declaredBins: consent.bins, awaitingConsent: true, consent }
    if (commitAwaitsConsent) return { ...base, declaredPermissions: [], declaredBins: [], awaitingConsent: true, consent }
    return { ...base, declaredPermissions: ['network'], declaredBins: consent.bins, awaitingConsent: false }
  },
}))
const activated: string[] = []
mock.module('../../../src/core/plugins/live-lifecycle', () => ({
  activateUserPluginDir: async (dir: string) => { activated.push(dir); return { runtimeVersion: 1 } },
}))

import { upgradePluginArtifactRepair } from '../../../plugins/health/lib/system-checks/plugin-artifacts'
import { writeProvenance, WHISKIT_PROVENANCE_VERSION } from '../../../src/core/whiskit/provenance'
import { expectRepairContract, runRepairContract } from '../../helpers/repair-contract'

const target = { type: 'all_actionable' as const, reportId: 'report-1' }
const deps = { publishedVersions: async () => ({ pluginId: 'terminal', latest: '2.0.0', compatible: '1.5.0' }) }

function installStranded(id: string): void {
  const dir = join(testDir, 'plugins', id)
  mkdirSync(join(dir, '.whiskit'), { recursive: true })
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify({ id, version: '1.0.0' }))
  writeProvenance(join(dir, '.whiskit', 'build.json'), {
    version: WHISKIT_PROVENANCE_VERSION, pluginId: id, pluginVersion: '1.0.0', bakinVersion: '0.0.1-rc.40', bakinRange: '>=0.0.1-rc.1',
    whiskitVersion: '1', buildBackend: 'system-bun', platform: 'neutral', sourceCommitSha: '', sourceTreeSha: 'a'.repeat(64),
    manifestSha: 'b'.repeat(64), externalsContract: 'react19-sdk-makinbakin-v2', approvedInstallScripts: [],
    outputs: { serverEntry: 'dist/index.js' }, builtAt: '2026-10-01T00:00:00.000Z',
  })
  writeFileSync(join(testDir, 'plugins', 'lock.json'), JSON.stringify({
    version: 1,
    plugins: { [id]: { source: `github:markhayden/bakin-bits-official#plugins/${id}`, type: 'github', ref: '', commitSha: '', installedAt: '2026-10-01T00:00:00.000Z', version: '1.0.0', permissions: [], manifestSha: 'c'.repeat(64) } },
  }))
}

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => {
  rmSync(join(testDir, 'plugins'), { recursive: true, force: true })
  mkdirSync(join(testDir, 'plugins'), { recursive: true })
  calls.length = 0
  activated.length = 0
  previewManifest = 'd'.repeat(64)
  previewVersion = '1.5.0'
  previewDigest = '7'.repeat(64)
  commitAwaitsConsent = false
})

describe('upgrade-plugin-artifact repair', () => {
  it('plans nothing when no plugin is stranded', async () => {
    expect(await upgradePluginArtifactRepair(deps).plan(target)).toEqual([])
  })

  it('plans a manual change set naming the version, the manifest, and every new permission and binary', async () => {
    installStranded('terminal')
    const [item] = await upgradePluginArtifactRepair(deps).plan(target)
    expect(item!.safety).toBe('manual')
    expect(item!.changes.map((c) => c.target)).toEqual([
      `plugin:terminal@1.5.0#${'d'.repeat(64)}!${'7'.repeat(64)}`,
      'plugin:terminal:permission:network',
      `plugin:terminal:bin:ttyd@1.7.7#${'e'.repeat(64)}`,
    ])
    expect(item!.changes[0]!.description).toContain('1.0.0 → 1.5.0 (manifest dddddddddddd, artifact 777777777777)')
    expect(calls.every((c) => c.previewOnly)).toBe(true) // planning never commits
  })

  it('one plugin\'s incident plans only that plugin; all-actionable plans every stranded plugin', async () => {
    installStranded('terminal')
    installStranded('projects')
    // installStranded rewrites the lockfile per plugin — record both.
    writeFileSync(join(testDir, 'plugins', 'lock.json'), JSON.stringify({
      version: 1,
      plugins: Object.fromEntries(['terminal', 'projects'].map((id) => [id, { source: `github:markhayden/bakin-bits-official#plugins/${id}`, type: 'github', ref: '', commitSha: '', installedAt: '2026-10-01T00:00:00.000Z', version: '1.0.0', permissions: [], manifestSha: 'c'.repeat(64) }])),
    }))
    const repair = upgradePluginArtifactRepair(deps)
    const one = await repair.plan({ type: 'incidents', reportId: 'report-1', ids: ['health:plugins:needs-update:terminal'] })
    expect(one[0]!.changes.filter((c) => /^plugin:[^:]+@/.test(c.target)).map((c) => c.target.split('@')[0])).toEqual(['plugin:terminal'])
    const all = await repair.plan(target)
    expect(all[0]!.changes.filter((c) => /^plugin:[^:]+@/.test(c.target)).map((c) => c.target.split('@')[0]).sort()).toEqual(['plugin:projects', 'plugin:terminal'])
    expect(await repair.plan({ type: 'observations', reportId: 'report-1', ids: ['health.plugin-artifacts:plugin:projects'] })).toHaveLength(1)
  })

  it('apply commits with the previewed consent and activates the plugin', async () => {
    installStranded('terminal')
    const repair = upgradePluginArtifactRepair(deps)
    const run = await runRepairContract(repair, await repair.plan(target))
    expectRepairContract(repair, run)
    const commit = calls.find((c) => !c.previewOnly)
    expect(commit?.accepted?.manifestSha).toBe('d'.repeat(64))
    // The lane is held to the approved identity too, not only the consent.
    expect(commit?.expected).toEqual({ version: '1.5.0', digest: '7'.repeat(64) })
    expect(activated).toEqual([join(testDir, 'plugins', 'terminal')])
    expect(run.results[0]).toMatchObject({ status: 'applied', affectedCheckIds: ['health.plugin-artifacts'] })
  })

  it('a release that changed after approval (new version + manifest) is refused, never installed on the old approval', async () => {
    installStranded('terminal')
    const repair = upgradePluginArtifactRepair(deps)
    const approved = await repair.plan(target)
    previewVersion = '2.0.0'
    previewManifest = 'f'.repeat(64)
    const run = await runRepairContract(repair, approved)
    expect(run.results[0]).toMatchObject({ status: 'failed', message: expect.stringContaining('changed since it was approved') })
    expect(calls.some((c) => !c.previewOnly)).toBe(false)
    expect(activated).toEqual([])
    // ...and a re-plan names the new identity, so a frozen approval can't match it.
    const replanned = await repair.plan(target)
    expect(replanned[0]!.changes[0]!.target).toBe(`plugin:terminal@2.0.0#${'f'.repeat(64)}!${'7'.repeat(64)}`)
  })

  it('a stranded plugin whose compatible build carries the SAME version is still offered', async () => {
    installStranded('terminal')
    previewVersion = '1.0.0'
    const sameVersion = { publishedVersions: async () => ({ pluginId: 'terminal', latest: '1.0.0', compatible: '1.0.0' }) }
    const [item] = await upgradePluginArtifactRepair(sameVersion).plan(target)
    expect(item!.changes[0]!.target).toBe(`plugin:terminal@1.0.0#${'d'.repeat(64)}!${'7'.repeat(64)}`)
  })

  it('review r4 #2: a republish under the SAME version and manifest is a different artifact — the approval does not cover it, nothing installs', async () => {
    installStranded('terminal')
    const repair = upgradePluginArtifactRepair(deps)
    const approved = await repair.plan(target)
    previewDigest = '8'.repeat(64)
    const run = await runRepairContract(repair, approved)
    expect(run.results[0]).toMatchObject({ status: 'failed', message: expect.stringContaining('changed since it was approved') })
    expect(calls.some((c) => !c.previewOnly)).toBe(false)
    expect(activated).toEqual([])
  })

  it('a preview that cannot name the artifact digest is not proposed', async () => {
    installStranded('terminal')
    previewDigest = ''
    expect(await upgradePluginArtifactRepair(deps).plan(target)).toEqual([])
  })

  it('a manifest that changed between preview and commit fails the item instead of upgrading unconsented', async () => {
    installStranded('terminal')
    const repair = upgradePluginArtifactRepair(deps)
    const items = await repair.plan(target)
    commitAwaitsConsent = true
    const run = await runRepairContract(repair, items)
    expect(run.results[0]).toMatchObject({ status: 'failed', message: expect.stringContaining('manifest changed') })
    expect(activated).toEqual([])
  })
})
