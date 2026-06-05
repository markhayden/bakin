/**
 * plugin-artifacts health check (P9 surfacing). Scans installed plugins for
 * needs-update / invalid Whiskin provenance.
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

import { checkPluginArtifacts } from '../../../plugins/health/lib/system-checks/plugin-artifacts'
import { writeProvenance, WHISKIN_PROVENANCE_VERSION, type WhiskinBuildProvenance } from '../../../src/core/whiskin/provenance'
import { EXTERNALS_CONTRACT } from '../../../src/core/whiskin/externals'

function installPlugin(id: string, externalsContract: string): void {
  const dir = join(testDir, 'plugins', id)
  mkdirSync(join(dir, '.whiskin'), { recursive: true })
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify({ id, version: '1.0.0' }))
  const prov: WhiskinBuildProvenance = {
    version: WHISKIN_PROVENANCE_VERSION,
    pluginId: id,
    pluginVersion: '1.0.0',
    bakinVersion: '0.0.1-rc.15',
    bakinRange: '>=0.0.1-rc.1',
    whiskinVersion: '1',
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
  writeProvenance(join(dir, '.whiskin', 'build.json'), prov)
}

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => {
  rmSync(join(testDir, 'plugins'), { recursive: true, force: true })
  mkdirSync(join(testDir, 'plugins'), { recursive: true })
})

describe('checkPluginArtifacts', () => {
  it('is ok when no plugins are installed', () => {
    rmSync(join(testDir, 'plugins'), { recursive: true, force: true })
    expect(checkPluginArtifacts()[0].status).toBe('ok')
  })

  it('is ok when all installed artifacts are compatible', () => {
    installPlugin('foo', EXTERNALS_CONTRACT)
    expect(checkPluginArtifacts()[0].status).toBe('ok')
  })

  it('warns about a needs-update artifact (incompatible externals contract)', () => {
    installPlugin('foo', EXTERNALS_CONTRACT)
    installPlugin('stale', 'react18-old-vX')
    const r = checkPluginArtifacts()[0]
    expect(r.status).toBe('warn')
    expect(r.message).toContain('stale')
    expect(r.message).toContain('needs update')
  })
})
