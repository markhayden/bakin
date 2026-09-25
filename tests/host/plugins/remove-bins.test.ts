/**
 * POST /api/plugins/remove sweeps the plugin's binaries (spec
 * plugin-managed-binaries S6): a bin no other owner pins is deleted with
 * its marker AFTER the ledger row is gone; one a pack or another plugin
 * still pins survives; the response and the audit trail say which was
 * which; the uninstall snapshot's lock-entry copy still lists the bins.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { execFileSync } from 'child_process'

const testDir = join(tmpdir(), `bakin-test-remove-bins-${Date.now()}-${randomUUID()}`)
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
mock.module('../../../src/core/plugin-registry', () => ({
  isCorePlugin: () => false,
  pluginRegistry: { getPlugin: () => undefined, getPluginContext: () => undefined, deactivatePlugin: async () => ({ hooks: 0 }) },
}))
mock.module('../../../src/core/plugins/live-lifecycle', () => ({ notifyPluginRemoved: () => {} }))
mock.module('../../../src/core/onboarding/plugin-assets', () => ({
  planPluginAssetsRemoval: async () => ({ snapshots: [], remove: [], keep: [], missingFromDisk: [] }),
  removePluginAssets: async () => ({ removed: 0, kept: 0, missingFromDisk: [] }),
}))

import { post as removePOST } from '../../../packages/host/src/api/plugins/remove'
import { addPlugin, readPluginLockfile, writePluginLockfile } from '../../../packages/core/src/plugins/lockfile'
import { readLockfile, writeLockfile } from '../../../packages/core/src/agent-packages/lockfile'
import { writeInstalledBy } from '../../../packages/core/src/agent-packages/markers'

const ID = 'binplug'
const SHA = 'c'.repeat(64)
const binPath = (name: string) => join(testDir, 'bin', name)

function placeBin(name: string, owner: string): void {
  mkdirSync(join(testDir, 'bin'), { recursive: true })
  writeFileSync(binPath(name), `#!/bin/sh\necho ${name}\n`, { mode: 0o755 })
  writeInstalledBy(binPath(name), { package: owner, version: '1.0.0', ref: '', commitSha: '', sha256: SHA, installedAt: '2026-09-01T00:00:00.000Z' })
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(join(testDir, 'plugins', ID), { recursive: true })
  writeFileSync(join(testDir, 'plugins', ID, 'bakin-plugin.json'), JSON.stringify({ id: ID, name: ID, version: '1.0.0', bakin: '*', description: 'x' }))
  for (const name of ['solo', 'packshared', 'pluginshared']) placeBin(name, `plugin:${ID}`)
  writePluginLockfile(addPlugin(readPluginLockfile(), ID, {
    source: '/src', type: 'local', ref: '', commitSha: '', installedAt: '2026-09-01T00:00:00.000Z', version: '1.0.0',
    permissions: [], manifestSha: 'a'.repeat(64),
    installedBins: [{ name: 'solo', sha256: SHA }, { name: 'packshared', sha256: SHA }, { name: 'pluginshared', sha256: SHA }],
  }))
  writePluginLockfile(addPlugin(readPluginLockfile(), 'otherplug', {
    source: '/other', type: 'local', ref: '', commitSha: '', installedAt: '2026-09-01T00:00:00.000Z', version: '1.0.0',
    permissions: [], manifestSha: 'b'.repeat(64), installedBins: [{ name: 'pluginshared', sha256: SHA }],
  }))
  const packs = readLockfile()
  packs.packages['ocr@1.0.0'] = {
    kind: 'skill-pack', version: '1.0.0', source: 'github:x/ocr', ref: '', commitSha: '', installedAt: '2026-09-01T00:00:00.000Z',
    projections: [{ kind: 'bin', target: binPath('packshared'), sha256: SHA }],
  }
  writeLockfile(packs)
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('POST /api/plugins/remove — bin sweep', () => {
  it('deletes the unowned bin (file + marker), keeps pack- and plugin-shared ones, reports and audits both', async () => {
    const res = await removePOST(new Request('http://localhost/api/plugins/remove', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pluginId: ID }),
    }), new URL('http://localhost/api/plugins/remove'))
    const body = await res.json() as { ok: boolean; bins: { removed: string[]; kept: string[] } }
    expect(body.ok).toBe(true)
    expect(body.bins).toEqual({ removed: ['solo'], kept: ['packshared', 'pluginshared'] })

    expect(existsSync(binPath('solo'))).toBe(false)
    expect(existsSync(`${binPath('solo')}.installedBy`)).toBe(false)
    expect(existsSync(binPath('packshared'))).toBe(true)
    expect(existsSync(binPath('pluginshared'))).toBe(true)
    expect(readPluginLockfile().plugins[ID]).toBeUndefined()
    expect(existsSync(join(testDir, 'plugins', ID))).toBe(false)

    const audit = readFileSync(join(testDir, 'audit.jsonl'), 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { event?: string; type?: string; data?: Record<string, unknown> })
    const binsEvent = audit.find((row) => (row.event ?? row.type) === 'plugin.uninstall.bins')
    expect(binsEvent?.data).toMatchObject({ pluginId: ID, removed: ['solo'], kept: ['packshared', 'pluginshared'] })

    // The snapshot keeps the lock-entry copy, bins included (bytes are re-downloadable).
    const tarballs = readdirSync(join(testDir, '.uninstalled')).filter((name) => name.startsWith(`${ID}-`) && name.endsWith('.tar.gz'))
    expect(tarballs).toHaveLength(1)
    const listing = execFileSync('tar', ['-xzOf', join(testDir, '.uninstalled', tarballs[0]!), `plugin-lock/${ID}.json`], { encoding: 'utf-8' })
    expect(JSON.parse(listing).installedBins.map((bin: { name: string }) => bin.name)).toEqual(['solo', 'packshared', 'pluginshared'])
  })
})
