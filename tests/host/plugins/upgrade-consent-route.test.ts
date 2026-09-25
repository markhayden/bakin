/**
 * POST /api/plugins/upgrade is two-phase (spec plugin-managed-binaries S17):
 * preview → awaitingConsent + token; commit with that token; a target that
 * changed since the preview bounces to awaitingConsent + manifestChanged with
 * a fresh token and mutates nothing; tokens are bound to the plugin.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-upgrade-route-${Date.now()}-${randomUUID()}`)
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
mock.module('../../../src/core/plugin-registry', () => ({ isCorePlugin: () => false }))
mock.module('../../../packages/host/src/plugin-host/user-plugin-builder', () => ({ buildUserPlugin: async () => {} }))
mock.module('../../../src/core/plugins/live-lifecycle', () => ({
  activateUserPluginDir: async () => ({ runtimeVersion: 1 }),
  isLiveActivationUnavailable: () => false,
}))

import { post as upgradePOST } from '../../../packages/host/src/api/plugins/upgrade'
import { computeSourceTreeSha } from '../../../src/core/plugins/source-tree-sha'
import { signConsentToken } from '../../../src/core/plugins/consent-token'
import { addPlugin, readPluginLockfile, writePluginLockfile } from '../../../packages/core/src/plugins/lockfile'

const ID = 'routeplug'
const source = join(testDir, 'source')
const pluginDir = join(testDir, 'plugins', ID)

function writeSource(version: string, permissions: string[]): void {
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'bakin-plugin.json'), JSON.stringify({ id: ID, name: ID, version, bakin: '*', description: 'route fixture', permissions }))
  writeFileSync(join(source, 'index.ts'), `export default { id: '${ID}', activate() {} }`)
}
const post = async (body: unknown) => {
  const res = await upgradePOST(new Request('http://localhost/api/plugins/upgrade', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), new URL('http://localhost/api/plugins/upgrade'))
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}
const installedVersion = () => (JSON.parse(readFileSync(join(pluginDir, 'bakin-plugin.json'), 'utf-8')) as { version: string }).version

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  writeSource('1.0.0', ['storage.read'])
  cpSync(source, pluginDir, { recursive: true })
  writePluginLockfile(addPlugin(readPluginLockfile(), ID, {
    source, type: 'local', ref: '', commitSha: '', installedAt: '2026-09-01T00:00:00.000Z', version: '1.0.0',
    permissions: ['storage.read'], manifestSha: 'a'.repeat(64), sourceTreeSha: computeSourceTreeSha(source),
  }))
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('POST /api/plugins/upgrade — consent round trip', () => {
  it('preview → token → commit; a target changed in between bounces with a fresh token and mutates nothing', async () => {
    writeSource('1.1.0', ['storage.read', 'events.emit'])
    const preview = await post({ pluginId: ID })
    expect(preview.body.ok).toBe(false)
    expect(preview.body.awaitingConsent).toBe(true)
    expect(preview.body.newPermissions).toEqual(['events.emit'])
    expect(preview.body.newBins).toEqual([])
    expect(typeof preview.body.consentToken).toBe('string')
    expect(installedVersion()).toBe('1.0.0')

    // The source moves on before the user accepts.
    writeSource('1.2.0', ['storage.read', 'storage.write'])
    const stale = await post({ pluginId: ID, accepted: true, consentToken: preview.body.consentToken })
    expect(stale.body.awaitingConsent).toBe(true)
    expect(stale.body.manifestChanged).toBe(true)
    expect(stale.body.newPermissions).toEqual(['storage.write'])
    expect(stale.body.consentToken).not.toBe(preview.body.consentToken)
    expect(installedVersion()).toBe('1.0.0')
    expect(readPluginLockfile().plugins[ID]?.version).toBe('1.0.0')

    const committed = await post({ pluginId: ID, accepted: true, consentToken: stale.body.consentToken })
    expect(committed.status).toBe(200)
    expect(committed.body.ok).toBe(true)
    expect(committed.body.awaitingConsent).toBe(false)
    expect((committed.body.after as { version: string }).version).toBe('1.2.0')
    expect(installedVersion()).toBe('1.2.0')
    expect(readPluginLockfile().plugins[ID]?.permissions.sort()).toEqual(['storage.read', 'storage.write'])
  })

  it('rejects a commit without a token, with a forged token, or with a token issued for another plugin', async () => {
    writeSource('1.1.0', ['storage.read', 'events.emit'])
    expect((await post({ pluginId: ID, accepted: true })).status).toBe(400)
    expect((await post({ pluginId: ID, accepted: true, consentToken: 'bm9wZQ==.' + 'f'.repeat(64) })).status).toBe(400)
    const foreign = signConsentToken({ source: 'upgrade:someone-else', manifestSha: 'b'.repeat(64), permissions: [], bins: [] })
    const res = await post({ pluginId: ID, accepted: true, consentToken: foreign })
    expect(res.status).toBe(400)
    expect(String(res.body.error)).toMatch(/different operation/)
    expect(installedVersion()).toBe('1.0.0')
  })

  it('a narrowing or unchanged-permission upgrade needs no consent and commits on the first call', async () => {
    writeSource('1.1.0', ['storage.read'])
    const res = await post({ pluginId: ID })
    expect(res.body.ok).toBe(true)
    expect(res.body.awaitingConsent).toBe(false)
    expect(installedVersion()).toBe('1.1.0')
  })
})
